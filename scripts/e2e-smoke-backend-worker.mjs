/**
 * One-off, manual smoke test (not part of `npm test`): proves the Backend
 * evaluator is wired end-to-end through the REAL BullMQ queue + Redis +
 * workers/backendWorker.js — the piece that couldn't be exercised by
 * scripts/test-backend-evaluator.mjs (which only tests pure functions).
 *
 * Deliberately uses a repoUrl that passes the SSRF/host-allowlist check but
 * does NOT exist on GitHub, so `git clone` fails cleanly — this proves the
 * real queue/worker/timeout wiring works without ever creating a real E2B
 * sandbox (no cost, no external repo actually cloned).
 *
 * Run: node scripts/e2e-smoke-backend-worker.mjs
 */
import { QueueEvents } from "bullmq";
import redisConnection from "../config/redis.js";
import queueManager from "../config/queueManager.js";
import { initializeBackendWorker, stopBackendWorker } from "../workers/backendWorker.js";
import { evaluate } from "../controller/evaluatorController.js";

await queueManager.initialize();
await initializeBackendWorker();

const queueEvents = new QueueEvents("backend-evaluation", {
  connection: redisConnection.getClient().duplicate()
});
await queueEvents.waitUntilReady();

// Go through the REAL HTTP entry point (evaluatorController.evaluate), not
// queueManager directly, so the fail-fast validation added for bug #7 is
// exercised too, not just the queue itself.
function fakeRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

const res = fakeRes();
await evaluate({
  body: {
    type: "backend",
    repoUrl: "https://github.com/Barabari-Tech-Collective/this-repo-does-not-exist-backend-smoke-test.git",
    rubric: { criteria: [{ name: "All API endpoints work", weight: 100 }] }
  }
}, res);

console.log("Controller response:", res.statusCode, JSON.stringify(res.body));

// evaluatorController.js's success path calls `res.json(...)` without an
// explicit `res.status(200)` — Express defaults to 200 in that case, but
// this fakeRes only records a statusCode when `.status()` is actually
// called. So on success, statusCode stays null; only the error paths
// (400/500) explicitly call `.status(code)`. Treat null-or-200 as success.
const queuedOk = (res.statusCode === null || res.statusCode === 200) && !!res.body?.jobId && res.body?.success === true;

if (!queuedOk) {
  console.log("❌ end-to-end wiring FAILED — job was never queued");
  await queueEvents.close();
  await stopBackendWorker();
  await queueManager.disconnect();
  process.exit(1);
}

const jobId = res.body.jobId;
console.log("Job queued:", jobId);

const job = await queueManager.getQueue("backend").getJob(jobId);

let failed = false;
let failReason = null;
try {
  await job.waitUntilFinished(queueEvents, 60000);
} catch (err) {
  failed = true;
  failReason = err.message;
}

console.log("Job outcome:", failed ? `failed — ${failReason}` : "completed (unexpected — repo shouldn't exist)");

// Expected outcome: the job FAILS at the clone step (repo doesn't exist),
// proving the real worker picked it up from Redis, ran evaluatorService.js,
// hit the real git-clone network path, and surfaced the failure back
// through BullMQ — all without ever calling E2B's Sandbox.create().
const ok = failed && /clone|repository|not found/i.test(failReason || "");

console.log(ok
  ? "✅ end-to-end Redis/BullMQ wiring OK (failed at clone, as expected — E2B never touched)"
  : "❌ end-to-end wiring did not behave as expected");

await queueEvents.close();
await stopBackendWorker();
await queueManager.disconnect();
process.exit(ok ? 0 : 1);
