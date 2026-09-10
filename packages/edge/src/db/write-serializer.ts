/**
 * TRIDENTPOS Edge Write Serializer
 * Serializes concurrent write operations to prevent avoidable SQLITE_BUSY lockouts
 * while preserving transactional ordering per ADR-004 Sec. 7 and WP-008 Sec. 11.
 */

import { EdgeDatabaseError } from './types.js';

export interface WriteSerializerOptions {
  /**
   * Maximum allowed pending writes in queue before rejecting new submissions.
   * Defaults to 1000.
   */
  maxQueueDepth?: number;
}

interface QueuedTask<T> {
  task: () => Promise<T> | T;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason: unknown) => void;
}

export class WriteSerializer {
  private queue: Array<QueuedTask<unknown>> = [];
  private isProcessing = false;
  private readonly maxQueueDepth: number;

  constructor(options: WriteSerializerOptions = {}) {
    this.maxQueueDepth = options.maxQueueDepth ?? 1000;
  }

  /**
   * Enqueues a write operation to be executed sequentially in FIFO order.
   * Guarantees that only one write executes at any given time.
   */
  public serialize<T>(operation: () => Promise<T> | T): Promise<T> {
    if (typeof operation !== 'function') {
      return Promise.reject(new EdgeDatabaseError('Serialized write operation must be a function'));
    }

    if (this.queue.length >= this.maxQueueDepth) {
      return Promise.reject(
        new EdgeDatabaseError(
          `Write serializer queue depth exceeded maximum capacity of ${this.maxQueueDepth}`,
        ),
      );
    }

    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        task: operation as () => Promise<unknown> | unknown,
        resolve: resolve as (value: unknown) => void,
        reject,
      });

      this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) {
        break;
      }

      try {
        const result = await item.task();
        item.resolve(result);
      } catch (err) {
        // Error propagation: do not swallow or silently retry
        item.reject(err);
      }
    }

    this.isProcessing = false;
  }

  public getPendingCount(): number {
    return this.queue.length;
  }

  public isBusy(): boolean {
    return this.isProcessing;
  }

  public clear(): void {
    const error = new EdgeDatabaseError('Write serializer cleared: pending operations aborted');
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      item?.reject(error);
    }
    this.isProcessing = false;
  }
}
