import { Instance, type InstanceRunConfig, type InstanceState } from "@/manager/instance.ts";
import { createLogger } from "@/utils/logger.ts";

export interface SupervisorOptions {
  autoRestart: boolean;
  maxRestarts: number;
  restartWindow: number; // minutes
  healthCheckInterval: number; // seconds
}

interface RestartTracker {
  count: number;
  firstRestartAt: Date;
}

export class Supervisor {
  private instances: Map<string, Instance> = new Map();
  private restartTrackers: Map<string, RestartTracker> = new Map();
  private options: SupervisorOptions;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private logger = createLogger("supervisor");

  constructor(options: SupervisorOptions) {
    this.options = options;
  }

  async addInstance(instanceConfig: InstanceRunConfig): Promise<void> {
    if (this.instances.has(instanceConfig.id)) {
      throw new Error(`Instance ${instanceConfig.id} already exists`);
    }

    const instance = new Instance(instanceConfig);

    // 設置事件監聽
    instance.on("status", (status) => {
      this.logger.info({ id: instanceConfig.id, status }, "Instance status changed");
    });

    instance.on("exit", (code) => {
      this.handleInstanceExit(instanceConfig.id, code);
    });

    instance.on("error", (error) => {
      this.logger.error({ id: instanceConfig.id, error }, "Instance error");
    });

    this.instances.set(instanceConfig.id, instance);
    this.logger.info({ id: instanceConfig.id }, "Instance added");
  }

  async removeInstance(id: string): Promise<void> {
    const instance = this.instances.get(id);
    if (!instance) {
      throw new Error(`Instance ${id} not found`);
    }

    await instance.stop();
    this.instances.delete(id);
    this.restartTrackers.delete(id);
    this.logger.info({ id }, "Instance removed");
  }

  async startInstance(id: string): Promise<void> {
    const instance = this.instances.get(id);
    if (!instance) {
      throw new Error(`Instance ${id} not found`);
    }
    await instance.start();
  }

  async stopInstance(id: string): Promise<void> {
    const instance = this.instances.get(id);
    if (!instance) {
      throw new Error(`Instance ${id} not found`);
    }
    await instance.stop();
  }

  async restartInstance(id: string): Promise<void> {
    const instance = this.instances.get(id);
    if (!instance) {
      throw new Error(`Instance ${id} not found`);
    }
    await instance.restart();
  }

  async startAll(): Promise<void> {
    const startPromises = Array.from(this.instances.entries()).map(
      async ([id, instance]) => {
        try {
          await instance.start();
        } catch (error) {
          this.logger.error({ id, error }, "Failed to start instance");
        }
      }
    );

    await Promise.all(startPromises);
    this.startHealthCheck();
  }

  async stopAll(): Promise<void> {
    this.stopHealthCheck();

    const stopPromises = Array.from(this.instances.values()).map((instance) =>
      instance.stop()
    );

    await Promise.all(stopPromises);
  }

  getInstance(id: string): Instance | undefined {
    return this.instances.get(id);
  }

  getAllInstances(): Instance[] {
    return Array.from(this.instances.values());
  }

  getAllStates(): InstanceState[] {
    return Array.from(this.instances.values()).map((instance) =>
      instance.getState()
    );
  }

  getInstanceLogs(id: string, limit?: number, offset?: number): string[] {
    const instance = this.instances.get(id);
    if (!instance) {
      throw new Error(`Instance ${id} not found`);
    }
    return instance.getLogs(limit, offset);
  }

  private async handleInstanceExit(id: string, code: number): Promise<void> {
    if (!this.options.autoRestart || code === 0) {
      return;
    }

    const tracker = this.getOrCreateRestartTracker(id);
    const now = new Date();
    const windowMs = this.options.restartWindow * 60 * 1000;

    // 檢查是否在窗口內
    if (now.getTime() - tracker.firstRestartAt.getTime() > windowMs) {
      // 重置追蹤器
      tracker.count = 0;
      tracker.firstRestartAt = now;
    }

    tracker.count++;

    if (tracker.count > this.options.maxRestarts) {
      this.logger.error(
        { id, restarts: tracker.count, window: this.options.restartWindow },
        "Instance exceeded max restarts, not restarting"
      );
      return;
    }

    this.logger.info(
      { id, restartCount: tracker.count },
      "Auto-restarting instance"
    );

    // 延遲重啟，避免快速循環崩潰（指數退避）
    const delay = 1000 * tracker.count;
    setTimeout(async () => {
      try {
        await this.startInstance(id);
      } catch (error) {
        this.logger.error({ id, error }, "Failed to auto-restart instance");
      }
    }, delay);
  }

  private getOrCreateRestartTracker(id: string): RestartTracker {
    let tracker = this.restartTrackers.get(id);
    if (!tracker) {
      tracker = { count: 0, firstRestartAt: new Date() };
      this.restartTrackers.set(id, tracker);
    }
    return tracker;
  }

  private startHealthCheck(): void {
    if (this.healthCheckTimer) return;

    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck();
    }, this.options.healthCheckInterval * 1000);
  }

  private stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  private performHealthCheck(): void {
    for (const [id, instance] of this.instances) {
      const state = instance.getState();

      // 檢查 running 狀態但沒有 PID 的異常情況
      if (state.status === "running" && !state.pid) {
        this.logger.warn(
          { id },
          "Instance claims running but no PID, marking as crashed"
        );
        // 觸發重啟邏輯
        this.handleInstanceExit(id, 1);
      }
    }
  }
}
