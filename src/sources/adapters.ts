import { Agent as HttpAgent, request as httpRequest, type IncomingMessage } from 'node:http';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import { AppError } from '../errors';
import type { AdapterType } from '../generated/prisma/client';

export type { AdapterType };
export type FetchedArtifact = { bytes: Uint8Array; mime: string };

export interface SourceAdapter {
  fetchArtifact(source: { sourceUrl: string }): Promise<FetchedArtifact>;
}

const MAX_BYTES = 50 * 1024 * 1024;
const PDF_MAGIC = '%PDF-';
const FETCH_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;
const FAMILIES = [4, 6] as const;
type Family = (typeof FAMILIES)[number];

const REQUEST_HEADERS = {
  accept: 'application/pdf',
  'user-agent': 'AnumatPolicyWatcher/0.1',
  connection: 'close',
};

function describe(error: unknown): string {
  if (error instanceof AppError) return error.message;
  if (!(error instanceof Error)) return String(error);
  const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
  return code ? `${code}: ${error.message}` : `${error.name}: ${error.message}`;
}

function chooseFailure(sourceUrl: string, errors: unknown[]): AppError {
  const apps = errors.filter((error): error is AppError => error instanceof AppError);
  const notPdf = apps.find((error) => error.code === 'not_a_pdf');
  if (notPdf) return notPdf;
  const httpFailure = apps.find((error) => error.details !== undefined && 'status' in error.details);
  if (httpFailure) return httpFailure;
  const only = apps.length === 1 ? apps[0] : undefined;
  if (only) return only;
  return new AppError('fetch_failed', `Could not fetch ${sourceUrl}: ${errors.map(describe).join('; ')}`, {
    url: sourceUrl,
  });
}

function requestOnce(url: URL, family: Family, signal: AbortSignal): Promise<{ res: IncomingMessage; done: () => void }> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return Promise.reject(new AppError('fetch_failed', `${url} uses ${url.protocol}`, { url: url.toString() }));
  }
  const secure = url.protocol === 'https:';
  const send = secure ? httpsRequest : httpRequest;
  const agent = secure ? new HttpsAgent({ keepAlive: false, family }) : new HttpAgent({ keepAlive: false, family });
  const done = () => agent.destroy();
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      done();
      reject(error);
    };
    const req = send(url, { family, agent, method: 'GET', headers: REQUEST_HEADERS, signal }, (res) => {
      if (settled) {
        res.resume();
        done();
        return;
      }
      settled = true;
      resolve({ res, done });
    });
    req.on('error', (error) => {
      if (signal.aborted) {
        fail(
          new AppError('fetch_failed', `${url} produced no headers before the ${FETCH_TIMEOUT_MS / 1000}s timeout`, {
            url: url.toString(),
          }),
        );
        return;
      }
      fail(error);
    });
    req.end();
  });
}

function readBody(res: IncomingMessage, signal: AbortSignal, sourceUrl: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      res.destroy();
      reject(error);
    };
    const succeed = (bytes: Uint8Array) => {
      if (settled) return;
      settled = true;
      resolve(bytes);
    };
    const onAbort = () =>
      fail(
        new AppError(
          'fetch_failed',
          `${sourceUrl} sent headers and then ${total} body bytes before the ${FETCH_TIMEOUT_MS / 1000}s timeout`,
          { url: sourceUrl, body_bytes: total },
        ),
      );
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    const declared = Number(res.headers['content-length'] ?? 0);
    res.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BYTES) {
        fail(new AppError('fetch_failed', `${sourceUrl} is larger than ${MAX_BYTES} bytes`, { url: sourceUrl }));
        return;
      }
      chunks.push(chunk);
      if (declared > 0 && total >= declared) succeed(new Uint8Array(Buffer.concat(chunks)));
    });
    res.on('end', () => succeed(new Uint8Array(Buffer.concat(chunks))));
    res.on('error', fail);
  });
}

async function fetchFamily(start: URL, family: Family, signal: AbortSignal): Promise<FetchedArtifact> {
  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const { res, done } = await requestOnce(current, family, signal);
    try {
      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      if (status >= 300 && status < 400 && location && hop < MAX_REDIRECTS) {
        res.resume();
        current = new URL(location, current);
        continue;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        throw new AppError('fetch_failed', `${current} returned HTTP ${status}`, { url: current.toString(), status });
      }
      const declared = Number(res.headers['content-length'] ?? 0);
      if (declared > MAX_BYTES) {
        res.resume();
        throw new AppError('fetch_failed', `${current} is larger than ${MAX_BYTES} bytes`, { url: current.toString() });
      }
      const bytes = await readBody(res, signal, current.toString());
      const contentType = res.headers['content-type'];
      if (new TextDecoder().decode(bytes.subarray(0, PDF_MAGIC.length)) !== PDF_MAGIC) {
        throw new AppError('not_a_pdf', `${current} did not return a PDF`, {
          url: current.toString(),
          content_type: typeof contentType === 'string' ? contentType : null,
        });
      }
      return { bytes, mime: 'application/pdf' };
    } finally {
      done();
    }
  }
  throw new AppError('fetch_failed', `${start} redirected too many times`, { url: start.toString() });
}

export const httpPdf: SourceAdapter = {
  async fetchArtifact({ sourceUrl }) {
    let parsed: URL;
    try {
      parsed = new URL(sourceUrl);
    } catch (error) {
      throw new AppError('fetch_failed', `Could not fetch ${sourceUrl}: ${describe(error)}`, { url: sourceUrl });
    }
    const parent = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    const stops: AbortController[] = [];
    const errors: unknown[] = [];
    let pending = FAMILIES.length;
    try {
      return await new Promise<FetchedArtifact>((resolve, reject) => {
        for (const family of FAMILIES) {
          const stop = new AbortController();
          stops.push(stop);
          const signal = AbortSignal.any([parent, stop.signal]);
          fetchFamily(parsed, family, signal).then(
            (artifact) => resolve(artifact),
            (error: unknown) => {
              errors.push(error);
              pending -= 1;
              if (pending === 0) reject(chooseFailure(sourceUrl, errors));
            },
          );
        }
      });
    } finally {
      for (const stop of stops) stop.abort();
    }
  },
};

export const adapters: Record<AdapterType, SourceAdapter> = { http_pdf: httpPdf };
