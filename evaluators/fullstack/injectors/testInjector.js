/**
 * Injects an auto-generated Jest + Supertest test file into the backend
 * based on the rubric criteria.
 */
export async function injectBackendTests(sandbox, backendRoot, rubric) {
  const criteria = rubric?.criteria ?? [];

  const testCases = criteria
    .filter((c) => c.endpoint)
    .map((c) => buildEndpointTest(c))
    .join("\n\n");

  const testFile = `
const request = require('supertest');
const app = require('./app');

${testCases || buildFallbackTest()}
`;

  await sandbox.files.write(`${backendRoot}/evaluator.test.js`, testFile);
}

function buildEndpointTest(criterion) {
  const { name, endpoint, method = "GET", expectedStatus = 200, body } = criterion;
  const methodLower = method.toLowerCase();
  const bodyStr = body ? `.send(${JSON.stringify(body)})` : "";

  return `
test(${JSON.stringify(name)}, async () => {
  const res = await request(app).${methodLower}('${endpoint}')${bodyStr};
  expect(res.status).toBe(${expectedStatus});
}, 20000);
`.trim();
}

function buildFallbackTest() {
  return `
test('server responds to health check', async () => {
  const request = require('supertest');
  const app = require('./app');
  const res = await request(app).get('/');
  expect(res.status).toBeLessThan(500);
}, 20000);
`.trim();
}
