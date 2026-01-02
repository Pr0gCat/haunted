import { loadManagerConfig } from "@/manager/config-loader.ts";
import { Supervisor } from "@/manager/supervisor.ts";
import { MetricsCollector } from "@/manager/metrics/collector.ts";
import { createManagerApi } from "@/manager/api/server.ts";
import { createLogger } from "@/utils/logger.ts";
import { resolve } from "node:path";

const logger = createLogger("manager");

async function main() {
  logger.info("Starting Haunted Manager...");

  // 載入配置
  const config = await loadManagerConfig();

  logger.info(
    { instances: config.instances.length },
    "Manager configuration loaded"
  );

  // 初始化 Supervisor
  const supervisor = new Supervisor({
    autoRestart: config.manager.supervisor.auto_restart,
    maxRestarts: config.manager.supervisor.max_restarts,
    restartWindow: config.manager.supervisor.restart_window,
    healthCheckInterval: config.manager.supervisor.health_check_interval,
  });

  // 註冊所有 instances
  for (const instanceConfig of config.instances) {
    if (!instanceConfig.enabled) {
      logger.info({ id: instanceConfig.id }, "Instance disabled, skipping");
      continue;
    }

    const workingDir = instanceConfig.working_dir
      ? resolve(instanceConfig.working_dir)
      : process.cwd();

    await supervisor.addInstance({
      id: instanceConfig.id,
      name: instanceConfig.name,
      enabled: instanceConfig.enabled,
      configFile: instanceConfig.config_file,
      config: instanceConfig.config,
      workingDir,
      env: instanceConfig.env,
    });

    logger.info(
      { id: instanceConfig.id, name: instanceConfig.name, workingDir },
      "Instance registered"
    );
  }

  // 初始化 Metrics Collector
  const metricsCollector = new MetricsCollector(
    supervisor,
    config.manager.metrics.collect_interval
  );

  // 初始化 API Server
  const api = createManagerApi(supervisor, metricsCollector, {
    port: config.manager.api.port,
    host: config.manager.api.host,
    auth: config.manager.api.auth,
  });

  // 啟動所有服務
  if (config.manager.metrics.enabled) {
    metricsCollector.start();
  }

  api.start();

  // 啟動所有啟用的 instances
  await supervisor.startAll();

  logger.info(
    { apiPort: config.manager.api.port },
    "Haunted Manager is running"
  );

  // 優雅關閉
  const shutdown = async () => {
    logger.info("Shutting down Manager...");

    metricsCollector.stop();
    await supervisor.stopAll();

    logger.info("Manager shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  logger.error({ error }, "Fatal error in Manager");
  process.exit(1);
});
