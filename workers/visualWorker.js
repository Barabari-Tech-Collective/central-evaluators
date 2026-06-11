// src/workers/visualWorker.js
/**
 * Visual Evaluation Worker
 * 
 * Handles UI/Visual evaluations with:
 * - Browser pooling for efficiency
 * - Proper error handling
 * - Logging and monitoring
 * - Integration with new queueManager
 */

import { Worker } from 'bullmq';
import redisConnection from '../config/redis.js';
import queueManager from '../config/queueManager.js';
import logger from '../config/logger.js';
import { getBrowserPool } from '../evaluators/visual/browserPool.js';
import { evaluateStudentsWithVision } from '../evaluators/visual/evaluatorService.js';
import { deleteRepo } from '../evaluators/visual/repoService.js';

let visualWorker = null;

/**
 * Initialize visual worker
 * Called once at application startup
 */
export async function initializeVisualWorker() {
  try {
    logger.info('Initializing Visual Worker...');

    // Initialize browser pool first
    await getBrowserPool(3);  // Pool of 3 browsers

    // Get queue from queueManager
    const visualQueue = queueManager.getQueue('visual');
    const config = queueManager.getConfig('visual');

    // Create worker with proper concurrency
    visualWorker = new Worker(
      'visual-evaluation',
      async (job) => {
        return await processVisualJob(job);
      },
      {
        connection: redisConnection.getClient(),
        concurrency: config.concurrency,  // 2 concurrent jobs
        settings: {
          maxStalledCount: 2,             // Allow 2 stalls before failing
          lockDuration: 30000,            // Lock duration: 30 sec
          lockRenewTime: 15000,           // Renew every 15 sec
          retryProcessDelay: 5000         // Delay between retries
        }
      }
    );

    // Setup event handlers
    setupWorkerEvents();

    logger.info('Visual Worker initialized');
    logger.info(`Concurrency: ${config.concurrency}, Timeout: ${config.timeout}ms`);

    return visualWorker;

  } catch (err) {
    logger.error('Failed to initialize visual worker:', err);
    throw err;
  }
}

/**
 * Process a visual evaluation job
 */
async function processVisualJob(job) {
  const jobId = job.id;
  const jobData = job.data;

  let browserPool = null;

  try {
    logger.info(`Starting visual evaluation job: ${jobId}`);
    logger.debug(`Job data:`, {
      jobId,
      repoUrl: jobData.repoUrl,
      expectedUrl: jobData.expectedUrl,
      rubricLength: jobData.rubricText?.length
    });

    // Get browser pool
    browserPool = await getBrowserPool(3);
    logger.debug(`Browser pool stats:`, browserPool.getStats());

    // Main evaluation logic
    // const results = await evaluateStudentsWithVision({
    //   rubricText: jobData.rubricText,
    //   expectedUrl: jobData.expectedUrl,
    //   repoUrl: jobData.repoUrl
    // });
    const {
  submission,
  rubricText,
  expectedUrl
} = job.data;

const result =
  await evaluateStudentWithVision({
    studentId:
      submission.studentId,

    studentName:
      submission.studentName,

    repoUrl:
      submission.repoUrl,

    rubricText,
    expectedUrl
  });

    logger.info(`Job completed: ${jobId}`, {
      totalStudents: results?.length || 0,
      successCount: results?.filter(r => !r.error)?.length || 0
    });

    // return {
    //   success: true,
    //   jobId,
    //   results,
    //   timestamp: new Date().toISOString()
    // };
    return {
  success: true,
  result
};

  } catch (err) {
    logger.error(`Job failed: ${jobId}`, {
      error: err.message,
      stack: err.stack
    });

    throw err;  // BullMQ will handle retry

  }finally {

  if (repoUrl) {

    await deleteRepo(
      repoUrl
    );

    logger.info(
      `[VISUAL WORKER] Deleted repo ${repoUrl}`
    );
  }
}
}

/**
 * Setup event handlers for worker
 */
function setupWorkerEvents() {
  if (!visualWorker) return;

  // Job completed
  visualWorker.on('completed', (job, result) => {
    logger.info(`Visual Job ${job.id} completed`, {
      duration: job.finishedOn - job.processedOn,
      students: result?.results?.length
    });
  });

  // Job failed
  visualWorker.on('failed', (job, err) => {
    logger.error(`Visual Job ${job.id} failed`, {
      error: err.message,
      attempts: job.attemptsMade,
      maxAttempts: job.attempts
    });
  });

  // Job started
  visualWorker.on('active', (job) => {
    logger.info(`Visual Job ${job.id} started processing`);
  });

  // Stalled job (took too long)
  visualWorker.on('stalled', (jobId) => {
    logger.warn(`Visual Job ${jobId} stalled`);
  });

  // Error in worker
  visualWorker.on('error', (err) => {
    logger.error('Visual Worker error:', err);
  });

  // Worker is ready
  visualWorker.on('ready', () => {
    logger.info('Visual Worker is ready');
  });

  // Worker connection closed
  visualWorker.on('closed', () => {
    logger.info('Visual Worker closed');
  });
}

/**
 * Graceful shutdown
 */
export async function stopVisualWorker() {
  try {
    logger.info('Stopping visual worker...');

    if (visualWorker) {
      await visualWorker.close();
    }

    // Close browser pool
    const browserPool = await getBrowserPool(3).catch(() => null);
    if (browserPool) {
      await browserPool.close();
    }

    logger.info('Visual worker stopped');

  } catch (err) {
    logger.error('Error stopping visual worker:', err);
  }
}

/**
 * Get worker status
 */
export function getVisualWorkerStatus() {
  if (!visualWorker) {
    return { status: 'not_initialized' };
  }

  return {
    status: 'running',
    isRunning: !visualWorker.closing,
    concurrency: queueManager.getConfig('visual').concurrency
  };
}

export { visualWorker };