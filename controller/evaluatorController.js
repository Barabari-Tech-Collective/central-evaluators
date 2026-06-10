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
    const job = await routeEvaluation(payload);

    logger.info('Evaluation job created', {
      type: payload.type,
      jobId: job.id
    });

    return res.json({
      success: true,
      jobId: job.id,
      queue: payload.type,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    logger.error('Evaluation error:', err);

    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
}