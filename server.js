import express from 'express';
import dotenv from 'dotenv';
import { evaluate } from './controller/evaluatorController.js';
import queueManager from './config/queueManager.js';
import logger from './config/logger.js';
import redisConnection from './config/redis.js';

// Initialize workers
import { initializeVisualWorker, stopVisualWorker } from './workers/visualWorker.js';
import { initializeJsWorker, stopJsWorker } from './workers/jsWorker.js';
import { initializePythonWorker, stopPythonWorker } from './workers/pythonWorker.js';
import { initializeReactWorker, stopReactWorker } from './workers/reactWorker.js';
import { initializeBackendWorker, stopBackendWorker } from './workers/backendWorker.js';
import { initializeFullstackWorker, stopFullstackWorker } from './workers/fullstackWorker.js';

dotenv.config();

const app = express();
app.use(express.json());

// Startup sequence
async function startServer() {
  try {
    logger.info('🚀 Starting evaluator system...');

    // 1. Connect Redis
    await redisConnection.ping();
    logger.info('✅ Redis connected');

    // 2. Initialize queue manager
    await queueManager.initialize();
    logger.info('✅ Queue manager initialized');

    // 3. Initialize workers
    await Promise.all([
      initializeVisualWorker(),
      initializeJsWorker(),
      initializePythonWorker(),
      initializeReactWorker(),
      initializeBackendWorker(),
      initializeFullstackWorker()
    ]);
    logger.info('✅ All workers initialized');

    // 4. API routes
    app.post('/evaluate', evaluate);

    // 5. Health check endpoints
    app.get('/health', (req, res) => {
      res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
      });
    });

    app.get('/health/redis', async (req, res) => {
      try {
        await redisConnection.ping();
        res.json({ redis: 'connected' });
      } catch (err) {
        res.status(500).json({ redis: 'disconnected', error: err.message });
      }
    });

    app.get('/health/queues', async (req, res) => {
      try {
        const stats = await queueManager.getAllStats();
        res.json(stats);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    app.get('/jobs/:type/:jobId', async (req, res) => {
  try {
    const result = await queueManager.getJobStatus(
      req.params.type,
      req.params.jobId
    );

    res.json(result);
  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

    // 6. Start server
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      logger.info(`API Gateway running on port ${PORT}`);
    });

  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();

// Graceful shutdown (V-27)
// Drain workers (waits for in-flight jobs + closes their browser pools),
// then close queues/Redis. A hard-exit timer guards against a hung close
// so we never leak zombie Chromium processes across a deploy.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Received ${signal}, shutting down gracefully...`);

  const hardExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 30000);
  hardExit.unref();

  try {
    await Promise.allSettled([
      stopVisualWorker(),
      stopJsWorker(),
      stopPythonWorker(),
      stopReactWorker(),
      stopBackendWorker(),
      stopFullstackWorker()
    ]);
    await queueManager.disconnect();
    logger.info('Shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error('Error during shutdown:', err);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));