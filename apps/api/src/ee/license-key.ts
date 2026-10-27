export type UsePurpose = 'development' | 'testing' | 'production';

export type LicenseKeyRecord = {
  id: string;
  purpose: UsePurpose;
  expiresAt: Date;
  features: readonly string[];
};

export type UseRequest = {
  purpose: UsePurpose;
  feature: string;
  agreementSigned: boolean;
  licenseKey: LicenseKeyRecord | null;
  now: Date;
};

export type DenialReason =
  | 'agreement_required'
  | 'key_required'
  | 'key_expired'
  | 'purpose_mismatch'
  | 'feature_not_on_key';

export type UseDecision = { allowed: true } | { allowed: false; reason: DenialReason };

function isPurpose(value: unknown): value is UsePurpose {
  return value === 'development' || value === 'testing' || value === 'production';
}

export function readLicenseKey(raw: unknown): LicenseKeyRecord | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const { id, purpose, expiresAt, features } = record;
  if (typeof id !== 'string' || id.trim() === '') return null;
  if (!isPurpose(purpose)) return null;
  if (typeof expiresAt !== 'string') return null;
  const expiry = new Date(expiresAt);
  if (Number.isNaN(expiry.getTime())) return null;
  if (!Array.isArray(features)) return null;
  const names = features.filter((item): item is string => typeof item === 'string');
  if (names.length !== features.length) return null;
  return { id, purpose, expiresAt: expiry, features: names };
}

function decideProduction(request: UseRequest): UseDecision {
  if (!request.agreementSigned) return { allowed: false, reason: 'agreement_required' };
  const licenseKey = request.licenseKey;
  if (licenseKey === null) return { allowed: false, reason: 'key_required' };
  if (licenseKey.expiresAt.getTime() <= request.now.getTime()) return { allowed: false, reason: 'key_expired' };
  if (licenseKey.purpose !== 'production') return { allowed: false, reason: 'purpose_mismatch' };
  if (!licenseKey.features.includes(request.feature)) return { allowed: false, reason: 'feature_not_on_key' };
  return { allowed: true };
}

export function decideUse(request: UseRequest): UseDecision {
  switch (request.purpose) {
    case 'development':
    case 'testing':
      return { allowed: true };
    case 'production':
      return decideProduction(request);
    default: {
      const unreachable: never = request.purpose;
      return unreachable;
    }
  }
}
