/**
 * @trident/database - Cloud IAM & Administrative Authentication Service
 *
 * Implements the critical safe tenant bootstrap sequence (Section 18),
 * branch context validation (Section 20), RBAC evaluation (Section 21),
 * and Cloud PIN provisioning/rotation/revocation (Section 23).
 *
 * Requirements:
 * - Never query `users` without tenant context (RLS default-deny).
 * - Candidate tenant context is ONLY a restrictive RLS scope until verified against users.id = jwt.sub.
 * - Transactions managed strictly with BEGIN / COMMIT / ROLLBACK and release in finally.
 * - Client-supplied role/permissions are strictly ignored.
 * - Plaintext PIN is NEVER stored, retained, or logged.
 */

import type pg from 'pg';
import {
  type AuthenticatedPrincipal,
  type JwtVerifierConfig,
  verifyAccessToken,
  isValidUuid,
  parseRolePermissions,
  hashBranchPin,
  ok,
  err,
  type Result,
} from '@trident/core';
import { setTenantContext } from './tenant.js';

export interface AuthenticateTenantRequest {
  readonly token: string;
  readonly candidateOrganizationId: string;
  readonly candidateBranchId?: string | undefined;
}

export type AuthenticationErrorCode =
  | 'INVALID_JWT'
  | 'INVALID_ORGANIZATION_UUID'
  | 'INVALID_BRANCH_UUID'
  | 'USER_NOT_FOUND_OR_INACTIVE'
  | 'TENANT_MISMATCH'
  | 'BRANCH_AUTHORIZATION_FAILED'
  | 'MALFORMED_ROLE_PERMISSIONS'
  | 'TRANSACTION_FAILED';

export class AuthenticationError extends Error {
  public readonly code: AuthenticationErrorCode;

  constructor(code: AuthenticationErrorCode, message: string) {
    super(`AUTH_ERROR [${code}]: ${message}`);
    this.name = 'AuthenticationError';
    this.code = code;
  }
}

export type PinProvisioningErrorCode =
  'INVALID_UUID' | 'HASHING_FAILED' | 'CREDENTIAL_NOT_FOUND' | 'PROVISIONING_FAILED';

export class PinProvisioningError extends Error {
  public readonly code: PinProvisioningErrorCode;

  constructor(code: PinProvisioningErrorCode, message: string) {
    super(`PIN_PROVISIONING_ERROR [${code}]: ${message}`);
    this.name = 'PinProvisioningError';
    this.code = code;
  }
}

/**
 * Authenticates a candidate principal using the governed Safe Tenant Bootstrap Sequence (Sec. 18):
 *
 * 1. Cryptographically verify JWT (signature, iss, aud, exp, nbf, sub UUID).
 * 2. Extract verified jwt.sub.
 * 3. Validate candidate organization ID syntax as UUID.
 * 4. Validate candidate branch ID syntax as UUID (if provided).
 * 5. Acquire connection and BEGIN PostgreSQL transaction.
 * 6. Set candidate tenant context transaction-locally (SELECT set_config('app.current_organization_id', $1, true)).
 * 7. Query `users` with BOTH id = verified jwt.sub AND organization_id = candidate organization AND is_active = TRUE.
 *    Because FORCE RLS is active, a wrong candidate tenant returns zero rows (tenant hopping rejected).
 * 8. If no active row, ROLLBACK and reject authentication.
 * 9. Only after this row match is candidate tenant validated.
 * 10. Query `user_roles` joined with `roles` in the SAME transaction/context.
 * 11. Evaluate `roles.permissions JSONB` (fail closed if malformed).
 * 12. Construct and return typed `AuthenticatedPrincipal`.
 */
