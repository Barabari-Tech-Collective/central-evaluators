import queueManager from '../config/queueManager.js';
import logger from '../config/logger.js';

export async function routeEvaluation(payload) {
  const { type } = payload;

  // Validate type
  if (!queueManager.getQueueTypes().includes(type)) {
    throw new Error(`Invalid evaluator type: ${type}`);
  }

  try {
    // Add job to appropriate queue
    const job = await queueManager.addEvaluation(type, payload);

    logger.info(`Job routed: ${type}`, { jobId: job.id });

    return job;

  } catch (err) {
    logger.error(`Failed to route evaluation:`, err);
    throw err;
  }
}