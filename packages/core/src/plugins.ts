export type AuditAction = 'proposed' | 'approved' | 'rejected';

export type AuditRecord = {
  action: AuditAction;
  versionId: string;
  actor: string;
  policyKey: string;
};

export interface AuditSink {
  record(event: AuditRecord): Promise<void>;
}

export const noopAuditSink: AuditSink = {
  async record() {},
};

export interface AuthProvider {
  authenticate(authorization: string | undefined): Promise<{ principal: string } | undefined>;
}

export interface ReviewPolicy {
  allowsPublish(input: { policyKey: string; actor: string }): boolean;
}

export const oneApproval: ReviewPolicy = {
  allowsPublish: () => true,
};

export type RuleUpdate = { sourceId: string };

export interface RuleFeedSource {
  id: string;
  listUpdates(): Promise<RuleUpdate[]>;
}

export const localRuleFeed: RuleFeedSource = {
  id: 'local',
  async listUpdates() {
    return [];
  },
};

export interface Connector {
  id: string;
}

export type EnginePlugins = {
  audit: AuditSink;
  review: ReviewPolicy;
  ruleFeeds: RuleFeedSource[];
  connectors: Connector[];
};

export function resolveEnginePlugins(overrides?: Partial<EnginePlugins>): EnginePlugins {
  return {
    audit: overrides?.audit ?? noopAuditSink,
    review: overrides?.review ?? oneApproval,
    ruleFeeds: overrides?.ruleFeeds ?? [localRuleFeed],
    connectors: overrides?.connectors ?? [],
  };
}
