export interface MigrationRecord {
  id: string;
  name: string;
  checksum: string;
  applied_at: Date;
  execution_order: number;
}

export interface MigrationFile {
  id: string;
  name: string;
  filename: string;
  filepath: string;
  checksum: string;
  upSql: string;
  downSql?: string;
}

export interface MigrationStatus {
  id: string;
  name: string;
  applied: boolean;
  appliedAt?: Date;
  executionOrder?: number;
  checksumMatches?: boolean;
}

export interface RunnerOptions {
  migrationsDir?: string;
  tableName?: string;
  allowDestructiveDown?: boolean;
}

export interface MigrationResult {
  applied: string[];
  alreadyUpToDate: boolean;
}

export interface RevertResult {
  reverted: string;
}
