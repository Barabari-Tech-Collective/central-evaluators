/**
 * One-off, manual smoke test (not part of `npm test`): proves the JS
 * evaluator is wired end-to-end through the real BullMQ queue + worker +
 * Redis, using this repo's own public GitHub URL as the "submission".
 * Run: node scripts/e2e-smoke-js-worker.mjs
 */
import { QueueEvents } from "bullmq";
import redisConnection from "../config/redis.js";
import queueManager from "../config/queueManager.js";
import { initializeJsWorker, stopJsWorker } from "../workers/jsWorker.js";

await queueManager.initialize();
await initializeJsWorker();

const queueEvents = new QueueEvents("javascript-evaluation", {
  connection: redisConnection.getClient().duplicate()
});
await queueEvents.waitUntilReady();

const job = await queueManager.addEvaluation("javascript", {
  submission: {
    studentId: "smoke-test",
    studentName: "Smoke Test",
    repoUrl: "https://github.com/Barabari-Tech-Collective/central-evaluators.git"
  },
  evaluationMode: "function",
  entryFunction: "doesNotExist",
  testCases: [{ input: 1, expected: 1 }]
});

console.log("Job queued:", job.id);

let result = null;
let failed = false;
try {
  result = await job.waitUntilFinished(queueEvents, 60000);
} catch (err) {
  failed = true;
  console.log("Job failed:", err.message);
}

console.log("Result shape:", JSON.stringify(result, null, 2));

const ok =
  !failed &&
  result?.success === true &&
  typeof result?.studentId === "string" &&
  typeof result?.evaluation === "object";

console.log(ok ? "✅ end-to-end wiring OK" : "❌ end-to-end wiring FAILED");

await queueEvents.close();
await stopJsWorker();
await queueManager.disconnect();
process.exit(ok ? 0 : 1);
