/**
 * Logger utility - Configurable logging for Haunted
 */

import winston from 'winston';
import path from 'path';

export interface LoggerConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  file?: string;
}

let globalLogger: winston.Logger | undefined;

export function setupLogger(config: LoggerConfig): winston.Logger {
  const transports: winston.transport[] = [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length > 0 ? JSON.stringify(meta) : '';
          return `${timestamp} [${level}]: ${message} ${metaStr}`;
        })
      )
    })
  ];

  // Add file transport if specified
  if (config.file) {
    transports.push(
      new winston.transports.File({
        filename: path.resolve(config.file),
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json()
        )
      })
    );
  }

  globalLogger = winston.createLogger({
    level: config.level,
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true })
    ),
    transports,
    exitOnError: false
  });

  return globalLogger;
}

// Create default logger if none exists
function getDefaultLogger(): winston.Logger {
  if (!globalLogger) {
    globalLogger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
        })
      ],
      exitOnError: false
    });
  }
  return globalLogger;
}

export const logger = getDefaultLogger();

export default logger;