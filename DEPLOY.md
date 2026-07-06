# Deploying the visual evaluator (free tier)

This deploy runs **only the visual evaluator**. The other 5 evaluator types
(JS, Python, React, Backend, Fullstack) are intentionally disabled — see the
comment in `server.js` — to fit Render's free-tier RAM (512MB) and keep scope
tight. Re-enable them later by restoring the worker imports/calls in
`server.js` and the entries in `public/app.js`'s `EVALUATORS` object.

## One-time setup on Render

1. Go to https://dashboard.render.com → **New** → **Web Service**.
2. Connect the `Barabari-Tech-Collective/central-evaluators` GitHub repo, branch `main`.
3. Render will detect `render.yaml` (Blueprint) — or if creating manually:
   - **Environment**: Docker
   - **Plan**: Free
   - **Health check path**: `/health`
4. Set these environment variables in the Render dashboard (**never commit them**):

   | Key | Value |
   |---|---|
   | `API_KEY` | any long random string you choose — this is what the frontend's Settings drawer needs to call `/evaluate` |
   | `REDIS_HOST` | your managed Redis host |
   | `REDIS_PORT` | your managed Redis port |
   | `REDIS_USERNAME` | `default` (or your ACL user) |
   | `REDIS_PASSWORD` | your **new**, rotated Redis password |
   | `OPENAI_API_KEY` | your **new**, rotated OpenAI key (only key the visual evaluator needs — Groq/E2B are not used by it) |

   These are already pre-declared as `sync: false` in `render.yaml`, so Render will just prompt you for values instead of reading them from any file.

5. Deploy. First build takes longer than usual (~1-2GB Playwright base image) — that's expected.

## Giving the team access

- Share the Render URL (e.g. `https://central-evaluators-visual.onrender.com`).
- Each tester opens the page, clicks **⚙️ Settings**, and pastes the same `API_KEY` value you set above.
- Free tier sleeps after 15 minutes of inactivity — the first request after a sleep takes ~30-60s to wake up. This is a known free-tier trade-off, not a bug.

## Known limits of this trimmed deploy

- Only the Visual/UI evaluator works; the other 5 evaluator forms aren't shown.
- `BROWSER_POOL_SIZE=1` / `VISUAL_CONCURRENCY=1` — visual jobs run one at a time. If several people submit at once, later ones wait in queue (this is safe, just slower) rather than fail.
- Free-tier sleep/wake — acceptable for testing, not for production-grade uptime.
