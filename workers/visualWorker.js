import { Worker } from 'bullmq';

import { redisConnection } from '../../queues/redis.js';

import { evaluateStudentsWithVision } from '../evaluators/visual/evaluatorService.js';

const visualWorker = new Worker(

  'visual-evaluation',

  async (job) => {

    console.log('Running Visual Evaluation Worker');

    const results = await evaluateStudentsWithVision(job.data);

    return results;
  },

  {
    connection: redisConnection
  }
);

visualWorker.on('completed', (job) => {
  console.log(`Visual Job ${job.id} completed`);
});

visualWorker.on('failed', (job, err) => {
  console.error(`Visual Job ${job.id} failed`);
  console.error(err);
});