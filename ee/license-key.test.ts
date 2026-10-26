import { expect, test } from 'vitest';
import { decideUse, readLicenseKey, type LicenseKeyRecord } from './license-key';

const feature = 'audit-trail';
const now = new Date('2026-10-26T08:42:00.000Z');

function key(overrides: Partial<LicenseKeyRecord> = {}): LicenseKeyRecord {
  return {
    id: 'key-1',
    purpose: 'production',
    expiresAt: new Date('2027-01-01T00:00:00.000Z'),
    features: [feature],
    ...overrides,
  };
}

const rawKey = {
  id: 'key-1',
  purpose: 'production',
  expiresAt: '2027-01-01T00:00:00.000Z',
  features: [feature],
};

test('development and testing are allowed without a key or an agreement', () => {
  for (const purpose of ['development', 'testing'] as const) {
    expect(decideUse({ purpose, feature, agreementSigned: false, licenseKey: null, now })).toEqual({ allowed: true });
  }
});

test('production without an agreement is agreement_required even when a key is present', () => {
  expect(decideUse({ purpose: 'production', feature, agreementSigned: false, licenseKey: key(), now })).toEqual({
    allowed: false,
    reason: 'agreement_required',
  });
});

test('production with an agreement and no key is key_required', () => {
  expect(decideUse({ purpose: 'production', feature, agreementSigned: true, licenseKey: null, now })).toEqual({
    allowed: false,
    reason: 'key_required',
  });
});

test('a value that is not a key does not allow production', () => {
  expect(
    decideUse({
      purpose: 'production',
      feature,
      agreementSigned: true,
      licenseKey: readLicenseKey({ ...rawKey, expiresAt: 'not-a-date' }),
      now,
    }),
  ).toEqual({ allowed: false, reason: 'key_required' });
});

test('a production key is allowed until its expiry instant and refused at that instant', () => {
  const expiresAt = new Date('2027-01-01T00:00:00.000Z');
  const licenseKey = key({ expiresAt });
  expect(
    decideUse({
      purpose: 'production',
      feature,
      agreementSigned: true,
      licenseKey,
      now: new Date(expiresAt.getTime() - 1),
    }),
  ).toEqual({ allowed: true });
  expect(decideUse({ purpose: 'production', feature, agreementSigned: true, licenseKey, now: expiresAt })).toEqual({
    allowed: false,
    reason: 'key_expired',
  });
});

test('a key issued for testing does not allow production', () => {
  expect(
    decideUse({
      purpose: 'production',
      feature,
      agreementSigned: true,
      licenseKey: key({ purpose: 'testing' }),
      now,
    }),
  ).toEqual({ allowed: false, reason: 'purpose_mismatch' });
});

test('a production key that omits the feature is feature_not_on_key', () => {
  expect(
    decideUse({
      purpose: 'production',
      feature: 'audit-trail',
      agreementSigned: true,
      licenseKey: key({ features: ['Audit-trail'] }),
      now,
    }),
  ).toEqual({ allowed: false, reason: 'feature_not_on_key' });
});

test('production is allowed when the agreement is signed and the key covers the feature', () => {
  expect(decideUse({ purpose: 'production', feature, agreementSigned: true, licenseKey: key(), now })).toEqual({
    allowed: true,
  });
});

test('development stays allowed when the only key is expired', () => {
  expect(
    decideUse({
      purpose: 'development',
      feature,
      agreementSigned: false,
      licenseKey: key({ expiresAt: new Date('2020-01-01T00:00:00.000Z'), purpose: 'production' }),
      now,
    }),
  ).toEqual({ allowed: true });
});

test('readLicenseKey accepts a key record and rejects a value that is not a key', () => {
  expect(readLicenseKey({ ...rawKey, note: 'ignored' })).toEqual({
    id: 'key-1',
    purpose: 'production',
    expiresAt: new Date('2027-01-01T00:00:00.000Z'),
    features: [feature],
  });
  expect(readLicenseKey(null)).toBeNull();
  expect(readLicenseKey(['key-1'])).toBeNull();
  expect(readLicenseKey({ id: 'key-1' })).toBeNull();
  expect(readLicenseKey({ ...rawKey, id: '   ' })).toBeNull();
  expect(readLicenseKey({ ...rawKey, purpose: 'staging' })).toBeNull();
  expect(readLicenseKey({ ...rawKey, features: [feature, 1] })).toBeNull();
});
