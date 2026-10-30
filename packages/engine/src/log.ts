import { pino } from 'pino';

const options = {
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'anumat' },
};

export const log =
  process.env.ANUMAT_ENGINE_SIDECAR === '1' ? pino(options, pino.destination(process.stderr.fd)) : pino(options);
