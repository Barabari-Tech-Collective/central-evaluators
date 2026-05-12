/**
 * timeout.js
 *
 * Reusable timeout and cancellation utilities for the React Evaluator.
 *
 * Provides:
 * - withTimeout()      : wraps any Promise with a hard deadline
 * - createCancelToken(): lightweight cancel token for cooperative cancellation
 * - sleep()            : awaitable delay helper
 */

/**
 * Wraps a Promise with a hard timeout.
 * If the promise does not resolve within `ms` milliseconds, it rejects
 * with a TimeoutError.
 *
 * @param {Promise<any>} promise - The promise to race
 * @param {number} ms            - Timeout in milliseconds
 * @param {string} [label]       - Optional label for the error message
 * @returns {Promise<any>}
 *
 * @example
 * const result = await withTimeout(runTests(path), 120_000, "runTests");
 */
export async function withTimeout(promise, ms, label = "operation") {
  let timeoutId;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Timeout: "${label}" exceeded ${ms}ms`));
    }, ms);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    return result;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Creates a cancel token — a lightweight way for the evaluator to signal
 * cooperative cancellation to long-running async tasks.
 *
 * @returns {{ token: object, cancel: Function }}
 *
 * @example
 * const { token, cancel } = createCancelToken();
 * runLongTask(token);           // task checks token.isCancelled periodically
 * setTimeout(() => cancel(), 5000);
 */
export function createCancelToken() {
  const token = { isCancelled: false, reason: null };

  function cancel(reason = "Cancelled") {
    token.isCancelled = true;
    token.reason = reason;
  }

  return { token, cancel };
}

/**
 * Returns a Promise that resolves after `ms` milliseconds.
 * Useful for adding deliberate delays (e.g., waiting for app server to start).
 *
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 *
 * @example
 * await sleep(3000); // wait 3 seconds for the dev server to boot
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}