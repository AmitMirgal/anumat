import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from './generated/prisma/client';

export function connect(databaseUrl: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString: databaseUrl, max: 10 });
  return new PrismaClient({ adapter });
}

export type Db = PrismaClient;
export type Tx = Prisma.TransactionClient;

export function jsonInput(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

export function uniqueViolation(error: unknown): string | undefined {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    if ('code' in current && current.code === '23505') {
      if ('constraint' in current && typeof current.constraint === 'string') return current.constraint;
      if ('constraint_name' in current && typeof current.constraint_name === 'string') return current.constraint_name;
      return 'unique';
    }
    if ('code' in current && current.code === 'P2002') {
      const meta = 'meta' in current && current.meta && typeof current.meta === 'object' ? current.meta : undefined;
      const target = meta && 'target' in meta ? meta.target : undefined;
      if (typeof target === 'string') return target;
      if (Array.isArray(target) && target.every((item) => typeof item === 'string')) return target.join(',');
      return 'unique';
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  return undefined;
}
