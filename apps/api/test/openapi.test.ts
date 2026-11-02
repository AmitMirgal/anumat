import { expect, test } from 'vitest';
import { openApiDocument } from '@anumat/contract';

const document = openApiDocument();

test('create routes publish 201 and the conflict routes publish 409', () => {
  const payers = document.paths?.['/payers']?.post?.responses;
  const sources = document.paths?.['/sources']?.post?.responses;
  const approve = document.paths?.['/versions/{id}/approve']?.post?.responses;
  const reject = document.paths?.['/versions/{id}/reject']?.post?.responses;
  expect(payers?.['201']).toBeTruthy();
  expect(payers?.['200']).toBeUndefined();
  expect(payers?.['409']).toBeTruthy();
  expect(sources?.['201']).toBeTruthy();
  expect(sources?.['409']).toBeTruthy();
  expect(approve?.['409']).toBeTruthy();
  expect(reject?.['409']).toBeTruthy();
});

test('every REST operation has an operationId', () => {
  const ids = Object.values(document.paths ?? {}).flatMap((item) =>
    Object.values(item ?? {}).flatMap((operation) => {
      if (!operation || typeof operation !== 'object' || !('operationId' in operation)) return [];
      return [operation.operationId];
    }),
  );
  expect(ids).toEqual([
    'createPayer',
    'listPayers',
    'createSource',
    'listSources',
    'getSource',
    'checkSource',
    'getPolicy',
    'listPolicyVersions',
    'getPolicyVersion',
    'listVersions',
    'getVersion',
    'approveVersion',
    'rejectVersion',
    'getDiff',
  ]);
});
