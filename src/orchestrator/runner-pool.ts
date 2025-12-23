/**
 * Runner Pool - Manages multiple concurrent runners
 */

import EventEmitter from 'events';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';
import type { RunnerState } from '../models/index.js';

export class RunnerPool extends EventEmitter {
  private maxRunners: number;
  private runners: Map<string, RunnerState> = new Map();
  private activeCount_: number = 0;

  constructor(maxRunners: number = 3) {
    super();
    this.maxRunners = maxRunners;
  }

  /**
   * Check if pool has capacity for more tasks
   */
  hasCapacity(): boolean {
    return this.activeCount_ < this.maxRunners;
  }

  /**
   * Get current active runner count
   */
  activeCount(): number {
    return this.activeCount_;
  }

  /**
   * Execute a task in an available runner
   */
  async execute(task: (runnerId: string) => Promise<void>): Promise<void> {
    if (!this.hasCapacity()) {
      throw new Error('No available runners');
    }

    const runnerId = uuidv4().slice(0, 8);

    const runner: RunnerState = {
      id: runnerId,
      status: 'busy',
      startedAt: new Date(),
    };

    this.runners.set(runnerId, runner);
    this.activeCount_++;
    this.emit('runner-busy', runnerId);

    try {
      await task(runnerId);
      runner.status = 'idle';
    } catch (error) {
      runner.status = 'error';
      logger.error(`Runner ${runnerId} encountered error:`, error);
    } finally {
      this.runners.delete(runnerId);
      this.activeCount_--;
      this.emit('runner-idle', runnerId);
    }
  }

  /**
   * Wait for all runners to complete
   */
  async waitForAll(): Promise<void> {
    while (this.activeCount_ > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * Get all runner states
   */
  getRunners(): RunnerState[] {
    return Array.from(this.runners.values());
  }
}

export default RunnerPool;
