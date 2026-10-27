import { readFileSync, writeFileSync } from 'node:fs';

const prelude = `type TrpcContext = {
    apiKey: string | undefined;
    principal: string | undefined;
    services: unknown;
};
type OpenApiMeta = {
    openapi?: {
        enabled?: boolean;
        method: string;
        path: string;
        protect?: boolean;
        summary?: string;
        description?: string;
        tags?: string[];
        operationId?: string;
    };
};

`;

for (const file of ['dist/index.d.ts', 'dist/index.d.mts']) {
  let text = readFileSync(file, 'utf8');
  text = text.replace(/^import \* as trpc_to_openapi from 'trpc-to-openapi';\r?\n/m, '');
  text = text.replace(/^import \* as _anumat_contract from '@anumat\/contract';\r?\n/m, '');
  text = text.replaceAll('_anumat_contract.TrpcContext', 'TrpcContext');
  text = text.replaceAll('trpc_to_openapi.OpenApiMeta', 'OpenApiMeta');
  if (text.includes('@anumat/') || text.includes('trpc-to-openapi') || text.includes('prisma')) {
    throw new Error(`${file} still names an internal package`);
  }
  const marker = 'declare function createAnumatClient';
  const at = text.indexOf(marker);
  if (at === -1) throw new Error(`${file} is missing ${marker}`);
  writeFileSync(file, `${text.slice(0, at)}${prelude}${text.slice(at)}`);
}
