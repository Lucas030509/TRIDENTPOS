/**
 * @trident/core - Principal & Identity Contracts
 *
 * Defines the canonical strongly-typed principal identity produced by
 * cryptographic token verification and database tenant context binding.
 */

export interface AuthenticatedPrincipal {
  /**
   * The canonical user UUID bound directly to the verified JWT subject (jwt.sub).
   * users.id IS the Supabase Auth subject UUID.
   */
  readonly userId: string;

  /**
   * Verified tenant organization UUID.
   */
  readonly organizationId: string;

  /**
   * Optional branch scope for branch-level operational sessions.
   */
  readonly branchId?: string | undefined;

  /**
   * Evaluated effective permissions derived strictly from active database roles.
   * Client-supplied claims are never trusted or mapped into permissions.
   */
  readonly permissions: readonly string[];
}