export async function authenticateTenantPrincipal(
  pool: pg.Pool,
  request: AuthenticateTenantRequest,
  jwtConfig: JwtVerifierConfig,
): Promise<Result<AuthenticatedPrincipal, AuthenticationError>> {
  // 1. Cryptographic JWT validation
  const jwtResult = await verifyAccessToken(request.token, jwtConfig);
  if (!jwtResult.ok) {
    return err(new AuthenticationError('INVALID_JWT', jwtResult.error.message));
  }

  const verifiedSub = jwtResult.value.subject;

  // 2. Validate candidate organization UUID syntax
  if (!isValidUuid(request.candidateOrganizationId)) {
    return err(
      new AuthenticationError(
        'INVALID_ORGANIZATION_UUID',
        `Candidate organizationId '${request.candidateOrganizationId}' is not a valid UUID`,
      ),
    );
  }

  // 3. Validate candidate branch UUID syntax (if provided)
  if (request.candidateBranchId !== undefined && !isValidUuid(request.candidateBranchId)) {
    return err(
      new AuthenticationError(
        'INVALID_BRANCH_UUID',
        `Candidate branchId '${request.candidateBranchId}' is not a valid UUID`,
      ),
    );
  }

  // 4. Execute transactional verification with RLS tenant context
  const client = await pool.connect();
  try {
    await client.query('BEGIN;');

    // Restrictive RLS scope injection (is_local = true)
    await setTenantContext(client, request.candidateOrganizationId);

    // Query active user bound strictly to verified jwt.sub and candidate organization
    const userRes = await client.query<{
      id: string;
      organization_id: string;
      is_active: boolean;
    }>(
      `
      SELECT id, organization_id, is_active
      FROM users
      WHERE id = $1
        AND organization_id = $2
        AND is_active = TRUE;
      `,
      [verifiedSub, request.candidateOrganizationId],
    );

    if (userRes.rows.length === 0) {
      await client.query('ROLLBACK;');
      return err(
        new AuthenticationError(
          'USER_NOT_FOUND_OR_INACTIVE',
          'Principal identity does not match any active user in the requested tenant context',
        ),
      );
    }

    const verifiedUser = userRes.rows[0];
    if (!verifiedUser) {
      await client.query('ROLLBACK;');
      return err(
        new AuthenticationError('USER_NOT_FOUND_OR_INACTIVE', 'Active user row resolution failed'),
      );
    }

    // RBAC Resolution in the same tenant transaction
    const permissionSet = new Set<string>();

    if (request.candidateBranchId !== undefined) {
      // Branch-scoped role evaluation
      const roleRes = await client.query<{
        role_id: string;
        permissions: unknown;
      }>(
        `
        SELECT ur.role_id, r.permissions
        FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id AND r.organization_id = ur.organization_id
        WHERE ur.organization_id = $1
          AND ur.user_id = $2
          AND ur.branch_id = $3
          AND r.is_active = TRUE;
        `,
        [request.candidateOrganizationId, verifiedSub, request.candidateBranchId],
      );

      if (roleRes.rows.length === 0) {
        await client.query('ROLLBACK;');
        return err(
          new AuthenticationError(
            'BRANCH_AUTHORIZATION_FAILED',
            `User holds no active role assignment for branch '${request.candidateBranchId}'`,
          ),
        );
      }

      for (const row of roleRes.rows) {
        const parsed = parseRolePermissions(row.permissions);
        if (!parsed.ok) {
          await client.query('ROLLBACK;');
          return err(new AuthenticationError('MALFORMED_ROLE_PERMISSIONS', parsed.error.message));
        }
        for (const perm of parsed.value) {
          permissionSet.add(perm);
        }
      }
    } else {
      // Organization-level role evaluation (all assigned active roles)
      const roleRes = await client.query<{
        role_id: string;
        permissions: unknown;
      }>(
        `
        SELECT ur.role_id, r.permissions
        FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id AND r.organization_id = ur.organization_id
        WHERE ur.organization_id = $1
          AND ur.user_id = $2
          AND r.is_active = TRUE;
        `,
        [request.candidateOrganizationId, verifiedSub],
      );

      for (const row of roleRes.rows) {
        const parsed = parseRolePermissions(row.permissions);
        if (!parsed.ok) {
          await client.query('ROLLBACK;');
          return err(new AuthenticationError('MALFORMED_ROLE_PERMISSIONS', parsed.error.message));
        }
        for (const perm of parsed.value) {
          permissionSet.add(perm);
        }
      }
    }

    await client.query('COMMIT;');

    const principal: AuthenticatedPrincipal = {
      userId: verifiedSub,
      organizationId: verifiedUser.organization_id,
      branchId: request.candidateBranchId,
      permissions: Array.from(permissionSet),
    };

    return ok(principal);
  } catch (error: unknown) {
    try {
      await client.query('ROLLBACK;');
    } catch {
      // Preserve original error
    }
    const msg = error instanceof Error ? error.message : 'Database transaction failure';
    return err(new AuthenticationError('TRANSACTION_FAILED', msg));
  } finally {
    client.release();
  }
}

/**
 * Provisions a branch operational PIN credential in Cloud PostgreSQL.
 * Plaintext PIN is hashed with Argon2id and never persisted.
 */
