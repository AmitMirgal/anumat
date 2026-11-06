import { AppError } from '@anumat/core';
import type { StorageConfig } from './config';
import { closeContext as closeFullContext, type AppContext } from './context';
import {
  createEngine as createFullEngine,
  type CreateEngineOptions,
  type EngineDb,
  type EngineFirecrawl,
  type EngineLlm,
  type EngineStorage,
} from './engine';
import { extractFromPdf, type ExtractedPolicy, type ExtractInput } from './extract';
import { callPolicy, toJson, type PolicyMethod } from './policy-api';
import { slugify } from './catalog';

export type { CreateEngineOptions, EngineDb, EngineFirecrawl, EngineLlm, EngineStorage, ExtractedPolicy, ExtractInput };
export { AppError, slugify };

export type Engine = {
  config: {
    databaseUrl: string | undefined;
    storage: StorageConfig;
    models: { strong: string; cheap: string };
    firecrawlApiKey: string | undefined;
    firecrawlApiUrl: string | undefined;
  };
  db?: EngineDb;
};

export type PayerJson = {
  id: string;
  name: string;
  slug: string;
  market: string;
  createdAt: string;
  updatedAt: string;
};

export type SourceJson = {
  id: string;
  payerId: string;
  market: string;
  policyKey: string;
  title: string;
  sourceUrl: string;
  adapterType: string;
  checkIntervalHours: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type VersionJson = {
  id: string;
  sourceId: string;
  market: string;
  policyKey: string;
  documentId: string;
  baseVersionId: string | null;
  supersedesId: string | null;
  status: string;
  version: number | null;
  extractSchema: string;
  extractedJson: unknown;
  extractedBy: string;
  approvedAt: string | null;
  approvedBy: string | null;
  rejectedAt: string | null;
  rejectedBy: string | null;
  rejectReason: string | null;
  supersededAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DiffJson = {
  id: string;
  policyKey: string;
  fromVersionId: string | null;
  toVersionId: string;
  diffJson: unknown;
  summary: string | null;
  review: unknown;
  createdAt: string;
  updatedAt: string;
};

export type CheckJson = {
  run: {
    id: string;
    sourceId: string;
    startedAt: string;
    finishedAt: string;
    outcome: string;
    artifactId: string | null;
    versionId: string | null;
    errorCode: string | null;
    errorMessage: string | null;
  };
  version: VersionJson | null;
  diff: DiffJson | null;
};

export type PageJson<T> = { items: T[]; nextCursor: string | null };

export type ProposeVersionResult = {
  version: VersionJson;
  diff: DiffJson;
  created: boolean;
};

type PolicyInput = {
  registerPayer: { name: string; slug: string; market: 'us' };
  getPayer: { id: string };
  findPayerBySlug: { slug: string };
  listPayers: { limit?: number; cursor?: string };
  registerSource: {
    payerId: string;
    title: string;
    sourceUrl: string;
    policySlug?: string;
    market?: 'us';
    checkIntervalHours?: number;
    enabled?: boolean;
  };
  getSource: { id: string };
  findSourceByPolicyKey: { policyKey: string };
  listSources: { limit?: number; cursor?: string };
  checkSource: { sourceId: string };
  dueSources: Record<string, never>;
  checkDueSources: Record<string, never>;
  proposeVersion: { sourceId: string; documentId: string; extraction: unknown; extractedBy: string };
  approveVersion: { versionId: string; approvedBy: string };
  rejectVersion: { versionId: string; rejectedBy: string; reason: string };
  getPublishedPolicy: { policyKey: string };
  getPublishedVersion: { policyKey: string; version: number };
  listPublishedVersions: { policyKey: string; limit?: number; cursor?: string };
  getVersion: { id: string };
  listVersions: { limit?: number; cursor?: string; status?: 'proposed' | 'approved' | 'rejected' | 'superseded'; policyKey?: string };
  getDiff: { id: string };
  diffForVersion: { versionId: string };
  saveDiffNotes: { diffId: string; summary: string | null; review: unknown };
};

type PolicyOutput = {
  registerPayer: PayerJson;
  getPayer: PayerJson;
  findPayerBySlug: PayerJson | null;
  listPayers: PageJson<PayerJson>;
  registerSource: SourceJson;
  getSource: SourceJson;
  findSourceByPolicyKey: SourceJson | null;
  listSources: PageJson<SourceJson>;
  checkSource: CheckJson;
  dueSources: SourceJson[];
  checkDueSources: CheckJson[];
  proposeVersion: ProposeVersionResult;
  approveVersion: VersionJson;
  rejectVersion: VersionJson;
  getPublishedPolicy: VersionJson;
  getPublishedVersion: VersionJson;
  listPublishedVersions: PageJson<VersionJson>;
  getVersion: VersionJson;
  listVersions: PageJson<VersionJson>;
  getDiff: DiffJson;
  diffForVersion: DiffJson;
  saveDiffNotes: DiffJson;
};

function asContext(engine: Engine): AppContext {
  return engine as unknown as AppContext;
}

type CatalogMethod = Exclude<PolicyMethod, 'extract'>;

function policyCall<M extends CatalogMethod>(method: M) {
  return async (engine: Engine, input: PolicyInput[M]): Promise<PolicyOutput[M]> => {
    const result = await callPolicy(asContext(engine), method, input);
    return toJson(result) as PolicyOutput[M];
  };
}

export async function createEngine(options: CreateEngineOptions = {}): Promise<Engine> {
  return createFullEngine(options);
}

export async function closeContext(engine: Engine): Promise<void> {
  await closeFullContext(asContext(engine));
}

export const registerPayer = policyCall('registerPayer');
export const getPayer = policyCall('getPayer');
export const findPayerBySlug = policyCall('findPayerBySlug');
export const listPayers = policyCall('listPayers');
export const registerSource = policyCall('registerSource');
export const getSource = policyCall('getSource');
export const findSourceByPolicyKey = policyCall('findSourceByPolicyKey');
export const listSources = policyCall('listSources');
export const checkSource = policyCall('checkSource');
export const proposeVersion = policyCall('proposeVersion');
export const approveVersion = policyCall('approveVersion');
export const rejectVersion = policyCall('rejectVersion');
export const getPublishedPolicy = policyCall('getPublishedPolicy');
export const getPublishedVersion = policyCall('getPublishedVersion');
export const listPublishedVersions = policyCall('listPublishedVersions');
export const getVersion = policyCall('getVersion');
export const listVersions = policyCall('listVersions');
export const getDiff = policyCall('getDiff');
export const diffForVersion = policyCall('diffForVersion');
export const saveDiffNotes = policyCall('saveDiffNotes');

export async function extract(engine: Engine, input: ExtractInput): Promise<ExtractedPolicy> {
  return extractFromPdf(asContext(engine), input);
}

export function dueSources(engine: Engine, input: PolicyInput['dueSources'] = {}): Promise<SourceJson[]> {
  return policyCall('dueSources')(engine, input);
}

export function checkDueSources(engine: Engine, input: PolicyInput['checkDueSources'] = {}): Promise<CheckJson[]> {
  return policyCall('checkDueSources')(engine, input);
}
