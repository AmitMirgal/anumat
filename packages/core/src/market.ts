export const MARKET_IDS = ['us'] as const;

export type MarketId = (typeof MARKET_IDS)[number];
