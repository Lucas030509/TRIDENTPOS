import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Sanitizes a connection string by replacing password credentials with '***'
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
 * Resolves the active database connection string from the environment.
 * There is deliberately no implicit fallback database: migration execution must
 * always declare its target explicitly to prevent accidental writes.
 */
export function resolveDatabaseUrl(): string {
  const url = process.env['DATABASE_URL']?.trim();
  if (!url) {
    throw new Error(
      'DATABASE_URL is required. Refusing to select an implicit database target for migrations.',
    );
  }
  return url;
}

let defaultPool: pg.Pool | null = null;
let defaultPoolUrl: string | null = null;

/**
 * Creates or retrieves the default PostgreSQL connection pool.
 * A second request with a different connection target is rejected to avoid
 * silently reusing a pool connected to the wrong database.
 */
export function getPool(connectionString?: string): pg.Pool {
  const url = connectionString || resolveDatabaseUrl();
  if (defaultPool) {
    if (defaultPoolUrl !== url) {
      throw new Error(
        'Default database pool is already initialized for a different target. Close it before changing DATABASE_URL.',
      );
    }
    return defaultPool;
  }

  defaultPool = new pg.Pool({
    connectionString: url,
    max: 10,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
  });
  defaultPoolUrl = url;
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
      defaultPoolUrl = null;
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
