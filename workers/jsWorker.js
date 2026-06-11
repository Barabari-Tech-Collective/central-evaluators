import { Worker } from 'bullmq';
import redisConnection from '../config/redis.js';
import queueManager from '../config/queueManager.js';
import logger from '../config/logger.js';
// import { evaluateJavaScript } from '../evaluators/javascript/evaluatorService.js';
import { cloneRepo } from '../evaluators/js/repoService.js';
import { findJavaScriptFile } from '../evaluators/js/fileService.js';
import { evaluateStudent } from '../evaluators/js/evaluationService.js';


let jsWorker = null;

export async function initializeJsWorker() {
  try {
    logger.info('Initializing JavaScript Worker...');

    const jsQueue = queueManager.getQueue('javascript');
    const config = queueManager.getConfig('javascript');

    jsWorker = new Worker(
      'javascript-evaluation',
      async (job) => {
        try {
          logger.info(`Starting JS evaluation: ${job.id}`);
          // const { repoUrl } = job.data;
          // const repoPath = await cloneRepo(repoUrl);
          // const students = findJavaScriptFiles(repoPath);
          // const results = await evaluateAll(students);
          // const results = await evaluateJavaScript(job.data);
          const {
  submissions,
  testCases,
  entryFunction
} = job.data;

const results = [];

for (const submission of submissions) {

  const repoPath =
    await cloneRepo(submission.repoUrl);

  const filePath =
  findJavaScriptFile(repoPath);

if (!filePath) {

  results.push({
    studentId: submission.studentId,
    studentName: submission.studentName,
    evaluation: {
      score: 0,
      error: 'No JavaScript file found'
    }
  });

  continue;
}
const evaluation =
await evaluateStudent(
  filePath,
  testCases,
  entryFunction
);

results.push({
  studentId: submission.studentId,
  studentName: submission.studentName,
  evaluation
});

logger.info(
  `[JS WORKER] Processing ${submission.studentName}`
);
logger.info(
  `[JS WORKER] Found file: ${filePath}`
);
logger.info(
  `[JS WORKER] Entry Function: ${entryFunction}`
);
  logger.info(
    `Received ${testCases.length} test cases`
  );
}
          logger.info(`JS Job ${job.id} completed`);

          return { success: true, results };
        } catch (err) {
          logger.error(`JS Job ${job.id} failed`, err);
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
    jsWorker.on('completed', (job, result) => {
      logger.info(`JS Job ${job.id} completed`, {
        duration: job.finishedOn - job.processedOn
      });
      console.log(
    'RESULT =>',
    JSON.stringify(result, null, 2)
  );
    });

    jsWorker.on('failed', (job, err) => {
      logger.error(`JS Job ${job.id} failed`, {
        error: err.message,
        attempts: job.attemptsMade
      });
    });

    logger.info('JavaScript Worker initialized');
    return jsWorker;

  } catch (err) {
    logger.error('Failed to initialize JS worker:', err);
    throw err;
  }
}

export async function stopJsWorker() {
  try {
    if (jsWorker) {
      await jsWorker.close();
    }
    logger.info('JS worker stopped');
  } catch (err) {
    logger.error('Error stopping JS worker:', err);
  }
}

export function getJsWorkerStatus() {
  return {
    status: jsWorker ? 'running' : 'not_initialized',
    concurrency: queueManager.getConfig('javascript').concurrency
  };
}

export { jsWorker };