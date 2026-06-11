// src/controllers/evaluationController.js

import { routeEvaluation } from '../router/evaluationRouter.js';
import logger from '../config/logger.js';

export async function evaluate(req, res) {
  try {
    const payload = req.body;

    // Validate required fields
    if (!payload.type) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: type'
      });
    }

    // Route evaluation
    const jobs = await routeEvaluation(payload);

    logger.info('Evaluation job created', {
      type: payload.type
    });
    if (Array.isArray(jobs)) {
  return res.json({
    success: true,
    jobs: jobs.map(job => ({
      jobId: job.id,
      statusUrl:
        `/jobs/${payload.type}/${job.id}`
    }))
  });
}

    // return res.json({
    //   success: true,
    //   jobId: job.id,
    //   queue: payload.type,
    //   timestamp: new Date().toISOString()
    // });

  } catch (err) {
    logger.error('Evaluation error:', err);

    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
}