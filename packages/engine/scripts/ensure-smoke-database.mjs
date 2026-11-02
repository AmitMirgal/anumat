// The release smoke migrates DATABASE_URL (default database anumat_engine).
// The sidecar connects to that database, so a missing one exits 1 with
// `database "anumat_engine" does not exist`. smoke.py writes that stderr and
// then raises SystemExit with the return code and the same stderr, which is
// why the log shows the message, a line `1`, and the message again.
// Migrate cannot create the database it is connecting to. Create it from a
// maintenance database when Postgres is up. If nothing accepts TCP, name that
// Postgres is not running and do not ask the server about a database.
import net from 'node:net';
import pg from 'pg';

const unreachable = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'EAI_AGAIN',
  'ENETUNREACH',
  '57P03',
]);

const maintenanceNames = ['postgres', 'template1', 'anumat'];

const Client = pg.Client ?? pg.default?.Client;
if (!Client) {
  console.error('The pg driver did not export Client.');
  process.exit(1);
}

function postgresIsDown(host, port) {
  console.error(`Postgres is not running at ${host}:${port}. Start it, then run the release script again.`);
  return 1;
}

function acceptsTcp(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let settled = false;
    const timer = setTimeout(() => finish(false), 3000);
    function finish(up) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(up);
    }
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

function quoteIdent(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error('unsafe database name');
  }
  return `"${name}"`;
}

function isUnreachable(error) {
  return unreachable.has(error?.code);
}

function isMissingDatabase(error, name) {
  if (error?.code === '3D000') return true;
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(`database "${name}" does not exist`);
}

function adminUrl(databaseUrl, database) {
  const admin = new URL(databaseUrl);
  admin.pathname = `/${database}`;
  return admin.toString();
}

async function withClient(databaseUrl, database, fn) {
  const client = new Client({
    connectionString: adminUrl(databaseUrl, database),
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    return await fn(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function ensureDatabase(databaseUrl, host, port, dbname) {
  try {
    await withClient(databaseUrl, dbname, async (client) => {
      await client.query('SELECT 1');
    });
    return 0;
  } catch (error) {
    if (isUnreachable(error)) return postgresIsDown(host, port);
    if (!isMissingDatabase(error, dbname)) {
      console.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }

  const maintenance = maintenanceNames.filter((name) => name !== dbname);
  let failure = null;
  for (const name of maintenance) {
    try {
      const created = await withClient(databaseUrl, name, async (client) => {
        const found = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbname]);
        if (found.rows.length > 0) return false;
        await client.query(`CREATE DATABASE ${quoteIdent(dbname)}`);
        return true;
      });
      if (created) console.log(`Created database ${dbname} for the engine smoke.`);
      return 0;
    } catch (error) {
      if (isUnreachable(error)) return postgresIsDown(host, port);
      if (error?.code === '42P04') return 0;
      if (!isMissingDatabase(error, name)) failure = error;
    }
  }

  console.error(
    `Postgres is running at ${host}:${port}, but database ${dbname} is missing and could not be created.`,
  );
  if (failure?.message && !isMissingDatabase(failure, dbname)) console.error(failure.message);
  return 1;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? '';
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set.');
    return 1;
  }
  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    console.error('DATABASE_URL is not a URL.');
    return 1;
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    console.error('DATABASE_URL must be a postgres URL.');
    return 1;
  }
  const host = url.hostname;
  const port = url.port ? Number(url.port) : 5432;
  const dbname = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('DATABASE_URL has no TCP host.');
    return 1;
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(dbname)) {
    console.error('DATABASE_URL database name must be letters, digits, and underscores.');
    return 1;
  }
  const up = await acceptsTcp(host, port);
  if (!up) return postgresIsDown(host, port);
  return ensureDatabase(databaseUrl, host, port, dbname);
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
