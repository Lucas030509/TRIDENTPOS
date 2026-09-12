/**
 * TRIDENTPOS Sync Package Contracts & DTOs
 * Conforms to SYNC_AND_OFFLINE_ARCHITECTURE.md Sec. 1, 3, IMPLEMENTATION_PLAN.md WP-011.
 */

import { CloudFolioLeaseStatus, FolioType } from '@trident/core';

export interface FolioLeaseRequestDTO {
  readonly folioType: FolioType;
  readonly requestedBlockSize?: number;
}

export interface FolioLeaseResponseDTO {
  readonly id: string;
  readonly organizationId: string;
  readonly branchId: string;
  readonly folioType: FolioType;
  readonly epochId: string;
  readonly fencingToken: string;
  readonly rangeStart: number;
  readonly rangeEnd: number;
  readonly highWaterMark: number;
  readonly status: CloudFolioLeaseStatus;
  readonly allocatedAt: string;
}

export interface FolioHeartbeatRequestDTO {
  readonly leaseId: string;
  readonly folioType: FolioType;
  readonly epochId: string;
  readonly fencingToken: string;
  readonly currentFolio: number;
}

export interface FolioHeartbeatResponseDTO {
  readonly status: 'ACK';
  readonly leaseId: string;
  readonly highWaterMark: number;
  readonly activeEpoch: string;
}

export interface AuthContext {
  readonly organizationId: string;
  readonly branchId: string;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

export interface ICloudLeaseService {
  allocateLease(options: {
    organizationId: string;
    branchId: string;
    folioType: FolioType;
    requestedBlockSize?: number;
    isDisasterRecoveryReplacement?: boolean;
  }): Promise<{
    id: string;
    organizationId: string;
    branchId: string;
    folioType: FolioType;
    epochId: string;
    fencingToken: string;
    rangeStart: number;
    rangeEnd: number;
    highWaterMark: number;
    status: CloudFolioLeaseStatus;
    allocatedAt: Date;
    revokedAt: Date | null;
    abandonedAt: Date | null;
    reconciledAt: Date | null;
  }>;

  heartbeat(options: {
    organizationId: string;
    branchId: string;
    leaseId: string;
    folioType: FolioType;
    epochId: string;
    fencingToken: string;
    currentFolio: number;
  }): Promise<{
    status: 'ACK';
    leaseId: string;
    highWaterMark: number;
    activeEpoch: string;
  }>;
}
