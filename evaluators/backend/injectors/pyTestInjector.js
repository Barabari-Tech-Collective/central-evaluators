/**
 * pythonTestInjector.js
 * ─────────────────────────────────────────────────────────────
 * Generates and injects a pytest file into the FastAPI sandbox.
 * Support for FastAPI apps, using TestClient for stability.
 */

function sanitize(name) {
    return name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

// Bug (backendBugs.md #21): route detection only ever looked at a single
// entry file (main.py/app.py), which misses routes defined via FastAPI's
// APIRouter pattern (e.g. `routers/auth_router.py`, mounted from main.py
// with `app.include_router(...)`) — a common, encouraged layout for
// anything beyond a trivial single-file app. injectPythonTests() now feeds
// this function the *concatenated* content of every .py file that contains
// a route decorator, joined by FILE_SEPARATOR, so each file's routes (and
// its own APIRouter `prefix=`, if any) can be resolved independently before
// merging. A plain (unseparated) string still works exactly as before —
// split() on a string with no separator just yields a single chunk.
const FILE_SEPARATOR = '###FILE###';

function extractRoutesFromSource(code) {
    const routes = [];

    // Resolve this file's router prefix, if it declares one:
    // router = APIRouter(prefix="/api/auth", ...)
    let prefix = '';
    const apiRouterMatch = code.match(/APIRouter\(([^)]*)\)/);
    if (apiRouterMatch) {
        const prefixMatch = apiRouterMatch[1].match(/prefix\s*=\s*['"`]([^'"`]*)['"`]/);
        if (prefixMatch) prefix = prefixMatch[1].replace(/\/+$/, '');
    }

    // Pattern for @app.get("/path"), @router.post('/path'), etc.
    // (`*` instead of `+` so `@router.get("")` — a common way to mount a
    // router's own root path — still matches.)
    const routeRegex = /@(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]*)['"`]/gi;
    let match;
    while ((match = routeRegex.exec(code)) !== null) {
        const method = match[1].toUpperCase();
        const rawPath = match[2];
        let path;
        if (!prefix) {
            path = rawPath;
        } else if (rawPath === '' || rawPath === '/') {
            path = prefix;
        } else {
            path = `${prefix}${rawPath.startsWith('/') ? '' : '/'}${rawPath}`;
        }
        routes.push({ method, path: path || '/' });
    }
    return routes;
}

function extractPythonRoutes(code) {
    const routes = [];
    const seen = new Set();

    for (const fileCode of code.split(FILE_SEPARATOR)) {
        if (!fileCode.trim()) continue;
        for (const route of extractRoutesFromSource(fileCode)) {
            const key = `${route.method}:${route.path}`;
            if (!seen.has(key)) {
                seen.add(key);
                routes.push(route);
            }
        }
    }
    return routes;
}

const PYTHON_CRITERION_PATTERNS = [
    {
        keywords: ['auth', 'login', 'register', 'signup'],
        generate: (routes) => generatePythonAuthTests(routes)
    },
    {
        keywords: ['health', 'status', 'ping'],
        generate: () => `
def test_health_check(marker):
    paths = ["/health", "/status", "/ping", "/"]
    responded = False
    for p in paths:
        response = client.get(p)
        if response.status_code < 500:
            responded = True
            break
    assert responded is True, "No health or root endpoint responded successfully"
`
    },
    {
        keywords: ['database', 'db', 'mongo', 'mysql', 'postgres', 'sqlalchemy', 'tortoise'],
        generate: () => `
def test_database_dependencies(marker):
    import os
    # Check requirements.txt or common DB packages in environment
    try:
        with open("requirements.txt", "r") as f:
            content = f.read().lower()
            drivers = ["sqlalchemy", "motor", "pymongo", "psycopg2", "aiopg", "tortoise", "databases", "beanie"]
            has_driver = any(d in content for d in drivers)
            assert has_driver is True, "No common database driver found in requirements.txt"
    except FileNotFoundError:
        pass # Skip if no requirements.txt
`
    }
];

function generatePythonAuthTests(routes) {
    const loginPath = routes.find(r => /login|signin/i.test(r.path))?.path || '/login';
    return `
def test_auth_login_exists(marker):
    response = client.post("${loginPath}", json={"username": "test", "password": "test"})
    assert response.status_code != 404, "Login endpoint not found"

def test_auth_login_rejects_empty(marker):
    response = client.post("${loginPath}", json={})
    assert response.status_code != 200, "Login should not succeed with empty body"
`;
}

function matchPythonCriteria(criterionName, routes) {
    const nameLower = criterionName.toLowerCase();
    for (const pattern of PYTHON_CRITERION_PATTERNS) {
        if (pattern.keywords.some(k => nameLower.includes(k))) {
            return pattern.generate(routes);
        }
    }
    return `
def test_generic_endpoint_check(marker):
    # Verify at least one detected route works
    response = client.get("/")
    assert response.status_code < 500
`;
}

export function generatePythonTestFile(routes, rubric) {
    const seenSections = new Set();
    const testSections = rubric.criteria.map(criterion => {
        const section = matchPythonCriteria(criterion.name, routes);
        if (seenSections.has(section)) return "";
        seenSections.add(section);

        // Bug: reported live — a criterion's generated section can contain
        // more than one `def test_...` function (generatePythonAuthTests
        // returns two: login-exists and login-rejects-empty). A Python
        // decorator only ever applies to the single `def` immediately
        // following it, so prepending @pytest.mark.parametrize(...) once
        // before the whole section only tagged the *first* function with
        // this criterion's CRITERION:[...] marker — the second ran and
        // could fail, but with no marker at all its nodeid never matched
        // this (or any) criterion in normalizePytestResults/scoringService,
        // so a real failure (e.g. login not rejecting empty credentials)
        // silently counted toward nothing and the criterion still scored
        // 100%. Confirmed live: backend-eval-demo-beginner-python scored
        // 100/100 with test_auth_login_rejects_empty actually failing.
        // Fix: insert the decorator before *every* `def test_` in the
        // section, not just once before the whole block.
        const decorator = `@pytest.mark.parametrize("marker", ["CRITERION:[${criterion.name}]"])`;
        const decoratedSection = section.replace(/^def test_/gm, `${decorator}\ndef test_`);

        return `\n${decoratedSection}\n`;
    }).join('\n');

    return `import pytest
import importlib
import os
import sys

# Standard FastAPI testing tool
from fastapi.testclient import TestClient

# Add current directory to path so we can import the app
sys.path.append(os.getcwd())

# Try to find the FastAPI app instance
def get_app():
    entries = ["main", "app", "index", "src.main", "src.app"]
    for entry in entries:
        try:
            mod = importlib.import_module(entry)
            if hasattr(mod, "app"):
                return mod.app
        except Exception:
            continue
    return None

app = get_app()
if app is None:
    raise Exception("Could not find FastAPI 'app' instance in common entry points.")

# Initialize the TestClient
client = TestClient(app)

${testSections}

def test_app_loadable():
    assert app is not None
`;
}

// Bug (backendBugs.md #3): pytestRunner.js calls this as
// injectPythonTests(sandbox, projectPath, rubric) — 3 args — but this
// function only declared (sandbox, rubric), so `rubric` silently received
// `projectPath` and the real rubric was dropped. Added the `projectPath`
// param and used it instead of the hardcoded "/home/user/app".
export async function injectPythonTests(sandbox, projectPath, rubric) {
    console.log(`[pythonTestInjector] Generating Python/FastAPI tests...`);

    // Route decorators are commonly split across files (FastAPI's
    // APIRouter pattern: e.g. routers/auth_router.py, wired up from
    // main.py via app.include_router(...)) — scan every .py file that
    // contains an @app./@router. route decorator, not just main.py/app.py,
    // and merge routes found across all of them (backendBugs.md #21).
    // `find ... -exec ... {} +` / `while read -r f; do ... "$f"; done`
    // avoids ever splicing an untrusted filename into a shell string.
    const readCmd = await sandbox.commands.run(
        `find ${projectPath} -type f -name "*.py" ` +
        `-not -path "*/venv/*" -not -path "*/.venv/*" -not -path "*/__pycache__/*" -not -path "*/site-packages/*" ` +
        `-exec grep -lE "@(app|router)\\.(get|post|put|delete|patch)" {} + 2>/dev/null ` +
        `| while IFS= read -r f; do echo '${FILE_SEPARATOR}'; cat -- "$f"; done`
    );
    const code = readCmd.stdout || "";
    const routes = extractPythonRoutes(code);

    const testContent = generatePythonTestFile(routes, rubric);
    await sandbox.files.write(`${projectPath}/test_evaluator.py`, testContent);

    return { injected: true, detectedRoutes: routes };
}