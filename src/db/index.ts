import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
}

export const createPool = () => {
  if (!global._postgresPool) {
    global._postgresPool = new Pool({
      host: process.env.SQL_HOST,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DB_NAME,
      max: 10,
      idleTimeoutMillis: 20000,
      connectionTimeoutMillis: 20000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    });

    global._postgresPool.on('error', (err) => {
      console.error('Unexpected error on idle SQL pool client:', err);
    });
  }
  return global._postgresPool;
};

const pool = createPool();

export const db = drizzle(pool, { schema });

export function isTransientDbError(error: unknown): boolean {
  const errObj = error as { message?: string; code?: string; cause?: { message?: string; code?: string } } | null;
  const code = String(errObj?.code ?? errObj?.cause?.code ?? '');
  const msg =
    error instanceof Error
      ? `${error.message} ${String(errObj?.cause?.message ?? errObj?.cause ?? '')}`
      : String(error ?? '');
  return (
    ['57P01', '57P02', '57P03', '08000', '08003', '08006', 'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT'].includes(code) ||
    msg.includes('ENOENT') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('EPIPE') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('socket hang up') ||
    msg.includes('Connection terminated') ||
    msg.includes('57P01') ||
    msg.includes('timeout')
  );
}

export async function withDbRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts && isTransientDbError(err)) {
        await new Promise((r) => setTimeout(r, attempt * 400));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}
