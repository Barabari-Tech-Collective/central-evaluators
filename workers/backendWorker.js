import { Worker } from 'bullmq';
import redisConnection from '../config/redis.js';
import queueManager from '../config/queueManager.js';
import logger from '../config/logger.js';
import { evaluateBackendProject } from '../evaluators/backend/evaluatorService.js';


let backendWorker = null;

export async function initializeBackendWorker() {
  try {
    logger.info('Initializing Backend Worker...');

    const jsQueue = queueManager.getQueue('backend');
    const config = queueManager.getConfig('backend');

    backendWorker = new Worker(
      'backend-evaluation',
      async (job) => {
        try {
          logger.info(`Starting Backend evaluation: ${job.id}`);
          const results = evaluateBackendProject(job.data);          
          logger.info(`Backend Job ${job.id} completed`);
          return { success: true, results };
        } catch (err) {
          logger.error(`Backend Job ${job.id} failed`, err);
          throw err;
        }
      },
      {
        connection: redisConnection.getClient(),
        concurrency: config.concurrency,
        settings: {
          maxStalledCount: 2,
          lockDuration: 30000,
          lockRenewTime: 15000
        }
      }
    );

    // Event handlers
    backendWorker.on('completed', (job, result) => {
      logger.info(`JS Job ${job.id} completed`, {
        duration: job.finishedOn - job.processedOn
      });
    });

    backendWorker.on('failed', (job, err) => {
      logger.error(`Backend Job ${job.id} failed`, {
        error: err.message,
        attempts: job.attemptsMade
      });
    });

    logger.info('Backend Worker initialized');
    return backendWorker;

  } catch (err) {
    logger.error('Failed to initialize Backend worker:', err);
    throw err;
  }
}

export async function stopBackendWorker() {
  try {
    if (backendWorker) {
      await backendWorker.close();
    }
    logger.info('Backend worker stopped');
  } catch (err) {
    logger.error('Error stopping Backend worker:', err);
  }
}

export function getBackendWorkerStatus() {
  return {
    status: backendWorker ? 'running' : 'not_initialized',
    concurrency: queueManager.getConfig('backend').concurrency
  };
}

export { backendWorker };