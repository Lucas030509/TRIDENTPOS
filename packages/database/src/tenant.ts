import type pg from 'pg';

/**
 * Sets the transaction-local tenant context using PostgreSQL parameterized set_config.
 *
 * This is the safe, parameterized equivalent of `SET LOCAL app.current_organization_id`.
 * Because `is_local` is set to `true`, the configuration parameter automatically reverts
 * at transaction end (COMMIT or ROLLBACK), preventing context leakage across pooled connections.
 *
 * @param client Connected PostgreSQL pool client with an active transaction
 * @param organizationId Tenant organization UUID
 */
export async function setTenantContext(
  client: pg.PoolClient,
  organizationId: string,
): Promise<void> {
  await client.query("SELECT set_config('app.current_organization_id', $1, true);", [
    organizationId,
  ]);
}

/**
 * Executes a callback within a database transaction scoped strictly to a tenant organization.
 *
 * Automatically manages BEGIN, transaction-local tenant context injection, COMMIT,
 * ROLLBACK on failure, and connection release back to the pool.
 *
 * @param pool PostgreSQL Pool instance
 * @param organizationId Tenant organization UUID
 * @param callback Callback receiving the tenant-scoped client
 */
export async function withTenantTransaction<T>(
  pool: pg.Pool,
  organizationId: string,
  callback: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN;');
    await setTenantContext(client, organizationId);
    const result = await callback(client);
    await client.query('COMMIT;');
    return result;
  } catch (error) {
    await client.query('ROLLBACK;');
    throw error;
  } finally {
    client.release();
  }
}
