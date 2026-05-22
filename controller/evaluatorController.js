// src/controllers/evaluationController.js

import { routeEvaluation } from '../router/evaluationRouter.js';

export async function evaluate(req, res) {
  try {
    const payload = req.body;

    const job = await routeEvaluation(payload);

    return res.json({
      success: true,
      jobId: job.id,
      queue: payload.type,
    });
  } catch (err) {
    console.error(err);

    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
}
