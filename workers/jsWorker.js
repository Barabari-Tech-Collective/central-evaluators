import { Worker } from 'bullmq';

import { redisConnection } from '../queues/redis.js';

import { cloneRepo } from '../evaluators/js/repoService.js';

import { findJavaScriptFiles } from '../evaluators/js/fileService.js';

import { evaluateAll } from '../evaluators/js/evaluationService.js';

const jsWorker = new Worker(

  'javascript-evaluation',

  async (job) => {

    console.log('Running JavaScript Evaluation Worker');

    const { repoUrl } = job.data;

    const repoPath = await cloneRepo(repoUrl);

    const students = findJavaScriptFiles(repoPath);

    const results = await evaluateAll(students);

    return results;
  },

  {
    connection: redisConnection
  }
);

jsWorker.on('completed', (job) => {
  console.log(`Job ${job.id} completed`);
});

jsWorker.on('failed', (job, err) => {
  console.log(`Job ${job.id} failed`);
  console.error(err);
});