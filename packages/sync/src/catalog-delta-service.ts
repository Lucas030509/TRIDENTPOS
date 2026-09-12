/**
 * TRIDENTPOS Cloud Catalog Delta Service (WP-013)
 * Serves versioned catalog deltas for downstream Edge delta-pull synchronization.
 * Conforms to SYNC_AND_OFFLINE_ARCHITECTURE.md Sec. 4.
 */

import {
  AuthContext,
  CatalogDeltaEntity,
  CatalogDeltaRequest,
  CatalogDeltaResponse,
  computeCatalogDeltaChecksum,
} from '@trident/core';
import type { IDownstreamDeltaProvider } from './types.js';

export interface CatalogEntityRecord {
  readonly entityType: string;
  readonly entityId: string;
  readonly action: 'UPSERT' | 'DELETE';
  readonly data: Record<string, unknown>;
  readonly version: number;
}

export class CloudCatalogDeltaService implements IDownstreamDeltaProvider {
  readonly #catalogStore = new Map<string, CatalogEntityRecord[]>();
  #currentSnapshotVersion = 1;

  public setEntities(orgId: string, entities: CatalogEntityRecord[], snapshotVersion?: number): void {
    if (snapshotVersion !== undefined) {
      this.#currentSnapshotVersion = snapshotVersion;
    } else {
      this.#currentSnapshotVersion++;
    }
    this.#catalogStore.set(orgId, [...entities]);
  }

  public async getCatalogDeltas(
    auth: AuthContext,
    request: CatalogDeltaRequest,
  ): Promise<CatalogDeltaResponse> {
    const orgEntities = this.#catalogStore.get(auth.organizationId) ?? [];

    // Filter entities with version > sinceSnapshotVersion
    const filtered = orgEntities.filter((e) => e.version > request.sinceSnapshotVersion);

    if (request.categories && request.categories.length > 0) {
      // Optional category filtering
    }

    const entities: CatalogDeltaEntity[] = filtered.map((e) => ({
      entityType: e.entityType,
      entityId: e.entityId,
      action: e.action,
      data: e.data,
      version: e.version,
    }));

    const checksum = computeCatalogDeltaChecksum(entities);

    return {
      snapshotVersion: this.#currentSnapshotVersion,
      deltaVersion: entities.length > 0 ? Math.max(...entities.map((e) => e.version)) : request.sinceSnapshotVersion,
      checksum,
      entities,
      hasMore: false,
    };
  }
}
