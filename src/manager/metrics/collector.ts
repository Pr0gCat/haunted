import type { Supervisor } from "@/manager/supervisor.ts";
import type {
  GlobalMetrics,
  InstanceMetricsSnapshot,
  MetricsResponse,
} from "@/manager/metrics/types.ts";
import { createLogger } from "@/utils/logger.ts";

export class MetricsCollector {
  private supervisor: Supervisor;
  private startTime: Date;
  private collectInterval: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private logger = createLogger("metrics");

  constructor(supervisor: Supervisor, collectIntervalSeconds: number = 30) {
    this.supervisor = supervisor;
    this.startTime = new Date();
    this.collectInterval = collectIntervalSeconds * 1000;
  }

  start(): void {
    if (this.timer) return;

    this.timer = setInterval(() => {
      this.collect();
    }, this.collectInterval);

    this.logger.info(
      { interval: this.collectInterval },
      "Metrics collector started"
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getAll(): MetricsResponse {
    const states = this.supervisor.getAllStates();

    const global: GlobalMetrics = {
      totalInstances: states.length,
      runningInstances: states.filter((s) => s.status === "running").length,
      stoppedInstances: states.filter((s) => s.status === "stopped").length,
      crashedInstances: states.filter((s) => s.status === "crashed").length,
      totalIssuesProcessed: states.reduce(
        (sum, s) => sum + s.metrics.issuesProcessed,
        0
      ),
      totalPRsProcessed: states.reduce(
        (sum, s) => sum + s.metrics.prsProcessed,
        0
      ),
      totalErrors: states.reduce((sum, s) => sum + s.metrics.errors, 0),
      uptimeSeconds: Math.floor(
        (Date.now() - this.startTime.getTime()) / 1000
      ),
    };

    const instances: InstanceMetricsSnapshot[] = states.map((state) => ({
      id: state.id,
      name: state.name,
      status: state.status,
      uptime: state.metrics.uptime,
      restartCount: state.metrics.restartCount,
      issuesProcessed: state.metrics.issuesProcessed,
      prsProcessed: state.metrics.prsProcessed,
      activeWorkers: state.metrics.activeWorkers,
      errors: state.metrics.errors,
      memoryUsage: state.metrics.memoryUsage,
    }));

    return {
      global,
      instances,
      collectedAt: new Date().toISOString(),
    };
  }

  getInstanceMetrics(id: string): InstanceMetricsSnapshot | null {
    const instance = this.supervisor.getInstance(id);
    if (!instance) return null;

    const state = instance.getState();
    return {
      id: state.id,
      name: state.name,
      status: state.status,
      uptime: state.metrics.uptime,
      restartCount: state.metrics.restartCount,
      issuesProcessed: state.metrics.issuesProcessed,
      prsProcessed: state.metrics.prsProcessed,
      activeWorkers: state.metrics.activeWorkers,
      errors: state.metrics.errors,
      memoryUsage: state.metrics.memoryUsage,
    };
  }

  private collect(): void {
    // 這裡可以擴展為將指標寫入時序資料庫
    const metrics = this.getAll();
    this.logger.debug({ metrics }, "Metrics collected");
  }
}
