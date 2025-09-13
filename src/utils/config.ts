/**
 * Configuration Manager - Handles Haunted configuration
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { z } from 'zod';
import type { HauntedConfig } from '../models/index.js';
import { logger } from './logger.js';

const ConfigSchema = z.object({
  project: z.object({
    name: z.string(),
    root: z.string()
  }),
  database: z.object({
    url: z.string()
  }),
  claude: z.object({
    command: z.string(),
    maxTokens: z.number().optional(),
    temperature: z.number().optional()
  }),
  workflow: z.object({
    autoProcess: z.boolean(),
    checkInterval: z.number(),
    maxRetries: z.number()
  }),
  logging: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']),
    file: z.string().optional()
  })
});

export class ConfigManager {
  private configDir: string;
  private configFile: string;

  constructor(projectRoot: string = process.cwd()) {
    this.configDir = path.join(projectRoot, '.haunted');
    this.configFile = path.join(this.configDir, 'config.json');
  }

  isInitialized(): boolean {
    try {
      const exists = fsSync.existsSync(this.configFile);
      logger.debug(`Checking config file: ${this.configFile}, exists: ${exists}`);
      return exists;
    } catch (error) {
      logger.error(`Error checking config file: ${error}`);
      return false;
    }
  }

  createDefaultConfig(): HauntedConfig {
    const projectRoot = process.cwd();
    const projectName = path.basename(projectRoot);

    const config: HauntedConfig = {
      project: {
        name: projectName,
        root: projectRoot
      },
      database: {
        url: path.join(this.configDir, 'database.db')
      },
      claude: {
        command: 'claude',
        maxTokens: 4000,
        temperature: 0.7
      },
      workflow: {
        autoProcess: true,
        checkInterval: 30000, // 30 seconds
        maxRetries: 3
      },
      logging: {
        level: 'info'
      }
    };

    return config;
  }

  async saveConfig(config: HauntedConfig): Promise<void> {
    try {
      // Validate config
      ConfigSchema.parse(config);

      // Ensure config directory exists
      await fs.mkdir(this.configDir, { recursive: true });

      // Write config file
      await fs.writeFile(
        this.configFile,
        JSON.stringify(config, null, 2),
        'utf8'
      );

      logger.info(`Configuration saved to ${this.configFile}`);

    } catch (error) {
      logger.error('Failed to save configuration:', error);
      throw error;
    }
  }

  loadConfig(overrides?: Partial<HauntedConfig>): HauntedConfig {
    try {
      logger.debug(`Loading config from: ${this.configFile}`);
      logger.debug(`Current working directory: ${process.cwd()}`);
      logger.debug(`Config directory: ${this.configDir}`);

      if (!this.isInitialized()) {
        throw new Error('Project not initialized. Run "haunted init" first.');
      }

      const configData = fsSync.readFileSync(this.configFile, 'utf8');
      const config = JSON.parse(configData);

      // Validate and merge with overrides
      const validatedConfig = ConfigSchema.parse(config);

      if (overrides) {
        return this.mergeConfig(validatedConfig, overrides);
      }

      return validatedConfig;

    } catch (error) {
      logger.error('Failed to load configuration:', error);
      throw error;
    }
  }

  async updateConfig(updates: Partial<HauntedConfig>): Promise<void> {
    try {
      const currentConfig = this.loadConfig();
      const updatedConfig = this.mergeConfig(currentConfig, updates);

      await this.saveConfig(updatedConfig);

    } catch (error) {
      logger.error('Failed to update configuration:', error);
      throw error;
    }
  }

  private mergeConfig(base: HauntedConfig, overrides: Partial<HauntedConfig>): HauntedConfig {
    return {
      project: { ...base.project, ...overrides.project },
      database: { ...base.database, ...overrides.database },
      claude: { ...base.claude, ...overrides.claude },
      workflow: { ...base.workflow, ...overrides.workflow },
      logging: { ...base.logging, ...overrides.logging }
    };
  }

  getConfigPath(): string {
    return this.configFile;
  }

  getConfigDir(): string {
    return this.configDir;
  }

  async deleteConfig(): Promise<void> {
    try {
      await fs.unlink(this.configFile);
      logger.info('Configuration deleted');
    } catch (error) {
      logger.error('Failed to delete configuration:', error);
      throw error;
    }
  }

  async exportConfig(): Promise<string> {
    try {
      const config = this.loadConfig();
      return JSON.stringify(config, null, 2);
    } catch (error) {
      logger.error('Failed to export configuration:', error);
      throw error;
    }
  }

  async importConfig(configJson: string): Promise<void> {
    try {
      const config = JSON.parse(configJson);
      const validatedConfig = ConfigSchema.parse(config);

      await this.saveConfig(validatedConfig);

    } catch (error) {
      logger.error('Failed to import configuration:', error);
      throw error;
    }
  }
}