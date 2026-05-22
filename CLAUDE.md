# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the Server

```bash
node server.js
```

The server starts on port 3000 with a single endpoint: `POST /evaluate`.

**Prerequisites:**
- Redis running on `127.0.0.1:6379`
- `.env` file with `GROQ_API_KEY`, `GROQ_BASE_URL`, and E2B/OpenAI API keys as needed

There are no configured test scripts.

## Architecture Overview

This is a distributed automated evaluation platform for student code submissions. All evaluation happens asynchronously through a BullMQ + Redis queue system.

### Request Flow

```
POST /evaluate
  → evaluatorController.js     # Validates and dispatches
  → evaluationRouter.js        # Routes by type to the appropriate queue
  → [type]-evaluation queue    # BullMQ queue backed by Redis
  → [type]Worker.js            # Worker picks up job and calls the evaluator
  → evaluators/[type]/         # Core evaluation logic
```

### Five Evaluator Types

Each has its own queue, worker, and evaluator directory:

| Type | Queue | Worker | Evaluator Path |
|------|-------|--------|----------------|
| `javascript` | `javascript-evaluation` | `workers/jsWorker.js` | `evaluators/js/` |
| `python` | `python-evaluation` | `workers/pythonWorker.js` | `evaluators/python/` |
| `backend` | `backend-evaluation` | `workers/backendWorker.js` | `evaluators/backend/` |
| `react` | `react-evaluation` | `workers/reactWorker.js` | `evaluators/react/` |
| `visual` | `visual-evaluation` | `workers/visualWorker.js` | `evaluators/visual/` |

### Execution Strategies

- **JS evaluator:** VM2 sandboxed execution with 1-second timeout
- **Python evaluator:** Direct subprocess execution with I/O comparison
- **Backend evaluator:** E2B sandbox — clones repo, auto-detects JS vs Python, injects test files, runs Jest or Pytest, scores against rubric, generates AI feedback via Groq
- **React evaluator:** E2B sandbox — runs dev server, uses Playwright for browser automation (rendering, props, state, routing, API mocking)
- **Visual evaluator:** Playwright Chromium — DOM selector checks, behavior interaction tests, GPT-4o Vision comparison against a reference URL

### Scoring

- **JS/Python:** `(passed / total) * 100`
- **Backend:** Weighted rubric criteria + performance thresholds (500ms)
- **React:** Category-based rubric (components, props, state, routing, API)
- **Visual:** `domScore + behaviorScore + visualScore` (Vision AI provides visual score 0–100)

### AI Feedback

- **Backend:** Groq (`llama-3.1-8b-instant`) — analyzes failed tests, provides debugging hints
- **Visual:** OpenAI GPT-4o Vision — compares screenshots, evaluates CSS/layout

### Repo Handling

All evaluators clone repos via `simple-git` with `--depth 1` into `/tmp/` subdirectories. Cleanup happens on failure.

## Key Files

- `server.js` — Express entry point
- `queues/queueManager.js` — All BullMQ queue definitions
- `queues/redis.js` — Redis connection (hardcoded to `127.0.0.1:6379`)
- `evaluators/backend/evaluatorService.js` — Orchestrates backend eval pipeline
- `evaluators/visual/evaluatorService.js` — Orchestrates visual eval pipeline
- `evaluators/react/playwrightTests.js` — All Playwright test logic for React
