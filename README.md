# Central Evaluators Platform

A distributed automated evaluation platform for assessing student submissions across multiple domains including Backend, React, Python, JavaScript, and Visual/UI assignments.

Built using Node.js, BullMQ, Redis, E2B Sandboxes, Jest, Pytest, and Playwright.

---

# Overview

This platform is designed to process and evaluate coding submissions asynchronously using queue-based workers.

Each evaluator type has:
- Dedicated queues
- Dedicated workers
- Isolated execution flow
- Sandbox-based execution
- Custom scoring system
- AI-powered feedback generation

The system supports scalable batch evaluations for colleges, bootcamps, and large-scale learning platforms.

---

# Core Features

- Multi-evaluator architecture
- Queue-based asynchronous processing
- Distributed workers
- Secure sandbox execution
- Repository-based evaluation
- Automated scoring engine
- AI-generated feedback
- Multi-language support
- Horizontal scalability
- Concurrent evaluation handling

---

# Tech Stack

## Backend
- Node.js
- Express.js

## Queue System
- BullMQ
- Redis

## Sandbox
- E2B Sandboxes

## Testing Frameworks
- Jest
- Pytest
- Playwright

## AI Feedback
- OpenAI / Groq APIs

---

# Folder Structure

```bash
src/
│
├── controllers/
│    └── evaluationController.js
│
├── routers/
│    └── evaluationRouter.js
│
├── queues/
│    ├── queueManager.js
│    └── redis.js
│
├── workers/
│    ├── pythonWorker.js
│    ├── jsWorker.js
│    ├── reactWorker.js
│    ├── backendWorker.js
│    └── visualWorker.js
│
├── evaluators/
│    ├── backend/
│    ├── react/
│    ├── python/
│    ├── javascript/
│    └── visual/
│
├── server.js
└── package.json
```
## Docs for System Architecture
https://docs.google.com/document/d/1rF_IMoXXTm64bAWewCLNPOlHjmauFVcK_f547ZNAI1c/edit?usp=sharing
