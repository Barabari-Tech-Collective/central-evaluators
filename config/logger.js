// src/config/logger.js
import winston from 'winston';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logsDir = process.env.LOG_DIR || './logs';

// Create logs directory if it doesn't exist
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// ioredis attaches the failed command (e.g. AUTH with the password as an arg)
// to ReplyError instances as `.command`. winston's errors() format spreads an
// error's own enumerable props into the log line, so that command — password
// included — was landing in plaintext in every transport, including console.
const redactRedisCommand = winston.format((info) => {
  if (info.command) info.command = '[redacted]';
  return info;
});

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  redactRedisCommand(),
  winston.format.json()
);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: { service: 'evaluator-system' },
  transports: [
    // Error logs
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 20971520, // 20MB
      maxFiles: 5
    }),
    // Combined logs
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 20971520, // 20MB
      maxFiles: 5
    }),
    // Worker logs
    new winston.transports.File({
      filename: path.join(logsDir, 'workers.log'),
      maxsize: 20971520, // 20MB
      maxFiles: 10
    })
  ]
});

// Console output is required in every environment: PaaS platforms (Render,
// Railway, ...) only capture stdout/stderr, not files inside the container's
// ephemeral filesystem. Gating this on NODE_ENV made every deploy log silent.
logger.add(
  new winston.transports.Console({
    format: process.env.NODE_ENV === 'production'
      ? logFormat
      : winston.format.combine(
          winston.format.colorize(),
          winston.format.printf(
            ({ level, message, timestamp, ...meta }) => {
              return `${timestamp} [${level}]: ${message} ${
                Object.keys(meta).length ? JSON.stringify(meta) : ''
              }`;
            }
          )
        )
  })
);

export default logger;