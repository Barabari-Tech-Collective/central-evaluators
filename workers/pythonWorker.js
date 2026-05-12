// src/workers/pythonWorker.js

import { Worker } from "bullmq";
import { redisConnection } from "../queues/redis.js";

import { cloneRepo } from "../evaluators/python/services/repoService.js";
import { findPythonFiles } from "../evaluators/python/services/fileService.js";
import { evaluateAll } from "../evaluators/python/services/evaluatorService.js";

const pythonWorker = new Worker(
  "python-evaluation",

  async (job) => {

    console.log("Processing Python Job:", job.id);

    const { repoUrl } = job.data;

    // 1. Clone repo
    const repoPath = await cloneRepo(repoUrl);

    // 2. Find python files
    const students = findPythonFiles(repoPath);

    // 3. Evaluate
    const results = await evaluateAll(students);

    console.log("Python Evaluation Completed");

    return results;
  },

  {
    connection: redisConnection
  }
);

pythonWorker.on("completed", (job) => {
  console.log(`Job ${job.id} completed`);
});

pythonWorker.on("failed", (job, err) => {
  console.log(`Job ${job.id} failed`);
  console.error(err);
});