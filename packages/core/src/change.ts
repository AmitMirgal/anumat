export type Change = {
  field: string;
  kind: 'added' | 'removed' | 'changed';
  key?: string;
  before?: unknown;
  after?: unknown;
};
