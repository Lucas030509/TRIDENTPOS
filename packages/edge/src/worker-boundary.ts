/**
 * TRIDENTPOS Edge Host Process Separation Scaffold
 * Satisfies ADR-003 Sec. 8 worker separation architecture without implementing prohibited hardware drivers.
 */

export type WorkerStatus = 'uninitialized' | 'running' | 'stopped' | 'error';

export interface WorkerHeartbeat {
  workerId: string;
  status: WorkerStatus;
  timestamp: number;
  uptimeSeconds: number;
  taskQueueDepth: number;
}

export interface WorkerSupervisorConfig {
  workerId: string;
  heartbeatIntervalMs?: number;
  maxQueueDepth?: number;
}

/**
 * Supervised background worker boundary abstraction.
 * Decouples heavy I/O, local LAN servers, and hardware operations from the
 * Electron main event loop and UI renderer thread per ADR-003 Sec. 8.
 */
export class EdgeWorkerSupervisor {
  private status: WorkerStatus = 'uninitialized';
  private startedAt = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private queueDepth = 0;

  constructor(private readonly config: WorkerSupervisorConfig) {}

  public start(): void {
    if (this.status === 'running') {
      return;
    }
    this.status = 'running';
    this.startedAt = Date.now();
    this.queueDepth = 0;
  }

  public stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.status = 'stopped';
    this.queueDepth = 0;
  }

  public getHeartbeat(): WorkerHeartbeat {
    const uptime = this.startedAt > 0 ? Math.floor((Date.now() - this.startedAt) / 1000) : 0;
    return {
      workerId: this.config.workerId,
      status: this.status,
      timestamp: Date.now(),
      uptimeSeconds: uptime,
      taskQueueDepth: this.queueDepth,
    };
  }

  public enqueueTask(): void {
    if (this.status !== 'running') {
      throw new Error(`Worker '${this.config.workerId}' is not running`);
    }
    const max = this.config.maxQueueDepth ?? 100;
    if (this.queueDepth >= max) {
      throw new Error(
        `Worker '${this.config.workerId}' queue depth exceeded max capacity of ${max}`,
      );
    }
    this.queueDepth++;
  }

  public completeTask(): void {
    if (this.queueDepth > 0) {
      this.queueDepth--;
    }
  }

  public getStatus(): WorkerStatus {
    return this.status;
  }
}
