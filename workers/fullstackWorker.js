import { Worker } from "bullmq";
import { redisConnection } from "../queues/redis.js";
import { evaluateFullstackProject } from "../evaluators/fullstack/evaluatorService.js";

const fullstackWorker = new Worker(

  "fullstack-evaluation",

  async (job) => {
    console.log(`[FullstackWorker] Processing ${job.id}`);
    return await evaluateFullstackProject(job.data);
  },

  {
    connection: redisConnection,
    concurrency: 3
  }
);

fullstackWorker.on("completed", (job) => {
  console.log(`[FullstackWorker] Completed ${job.id}`);
});

fullstackWorker.on("failed", (job, err) => {
  console.error(`[FullstackWorker] Failed ${job?.id}`, err.message);
});

export default fullstackWorker;
