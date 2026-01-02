export interface GlobalMetrics {
  totalInstances: number;
  runningInstances: number;
  stoppedInstances: number;
  crashedInstances: number;
  totalIssuesProcessed: number;
  totalPRsProcessed: number;
  totalErrors: number;
  uptimeSeconds: number;
}

export interface InstanceMetricsSnapshot {
  id: string;
  name: string;
  status: string;
  uptime: number;
  restartCount: number;
  issuesProcessed: number;
  prsProcessed: number;
  activeWorkers: number;
  errors: number;
  memoryUsage?: number;
}

export interface MetricsResponse {
  global: GlobalMetrics;
  instances: InstanceMetricsSnapshot[];
  collectedAt: string;
}
