import { Worker } from "bullmq";

import {
  redisConnection
} from "../queues/redis.js";

import { evaluateBackendProject }
from "../../evaluators/backend/evaluator.js";

const backendWorker = new Worker(

  "backend-evaluation",

  async (job) => {

    console.log(
      `[BackendWorker] Processing ${job.id}`
    );

    return await evaluateBackendProject(
      job.data
    );
  },

  {
    connection: redisConnection,
    concurrency: 5
  }
);

backendWorker.on("completed", (job) => {
  console.log(
    `[BackendWorker] Completed ${job.id}`
  );
});

backendWorker.on("failed", (job, err) => {
  console.error(
    `[BackendWorker] Failed ${job?.id}`,
    err.message
  );
});

export default backendWorker;