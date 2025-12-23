/**
 * Task Queue - Priority queue for tasks
 */

import type { QueuedTask } from '../models/index.js';

export class TaskQueue {
  private queue: QueuedTask[] = [];

  /**
   * Add a task to the queue
   */
  enqueue(task: QueuedTask): void {
    // Insert in priority order (higher priority first)
    let inserted = false;
    for (let i = 0; i < this.queue.length; i++) {
      if (task.priority > this.queue[i].priority) {
        this.queue.splice(i, 0, task);
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      this.queue.push(task);
    }
  }

  /**
   * Remove and return the highest priority task
   */
  dequeue(): QueuedTask | undefined {
    return this.queue.shift();
  }

  /**
   * Peek at the highest priority task without removing it
   */
  peek(): QueuedTask | undefined {
    return this.queue[0];
  }

  /**
   * Check if queue is empty
   */
  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /**
   * Get queue size
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * Get all tasks (for debugging)
   */
  getAll(): QueuedTask[] {
    return [...this.queue];
  }

  /**
   * Remove a specific task by ID
   */
  remove(taskId: string): boolean {
    const index = this.queue.findIndex(t => t.id === taskId);
    if (index !== -1) {
      this.queue.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Clear all tasks
   */
  clear(): void {
    this.queue = [];
  }
}

export default TaskQueue;
