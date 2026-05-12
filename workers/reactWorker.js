// reactWorker.js

import { Worker } from 'bullmq';
import { redisConnection } from '../redis.js';
import { evaluateReactProject } from '../evaluators/react/evaluatorService.js';

new Worker(
  'react-evaluation',
  async (job) => {
    return await evaluateReactProject(job.data);
  },
  {
    connection: redisConnection
  }
);