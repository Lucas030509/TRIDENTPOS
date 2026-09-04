import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

export const DEFAULT_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/tridentpos_test';

/**
 * Sanitizes a connection string by replacing credentials with '***'
 * to prevent leaking secrets in logs or exception messages.
 */
export function sanitizeConnectionString(urlStr: string): string {
  try {
    const parsed = new URL(urlStr);
    if (parsed.password) {
      parsed.password = '***';
    }
    return parsed.toString();
  } catch {
    return '[REDACTED_DATABASE_URL]';
  }
}

/**
 * Resolves the active database connection string from environment or falls back
 * to the safe local disposable test database.
 */
export function resolveDatabaseUrl(): string {
  return process.env['DATABASE_URL'] || DEFAULT_DATABASE_URL;
}

let defaultPool: pg.Pool | null = null;

/**
 * Creates or retrieves the default PostgreSQL connection pool.
 */
export function getPool(connectionString?: string): pg.Pool {
  const url = connectionString || resolveDatabaseUrl();
  if (!defaultPool) {
    defaultPool = new pg.Pool({
      connectionString: url,
      max: 10,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000,
    });
  }
  return defaultPool;
}

/**
 * Creates a new dedicated connection pool (useful for isolated test harnesses).
 */
export function createDedicatedPool(connectionString?: string): pg.Pool {
  const url = connectionString || resolveDatabaseUrl();
  return new pg.Pool({
    connectionString: url,
    max: 5,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 5000,
  });
}

/**
 * Closes the provided pool or the default pool.
 */
export function closePool(pool?: pg.Pool): Promise<void> {
  const target = pool || defaultPool;
  if (target) {
    if (target === defaultPool) {
      defaultPool = null;
    }
    return target.end();
  }
  return Promise.resolve();
}

/**
 * Verifies connectivity to PostgreSQL and returns version metadata.
 */
export async function checkConnection(pool: pg.Pool): Promise<{
  connected: boolean;
  version: string;
  serverVersionNum: number;
}> {
  try {
    const result = await pool.query<{
      version: string;
      server_version_num: string;
    }>("SELECT version(), current_setting('server_version_num') AS server_version_num;");

    const row = result.rows[0];
    if (!row) {
      throw new Error('No result returned from PostgreSQL version query');
    }

    return {
      connected: true,
      version: row.version,
      serverVersionNum: parseInt(row.server_version_num, 10),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Database connection check failed: ${msg}`);
  }
}