export async function provisionBranchPinCredential(
  client: pg.PoolClient,
  params: {
    organizationId: string;
    userId: string;
    branchId: string;
    pin: string;
  },
): Promise<Result<{ id: string; credentialVersion: number }, PinProvisioningError>> {
  if (
    !isValidUuid(params.organizationId) ||
    !isValidUuid(params.userId) ||
    !isValidUuid(params.branchId)
  ) {
    return err(
      new PinProvisioningError('INVALID_UUID', 'Malformed UUID parameter for PIN provisioning'),
    );
  }

  const hashResult = await hashBranchPin(params.pin);
  if (!hashResult.ok) {
    return err(new PinProvisioningError('HASHING_FAILED', hashResult.error.message));
  }

  try {
    const res = await client.query<{ id: string; credential_version: number }>(
      `
      INSERT INTO user_branch_credentials (
        organization_id,
        user_id,
        branch_id,
        pin_hash,
        credential_version,
        is_revoked
      )
      VALUES ($1, $2, $3, $4, 1, FALSE)
      RETURNING id, credential_version;
      `,
      [params.organizationId, params.userId, params.branchId, hashResult.value],
    );

    const row = res.rows[0];
    if (!row) {
      return err(
        new PinProvisioningError('PROVISIONING_FAILED', 'Failed to insert credential record'),
      );
    }

    return ok({ id: row.id, credentialVersion: row.credential_version });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Database query failure';
    return err(new PinProvisioningError('PROVISIONING_FAILED', msg));
  }
}

/**
 * Rotates an existing branch operational PIN credential.
 * Atomically increments credential_version, replaces pin_hash, un-revokes, and updates updated_at.
 */
export async function rotateBranchPinCredential(
  client: pg.PoolClient,
  params: {
    organizationId: string;
    userId: string;
    branchId: string;
    newPin: string;
  },
): Promise<Result<{ credentialVersion: number }, PinProvisioningError>> {
  if (
    !isValidUuid(params.organizationId) ||
    !isValidUuid(params.userId) ||
    !isValidUuid(params.branchId)
  ) {
    return err(
      new PinProvisioningError('INVALID_UUID', 'Malformed UUID parameter for PIN rotation'),
    );
  }

  const hashResult = await hashBranchPin(params.newPin);
  if (!hashResult.ok) {
    return err(new PinProvisioningError('HASHING_FAILED', hashResult.error.message));
  }

  try {
    const res = await client.query<{ credential_version: number }>(
      `
      UPDATE user_branch_credentials
      SET pin_hash = $4,
          credential_version = credential_version + 1,
          is_revoked = FALSE,
          updated_at = NOW()
      WHERE organization_id = $1
        AND user_id = $2
        AND branch_id = $3
      RETURNING credential_version;
      `,
      [params.organizationId, params.userId, params.branchId, hashResult.value],
    );

    const row = res.rows[0];
    if (!row) {
      return err(
        new PinProvisioningError(
          'CREDENTIAL_NOT_FOUND',
          'No existing credential record found to rotate for this user/branch',
        ),
      );
    }

    return ok({ credentialVersion: row.credential_version });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Database query failure';
    return err(new PinProvisioningError('PROVISIONING_FAILED', msg));
  }
}

/**
 * Revokes a branch operational PIN credential.
 */
export async function revokeBranchPinCredential(
  client: pg.PoolClient,
  params: {
    organizationId: string;
    userId: string;
    branchId: string;
  },
): Promise<Result<void, PinProvisioningError>> {
  if (
    !isValidUuid(params.organizationId) ||
    !isValidUuid(params.userId) ||
    !isValidUuid(params.branchId)
  ) {
    return err(
      new PinProvisioningError('INVALID_UUID', 'Malformed UUID parameter for PIN revocation'),
    );
  }

  try {
    const res = await client.query(
      `
      UPDATE user_branch_credentials
      SET is_revoked = TRUE,
          updated_at = NOW()
      WHERE organization_id = $1
        AND user_id = $2
        AND branch_id = $3;
      `,
      [params.organizationId, params.userId, params.branchId],
    );

    if ((res.rowCount ?? 0) === 0) {
      return err(
        new PinProvisioningError(
          'CREDENTIAL_NOT_FOUND',
          'No credential found to revoke for this user/branch',
        ),
      );
    }

    return ok(undefined);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Database query failure';
    return err(new PinProvisioningError('PROVISIONING_FAILED', msg));
  }
}
