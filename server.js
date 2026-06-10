import express from 'express';
import dotenv from 'dotenv';
import { evaluate } from './controller/evaluatorController.js';
import queueManager from './config/queueManager.js';
import logger from './config/logger.js';
import redisConnection from './config/redis.js';

// Initialize workers
import { initializeVisualWorker } from './workers/visualWorker.js';
import { initializeJsWorker } from './workers/jsWorker.js';
import { initializePythonWorker } from './workers/pythonWorker.js';
import { initializeReactWorker } from './workers/reactWorker.js';
import { initializeBackendWorker } from './workers/backendWorker.js';
import { initializeFullstackWorker } from './workers/fullstackWorker.js';

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

    // 6. Start server
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      logger.info(`✅ API Gateway running on port ${PORT}`);
    });

  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Shutting down gracefully...');
  await queueManager.disconnect();
  process.exit(0);
});