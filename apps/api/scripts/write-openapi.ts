import { writeFileSync } from 'node:fs';
import { openApiDocument } from '@anumat/contract';

writeFileSync(new URL('../openapi.json', import.meta.url), JSON.stringify(openApiDocument(), null, 2));
