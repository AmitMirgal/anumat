import { Hono } from 'hono';
import type { AppContext } from '../context';
import type { AppEnv } from './app';

export function v1(_ctx: AppContext) {
  return new Hono<AppEnv>();
}
