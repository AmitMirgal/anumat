import { pino } from 'pino';

const options = {
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'anumat' },
};

const stderr = pino.destination({ dest: process.stderr.fd, sync: true, minLength: 0 });

export const log = pino(options, stderr);
