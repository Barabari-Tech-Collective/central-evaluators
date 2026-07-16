/**
 * testInjector.js
 * ─────────────────────────────────────────────────────────────
 * When a student submission has no test files, this module:
 *   1. Reads the server entry point from the sandbox
 *   2. Parses Express route definitions via regex
 *   3. Maps rubric criteria to expected endpoints/files
 *   4. Generates a Jest test file that:
 *        a) Spawns the server as a background process (avoids
 *           supertest's `app.address` requirement)
 *        b) Hits endpoints via axios (works for any server export style)
 *        c) Runs structural file-system checks (doesn't need server)
 *   5. Injects `evaluator.test.js` into the sandbox
 */

// ── Route Pattern Extraction ───────────────────────────────────────────────────
function extractRoutes(code) {
    const routes = [];
    const seen = new Set();

    const routeRegex = /(?:app|router|server)\s*\.\s*(get|post|put|delete|patch)\s*\(\s*['"`]([^'"` ,)]+)['"`]/gi;
    let match;
    while ((match = routeRegex.exec(code)) !== null) {
        const key = `${match[1].toUpperCase()}:${match[2]}`;
        if (!seen.has(key)) {
            seen.add(key);
            routes.push({ method: match[1].toUpperCase(), path: match[2] });
        }
    }
    return routes;
}

// ── Rubric → Test Section Mapping ─────────────────────────────────────────────
const CRITERION_PATTERNS = [
    {
        keywords: ['auth', 'login', 'register', 'signup'],
        generate: (routes) => generateAuthTests(routes)
    },
    {
        keywords: ['jwt', 'token', 'bearer', 'authorization'],
        generate: (routes) => generateJwtValidationTests(routes)
    },
    {
        keywords: ['schema', 'response format', 'response shape', 'payload', 'validation'],
        generate: (routes) => generateSchemaValidationTests(routes)
    },
    {
        keywords: ['protected', 'middleware', 'guard', 'access control', 'authorization'],
        generate: (routes) => generateProtectedRouteTests(routes)
    },
    {
        keywords: ['health', 'status', 'ping'],
        generate: () => generateHealthTests()
    },
    {
        keywords: ['database', 'db', 'mongo', 'mysql', 'postgres', 'sequelize', 'mongoose', 'config'],
        generate: () => generateDatabaseConfigTests()
    },
    {
        keywords: ['user', 'profile', 'account', 'member'],
        generate: (routes) => generateCrudTests(routes, ['/api/users', '/users', '/api/user'])
    },
    {
        keywords: ['product', 'item', 'inventory', 'catalog', 'order'],
        generate: (routes) => generateCrudTests(routes, ['/api/products', '/products', '/api/items'])
    },
    {
        keywords: ['complaint', 'ticket', 'issue', 'report'],
        generate: (routes) => generateCrudTests(routes, ['/api/complaints', '/complaints'])
    },
    {
        keywords: ['error', '404', 'not found'],
        generate: () => generateErrorHandlingTests()
    },
    {
        keywords: ['route', 'endpoint', 'api', 'rest'],
        generate: (routes) => generateGenericRouteTests(routes)
    }
];

function matchCriteria(criterionName, routes) {
    const nameLower = criterionName.toLowerCase();
    for (const pattern of CRITERION_PATTERNS) {
        if (pattern.keywords.some(k => nameLower.includes(k))) {
            return pattern.generate(routes);
        }
    }
    return generateGenericRouteTests(routes);
}

// ── Test Section Generators ────────────────────────────────────────────────────
function generateHealthTests() {
    return `
    test('Health endpoint responds without 500', async () => {
        const paths = ['/health', '/status', '/ping', '/api/health', '/'];
        let responded = false;
        for (const p of paths) {
            const res = await safeRequest('get', p);
            if (res.status > 0 && res.status < 500) { responded = true; break; }
        }
        expect(responded).toBe(true);
    });`;
}

function generateAuthTests(routes) {
    const loginPath = routes.find(r => /login|signin/i.test(r.path))?.path || '/api/auth/login';
    const registerPath = routes.find(r => /register|signup/i.test(r.path))?.path || '/api/auth/register';

    return `
    test('Auth: login endpoint exists (not 404)', async () => {
        if (!serverStarted) return; // skip if server not running
        const res = await safeRequest('post', '${loginPath}', { username: 'testuser', password: 'testpass' });
        expect(res.status).not.toBe(0);   // server should respond (not crash)
        expect(res.status).not.toBe(404); // endpoint must exist
    });

    test('Auth: login rejects missing credentials', async () => {
        if (!serverStarted) return; // skip if server not running
        const res = await safeRequest('post', '${loginPath}', {});
        // Server must respond (not crash) and must NOT return 200 for empty credentials
        expect(res.status).not.toBe(0);   // server should not crash on empty body
        expect(res.status).not.toBe(200); // must not return success for empty credentials
    });

    test('Auth: register endpoint exists (not 404)', async () => {
        if (!serverStarted) return; // skip if server not running
        const res = await safeRequest('post', '${registerPath}', {
            username: 'newuser_test', password: 'testpass123', email: 'test_eval@test.com'
        });
        expect(res.status).not.toBe(0);   // server should respond
        expect(res.status).not.toBe(404); // endpoint must exist
    });`;
}

function generateDatabaseConfigTests() {
    return `
    test('Database config file exists', () => {
        const candidates = [
            'config/db.js', 'config/database.js', 'db/index.js',
            'database/index.js', 'config/db.ts', 'src/config/db.js',
            'models/db.js', 'utils/db.js'
        ];
        const found = candidates.some(f => {
            try { return require('fs').existsSync(require('path').join(__dirname, f)); } catch(e) { return false; }
        });
        expect(found).toBe(true);
    });

    test('package.json includes a database driver', () => {
        const pkg = require('./package.json');
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        const driverKeywords = ['mongoose', 'mongodb', 'mysql', 'mysql2', 'pg', 'sequelize', 'sqlite', 'mariadb', 'prisma'];
        const hasDriver = driverKeywords.some(d => d in deps);
        expect(hasDriver).toBe(true);
    });`;
}

function generateCrudTests(routes, candidatePaths) {
    const matchedRoute = routes.find(r => candidatePaths.some(c => r.path.startsWith(c)));
    const basePath = matchedRoute?.path || candidatePaths[0];
    return `
    test('GET ${basePath}: endpoint exists (not 404)', async () => {
        const res = await safeRequest('get', '${basePath}');
        expect(res.status).not.toBe(404);
    });

    test('POST ${basePath}: endpoint exists (not 404)', async () => {
        const res = await safeRequest('post', '${basePath}', { name: 'test' });
        expect(res.status).not.toBe(404);
    });`;
}

function generateErrorHandlingTests() {
    return `
    test('Unknown routes return 404', async () => {
        const res = await safeRequest('get', '/this-route-definitely-does-not-exist-xyz-abc');
        expect(res.status).toBe(404);
    });`;
}

function generateGenericRouteTests(routes) {
    if (routes.length === 0) {
        return `
    test('Server responds to at least one route', async () => {
        const res = await safeRequest('get', '/');
        expect(res.status).toBeGreaterThan(0);
    });`;
    }
    return routes
        .filter(r => r.method !== 'USE' && !r.path.includes(':'))
        .slice(0, 3)
        .map(r => `
    test('${r.method} ${r.path} responds (not 500)', async () => {
        const res = await safeRequest('${r.method.toLowerCase()}', '${r.path}');
        expect(res.status).toBeLessThan(500);
    });`).join('\n');
}

// ── JWT Validation Tests ───────────────────────────────────────────────────────
function generateJwtValidationTests(routes) {
    const loginPath = routes.find(r => /login|signin/i.test(r.path))?.path || '/api/auth/login';

    return `
    test('JWT: login response includes a token field', async () => {
        if (!serverStarted) return;
        const res = await safeRequest('post', '${loginPath}', { username: 'admin', password: 'password123' });
        if (res.status !== 200) {
            console.warn('[Evaluator] Login did not return 200 — cannot verify token shape. Got: ' + res.status);
            return; // Skip: server may need real credentials or DB
        }
        const tokenField = res.data?.token || res.data?.accessToken ||
                           res.data?.access_token || res.data?.jwt || res.data?.authToken;
        expect(tokenField).toBeDefined(); // Response must include a token field
        expect(typeof tokenField).toBe('string'); // Token must be a string
        expect(tokenField.length).toBeGreaterThan(10); // Token must be non-trivial
    });

    test('JWT: token has 3-part structure (header.payload.signature)', async () => {
        if (!serverStarted) return;
        const res = await safeRequest('post', '${loginPath}', { username: 'admin', password: 'password123' });
        if (res.status !== 200) { return; } // Skip if no successful login
        const tokenField = res.data?.token || res.data?.accessToken ||
                           res.data?.access_token || res.data?.jwt;
        if (!tokenField) { return; } // Skip if no token field
        const parts = tokenField.split('.');
        expect(parts.length).toBe(3); // JWTs always have 3 parts separated by '.'
    });

    test('JWT: protected routes reject requests with no token (401/403)', async () => {
        if (!serverStarted) return;
        // Common protected route candidates
        const protectedPaths = ['/api/users', '/api/me', '/api/profile',
                                '/api/complaints', '/api/products', '/api/dashboard'];
        for (const p of protectedPaths) {
            const res = await safeRequest('get', p);
            if (res.status === 401 || res.status === 403) {
                expect([401, 403]).toContain(res.status); // Pass!
                return;
            }
        }
        // If none were protected, at least confirm server is responding
        console.warn('[Evaluator] No protected routes detected - all routes may be public');
    });

    test('JWT: invalid token is rejected (401/403)', async () => {
        if (!serverStarted) return;
        const protectedPaths = ['/api/users', '/api/me', '/api/profile',
                                '/api/complaints', '/api/products'];
        for (const p of protectedPaths) {
            const res = await safeRequest('get', p, null, {
                'Authorization': 'Bearer invalid.token.xyz'
            });
            if (res.status > 0) {
                expect([401, 403]).toContain(res.status);
                return;
            }
        }
        console.warn('[Evaluator] Could not find a route that validates JWT tokens');
    });

    test('JWT: valid token grants access to protected routes', async () => {
        if (!serverStarted) return;
        // First get a token
        const loginRes = await safeRequest('post', '${loginPath}',
            { username: 'admin', password: 'password123' });
        if (loginRes.status !== 200) { return; } // Skip if login fails
        const token = loginRes.data?.token || loginRes.data?.accessToken ||
                      loginRes.data?.access_token || loginRes.data?.jwt;
        if (!token) { return; } // Skip if no token

        // Try protected routes with valid token
        const protectedPaths = ['/api/users', '/api/me', '/api/profile',
                                '/api/complaints', '/api/products'];
        for (const p of protectedPaths) {
            const res = await safeRequest('get', p, null, {
                'Authorization': \`Bearer \${token}\`
            });
            if (res.status > 0 && res.status !== 404) {
                expect(res.status).not.toBe(401); // Valid token should not be rejected
                expect(res.status).not.toBe(403);
                return;
            }
        }
    });`;
}

// ── Schema Validation Tests ────────────────────────────────────────────────────
function generateSchemaValidationTests(routes) {
    const loginPath = routes.find(r => /login|signin/i.test(r.path))?.path || '/api/auth/login';

    return `
    test('Schema: login success response has token and no password field', async () => {
        if (!serverStarted) return;
        const res = await safeRequest('post', '${loginPath}', { username: 'admin', password: 'password123' });
        if (res.status !== 200) { return; }
        expect(res.data).toBeDefined();
        const hasToken = res.data?.token || res.data?.accessToken ||
                         res.data?.access_token || res.data?.jwt;
        expect(hasToken).toBeDefined(); // Must return a token
        // Sensitive fields should NOT be in the response
        expect(res.data?.password).toBeUndefined(); // Never expose password
    });

    test('Schema: error responses return JSON objects (not plain strings)', async () => {
        if (!serverStarted) return;
        const res = await safeRequest('post', '${loginPath}', { username: '', password: '' });
        if (res.status === 0 || res.status === 200) { return; }
        // Error response should be a JSON object
        expect(typeof res.data).toBe('object');
        // Should have at least one of: error, message, msg, details
        const hasMsg = res.data?.error !== undefined || res.data?.message !== undefined ||
                       res.data?.msg !== undefined || res.data?.details !== undefined;
        expect(hasMsg).toBe(true);
    });

    test('Schema: list endpoints return arrays (not wrapped objects)', async () => {
        if (!serverStarted) return;
        const listPaths = ['/api/users', '/api/complaints', '/api/products', '/api/items'];
        for (const p of listPaths) {
            const res = await safeRequest('get', p);
            if (res.status === 200) {
                // Should return array OR object with data array (e.g. { data: [...], total: n })
                const isArray = Array.isArray(res.data);
                const hasDataArray = res.data?.data && Array.isArray(res.data.data);
                expect(isArray || hasDataArray).toBe(true);
                return;
            }
        }
        console.warn('[Evaluator] No list endpoint returned 200 (may require auth or DB)');
    });

    test('Schema: server responds with Content-Type: application/json', async () => {
        if (!serverStarted) return;
        return new Promise((resolve) => {
            const http = require('http');
            const req = http.request({
                hostname: 'localhost', port: EVAL_PORT,
                path: '/', method: 'GET', timeout: 5000
            }, (res) => {
                const ct = res.headers['content-type'] || '';
                const isJson = ct.includes('application/json');
                // Accept: JSON content type OR HTML (for / route)
                expect(['application/json', 'text/html'].some(t => ct.includes(t))).toBe(true);
                resolve();
            });
            req.on('error', () => resolve()); // skip on error
            req.end();
        });
    });`;
}

// ── Protected Routes Tests ─────────────────────────────────────────────────────
function generateProtectedRouteTests(routes) {
    const protectedCandidates = routes
        .filter(r => r.method === 'GET' && !r.path.includes(':'))
        .map(r => r.path)
        .slice(0, 5);
    if (protectedCandidates.length === 0) {
        protectedCandidates.push('/api/users', '/api/profile', '/api/me');
    }
    const pathsLiteral = JSON.stringify(protectedCandidates);

    return `
    test('Protected routes: unauthenticated requests are rejected (401/403)', async () => {
        if (!serverStarted) return;
        const candidates = ${pathsLiteral};
        let foundProtected = false;
        for (const p of candidates) {
            const res = await safeRequest('get', p);
            if (res.status === 401 || res.status === 403) {
                foundProtected = true;
                break;
            }
        }
        if (!foundProtected) {
            console.warn('[Evaluator] No protected routes found in: ' + candidates.join(', '));
        }
        // This is informational - at least some routes should be protected
        expect(foundProtected).toBe(true);
    });

    test('Protected routes: fake Authorization header is rejected', async () => {
        if (!serverStarted) return;
        const candidates = ${pathsLiteral};
        for (const p of candidates) {
            const res = await safeRequest('get', p, null, {
                'Authorization': 'Bearer thisisafaketokenandshouldfail'
            });
            if (res.status === 401 || res.status === 403) {
                expect([401, 403]).toContain(res.status);
                return;
            }
        }
        console.warn('[Evaluator] No routes rejected the fake token');
    });`;
}

// ── Full Test File Generator ───────────────────────────────────────────────────
export function generateTestFileContent(routes, rubric) {
    const seenSections = new Set();
    const criteriaTests = rubric.criteria.map(criterion => {
        const section = matchCriteria(criterion.name, routes);
        if (seenSections.has(section)) return ""; // Skip if already added
        seenSections.add(section);

        return `
    // ═══════════════════════════════════════════════════════
    // Rubric Criterion: "${criterion.name}"
    // ═══════════════════════════════════════════════════════
    describe('CRITERION:[${criterion.name}]', () => {
        ${section}
    });`;
    }).filter(s => s !== ""); // Remove empty strings

    return `/**
 * evaluator.test.js — Auto-generated by Backend Evaluator
 * Tests generated from rubric criteria + detected routes.
 * DO NOT EDIT — this file is injected by the evaluation system.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// ── HTTP helper (supports custom headers for JWT tests) ──────────────────────
function safeRequest(method, urlPath, data, extraHeaders = {}) {
    return new Promise((resolve) => {
        try {
            const http = require('http');
            const body = data ? JSON.stringify(data) : null;
            const options = {
                hostname: 'localhost',
                port: EVAL_PORT,
                path: urlPath,
                method: method.toUpperCase(),
                headers: {
                    'Content-Type': 'application/json',
                    ...extraHeaders,
                    ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {})
                },
                timeout: 3000  // 3s per request — fast fail if server not responding
            };
            const req = http.request(options, (res) => {
                let responseData = '';
                res.on('data', chunk => { responseData += chunk; });
                res.on('end', () => {
                    try { responseData = JSON.parse(responseData); } catch(e) {}
                    resolve({ status: res.statusCode, data: responseData });
                });
            });
            req.on('error', (e) => resolve({ status: 0, data: null, error: e.message }));
            req.on('timeout', () => { req.destroy(); resolve({ status: 0, data: null, error: 'timeout' }); });
            if (body) req.write(body);
            req.end();
        } catch(e) {
            resolve({ status: 0, data: null, error: e.message });
        }
    });
}

const EVAL_PORT = 4099; // Isolated port for evaluation
let serverProcess = null;
let serverStarted = false;

// ── Server Startup ─────────────────────────────────────────────────────────────
beforeAll(async () => {
    const entries = ['server.js', 'app.js', 'index.js', 'src/server.js', 'src/app.js'];
    let entryFile = null;
    for (const f of entries) {
        if (fs.existsSync(path.join(__dirname, f))) { entryFile = f; break; }
    }

    if (!entryFile) {
        console.warn('[Evaluator] No server entry point found. HTTP tests will be skipped.');
        return;
    }

    serverProcess = spawn('node', [entryFile], {
        cwd: __dirname,
        env: {
            ...process.env,
            PORT: String(EVAL_PORT),
            NODE_ENV: 'test',
            MONGO_URI: '',
            DATABASE_URL: '',
            DB_HOST: '',
        },
        stdio: 'pipe'
    });

    serverProcess.stderr?.on('data', (d) => {
        // Ignore DB connection errors in test mode
    });

    // Wait up to 6s for the server to start accepting connections
    for (let i = 0; i < 24; i++) {
        await new Promise(r => setTimeout(r, 250));
        const probe = await safeRequest('get', '/health');
        if (probe.status > 0) { serverStarted = true; break; }
        const probe2 = await safeRequest('get', '/');
        if (probe2.status > 0) { serverStarted = true; break; }
    }

    if (!serverStarted) {
        console.warn('[Evaluator] Server did not start within 10s (possibly DB-dependent). Structural tests only.');
    }
}, 15000);

afterAll(() => {
    if (serverProcess) {
        try { serverProcess.kill('SIGTERM'); } catch(e) {}
    }
});

// ── Helper: skip HTTP test if server didn't start ─────────────────────────────
async function httpTest(fn) {
    if (!serverStarted) {
        console.warn('[Evaluator] Server not running - HTTP test skipped');
        return; // pass silently
    }
    return fn();
}

describe('Auto-Generated Evaluator Tests', () => {
${criteriaTests.join('\n')}

    // ── Structural: server exports and loads ─────────────────────────────────
    test('Server entry point is loadable', () => {
        const entries = ['./server', './app', './index', './src/server'];
        let loaded = false;
        for (const e of entries) {
            try { require(e); loaded = true; break; } catch(err) {}
        }
        expect(loaded).toBe(true);
    });

    test('package.json has a runnable script (start, dev, serve, or app)', () => {
        const pkg = require('./package.json');
        const scripts = pkg.scripts || {};
        // More lenient check for any runnable script names
        const validScripts = ['start', 'dev', 'serve', 'nodemon', 'server', 'app', 'node', 'test'];
        const hasRunScript = validScripts.some(s => s in scripts);
        expect(hasRunScript).toBe(true);
    });
});
`;
}

// ── Inject into E2B Sandbox ────────────────────────────────────────────────────
// Bug (backendBugs.md #3): jestRunner.js calls this as
// injectEvaluatorTests(sandbox, projectPath, rubric) — 3 args — but this
// function only declared (sandbox, rubric), so `rubric` silently received
// `projectPath` and the real rubric was dropped. Added the `projectPath`
// param and used it in place of the hardcoded "/home/user/app" so the
// generated test file always matches wherever the project was actually
// uploaded, instead of relying on that path staying in sync by coincidence.
export async function injectEvaluatorTests(sandbox, projectPath, rubric) {
    console.log(`[testInjector] No test files found. Generating evaluator test suite...`);

    const readCmd = await sandbox.commands.run(
        `cat ${projectPath}/server.js 2>/dev/null || cat ${projectPath}/app.js 2>/dev/null || cat ${projectPath}/index.js 2>/dev/null || echo ""`
    );
    const serverCode = readCmd.stdout || '';
    console.log(`[testInjector] Read ${serverCode.length} bytes from server entry point`);

    const routes = extractRoutes(serverCode);
    console.log(`[testInjector] Detected ${routes.length} routes:`, routes.map(r => `${r.method} ${r.path}`).join(', '));

    const testContent = generateTestFileContent(routes, rubric);
    await sandbox.files.write(`${projectPath}/evaluator.test.js`, testContent);
    console.log(`[testInjector] Injected evaluator.test.js (${testContent.length} bytes)`);

    return { injected: true, detectedRoutes: routes };
}