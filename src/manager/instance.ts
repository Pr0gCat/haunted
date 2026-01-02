import { spawn, type Subprocess } from "bun";
import { EventEmitter } from "events";
import { createLogger } from "@/utils/logger.ts";

export type InstanceStatus =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "crashed"
  | "error";

export interface InstanceRunConfig {
  id: string;
  name: string;
  enabled: boolean;
  configFile?: string;
  config?: unknown;
  workingDir: string;
  env?: Record<string, string>;
}

export interface InstanceMetrics {
  uptime: number;
  restartCount: number;
  lastRestartAt?: Date;
  memoryUsage?: number;
  issuesProcessed: number;
  prsProcessed: number;
  activeWorkers: number;
  errors: number;
}

export interface InstanceState {
  id: string;
  name: string;
  status: InstanceStatus;
  pid?: number;
  startedAt?: Date;
  stoppedAt?: Date;
  metrics: InstanceMetrics;
}

export interface InstanceEvents {
  status: [status: InstanceStatus];
  started: [data: { pid: number }];
  stopped: [];
  exit: [code: number];
  error: [error: Error];
  log: [data: { type: "stdout" | "stderr"; line: string }];
}

export class Instance extends EventEmitter<InstanceEvents> {
  private config: InstanceRunConfig;
  private process: Subprocess | null = null;
  private status: InstanceStatus = "stopped";
  private logBuffer: string[] = [];
  private maxLogLines: number;
  private metrics: InstanceMetrics;
  private logger;
  private startedAt?: Date;

  constructor(config: InstanceRunConfig, options: { maxLogLines?: number } = {}) {
    super();
    this.config = config;
    this.maxLogLines = options.maxLogLines ?? 1000;
    this.logger = createLogger(`instance:${config.id}`);
    this.metrics = {
      uptime: 0,
      restartCount: 0,
      issuesProcessed: 0,
      prsProcessed: 0,
      activeWorkers: 0,
      errors: 0,
    };
  }

  get id(): string {
    return this.config.id;
  }

  get name(): string {
    return this.config.name;
  }

  async start(): Promise<void> {
    if (this.status === "running" || this.status === "starting") {
      throw new Error(`Instance ${this.config.id} is already ${this.status}`);
    }

    this.status = "starting";
    this.emit("status", this.status);

    const args = ["run", "src/index.ts"];

    // 設置環境變數
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...this.config.env,
      HAUNTED_INSTANCE_ID: this.config.id,
    };

    if (this.config.configFile) {
      env.HAUNTED_CONFIG_PATH = this.config.configFile;
    }

    try {
      this.process = spawn({
        cmd: ["bun", ...args],
        cwd: this.config.workingDir,
        env,
        stdout: "pipe",
        stderr: "pipe",
      });

      this.status = "running";
      this.startedAt = new Date();
      this.emit("status", this.status);
      this.emit("started", { pid: this.process.pid });

      // 收集 stdout/stderr
      if (this.process.stdout && typeof this.process.stdout !== "number") {
        this.collectOutput(this.process.stdout, "stdout");
      }
      if (this.process.stderr && typeof this.process.stderr !== "number") {
        this.collectOutput(this.process.stderr, "stderr");
      }

      // 監聽進程結束
      this.process.exited.then((code) => {
        this.handleExit(code);
      });

      this.logger.info({ pid: this.process.pid }, "Instance started");
    } catch (error) {
      this.status = "error";
      this.emit("status", this.status);
      this.emit("error", error as Error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.process || this.status === "stopped") {
      return;
    }

    this.status = "stopping";
    this.emit("status", this.status);

    // 發送 SIGTERM
    this.process.kill("SIGTERM");

    // 等待優雅關閉，超時後強制終止
    const timeout = setTimeout(() => {
      if (this.process) {
        this.process.kill("SIGKILL");
      }
    }, 10000);

    await this.process.exited;
    clearTimeout(timeout);

    this.status = "stopped";
    this.emit("status", this.status);
    this.emit("stopped");
    this.logger.info("Instance stopped");
  }

  async restart(): Promise<void> {
    await this.stop();
    this.metrics.restartCount++;
    this.metrics.lastRestartAt = new Date();
    await this.start();
  }

  getState(): InstanceState {
    const uptime =
      this.startedAt && this.status === "running"
        ? Math.floor((Date.now() - this.startedAt.getTime()) / 1000)
        : 0;

    return {
      id: this.config.id,
      name: this.config.name,
      status: this.status,
      pid: this.process?.pid,
      startedAt: this.startedAt,
      stoppedAt: this.status === "stopped" ? new Date() : undefined,
      metrics: { ...this.metrics, uptime },
    };
  }

  getLogs(limit: number = 100, offset: number = 0): string[] {
    const start = Math.max(0, this.logBuffer.length - limit - offset);
    const end = this.logBuffer.length - offset;
    return this.logBuffer.slice(start, end);
  }

  getLogBuffer(): string[] {
    return [...this.logBuffer];
  }

  clearLogs(): void {
    this.logBuffer = [];
  }

  private async collectOutput(
    stream: ReadableStream<Uint8Array> | null,
    type: "stdout" | "stderr"
  ): Promise<void> {
    if (!stream) return;

    const reader = stream.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        const lines = text.split("\n").filter(Boolean);

        for (const line of lines) {
          const logLine = `[${new Date().toISOString()}] [${type}] ${line}`;
          this.logBuffer.push(logLine);
          this.emit("log", { type, line: logLine });

          // 解析指標資訊
          this.parseMetricsFromLog(line);
        }

        // 限制 buffer 大小
        while (this.logBuffer.length > this.maxLogLines) {
          this.logBuffer.shift();
        }
      }
    } catch (error) {
      this.logger.error({ error }, "Error reading output stream");
    }
  }

  private parseMetricsFromLog(line: string): void {
    // 解析 pino JSON 日誌中的指標
    try {
      const log = JSON.parse(line);
      if (log.issueNumber && log.msg?.includes("completed")) {
        this.metrics.issuesProcessed++;
      }
      if (log.prNumber && log.msg?.includes("created")) {
        this.metrics.prsProcessed++;
      }
      if (log.level >= 50) {
        // error level
        this.metrics.errors++;
      }
      if (typeof log.activeWorkers === "number") {
        this.metrics.activeWorkers = log.activeWorkers;
      }
    } catch {
      // 非 JSON 日誌，忽略
    }
  }

  private handleExit(code: number): void {
    this.process = null;

    if (this.status === "stopping") {
      this.status = "stopped";
    } else {
      this.status = "crashed";
      this.logger.error({ code }, "Instance crashed unexpectedly");
    }

    this.emit("status", this.status);
    this.emit("exit", code);
  }
}
