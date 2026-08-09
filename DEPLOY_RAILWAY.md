## Deploy Runbook - Railway

This document has two different audiences:

- **Evaluators:** use the "Evaluator quick check" section only. You do not need
  Railway access, the Railway CLI, or the project owner's account.
- **Project owner:** use the "Owner deployment steps" section only when creating
  or updating the hosted deployment.

Railway is the hosting platform used for this backend. It is similar in purpose
to Vercel, but this project needs a continuously running Node server plus a
persistent volume at `/data`, which makes Railway a better fit for this agent.

---

## Evaluator Quick Check

Use the already-deployed backend:

```bash
export APP_URL= "https://aps-autobot-production.up.railway.app"
export AGENT_ID= agent-e72db96a
```

Check that the service is alive:

```bash
curl -s "$APP_URL/health" | jq .
```

Expected shape:

```json
{
  "ok": true,
  "agents": 1,
  "posts": 2,
  "lastCycleAt": "2026-08-09T03:45:02.951Z",
  "nextPublishAt": "2026-08-09T04:27:01.674Z"
}
```

Check the feed:

```bash
curl -s "$APP_URL/api/agent/feed?agentId=$AGENT_ID" | jq .
```

Check only the post count:

```bash
curl -s "$APP_URL/api/agent/feed?agentId=$AGENT_ID" | jq '.posts | length'
```

The scheduler is live if:

- `/health` returns `"ok": true`.
- `posts` is greater than `0`.
- `lastCycleAt` is recent.
- `nextPublishAt` is a future timestamp.
- Running the health check later shows `lastCycleAt`, `nextPublishAt`, or
  `posts` changing.

Do **not** run these owner-only commands while evaluating the existing hosted
demo:

```bash
railway up
railway redeploy
railway volume add
railway variables --set ...
```

Those commands require the project owner's Railway account and may restart or
modify the production deployment.

---

## Owner Deployment Steps

Use this section only if you are deploying or updating the Railway service.

## 0. Prerequisites

```bash
curl -fsSL https://railway.com/install.sh | sh
railway login
```

Confirm login:

```bash
railway whoami
```

## 1. Create Or Link The Project

If this is the first deployment:

```bash
cd /path/to/repo
railway init
```

If the project already exists:

```bash
cd /path/to/repo
railway link
```

Confirm Railway knows the project, environment, service, URL, and volume:

```bash
railway status
```

Expected important fields:

```text
Project: AP's AUTOBOT
Environment: production
Linked service: AP's AUTOBOT
url: https://aps-autobot-production.up.railway.app
volume: ap's-autobot-volume - /data
```

## 2. Set Environment Variables

Railway injects `PORT` automatically. Set the scheduler and storage variables:

```bash
railway variables --set "DATA_DIR=/data" \
  --set "PUBLISH_INTERVAL_MINUTES=75" \
  --set "AUTONOMOUS_TICK_SECONDS=30" \
  --set "PUBLISH_JITTER_PCT=0.2" \
  --set "EDITORIAL_THRESHOLD_FLOOR=2.0" \
  --set "MAX_CATCHUP_POSTS=3"
```

Only after the LLM-backed writer/editor is implemented, optionally set the
Anthropic key as a private Railway variable:

```bash
railway variables --set "ANTHROPIC_API_KEY=sk-ant-..."
```

Never commit a real API key to GitHub, README files, deployment docs, or
`.env.example`.

## 3. Attach A Persistent Volume

The volume keeps `/data/state.json` alive across restarts and redeploys.

```bash
railway volume add
```

If Railway says no service is linked, run:

```bash
railway link
railway volume add
```

When prompted for the mount path, use:

```text
/data
```

Confirm the volume:

```bash
railway volume list
```

You want to see:

```text
Attached to: AP's AUTOBOT
Mount path: /data
Status: Ready
```

## 4. Deploy Or Redeploy

Use this only after code or Railway configuration changes:

```bash
railway up
```

If the latest deployment already exists and you only need a restart:

```bash
railway redeploy
```

After redeploying, wait longer than 20 seconds before judging health:

```bash
sleep 60
curl -s "$APP_URL/health" | jq .
```

A temporary `502 Application failed to respond` immediately after redeploy can
happen while the container is restarting. If `/health` becomes healthy after a
minute or two, the deployment is fine.

## 5. Set The Public URL Locally

```bash
export APP_URL="https://aps-autobot-production.up.railway.app"
```

If using a new Railway domain, replace that URL with the one from:

```bash
railway domain
```

## 6. Initialize The Agent - One Time Only

Run this only once for the production URL:

```bash
curl -s -X POST "$APP_URL/api/agent/init" \
  -H "content-type: application/json" \
  -d '{"persona":{"name":"Ada","domain":"AI Security"}}' \
  | tee /tmp/init-response.json | jq .
```

Save the agent id:

```bash
export AGENT_ID=$(jq -r .agentId /tmp/init-response.json)
echo "Production agentId: $AGENT_ID"
```

If `Production agentId:` is blank, debug with:

```bash
cat /tmp/init-response.json
curl -i -X POST "$APP_URL/api/agent/init" \
  -H "content-type: application/json" \
  -d '{"persona":{"name":"Ada","domain":"AI Security"}}'
```

Do not keep re-running `/api/agent/init` once a real production `agentId` has
been created and recorded.

## 7. Verify The Schedule

```bash
curl -s "$APP_URL/health" | jq '{ok, uptimeSeconds, agents, posts, lastCycleAt, nextPublishAt, nextPublishReason}'
curl -s "$APP_URL/api/agent/feed?agentId=$AGENT_ID" | jq '.posts | length'
```

The first post should exist within about 90 seconds of initialization. Later
checks should show the post count increasing and `lastCycleAt` moving forward.

## 8. Restart Persistence Test

Before redeploy:

```bash
curl -s "$APP_URL/health" | jq '{posts, lastCycleAt, nextPublishAt}'
```

Redeploy:

```bash
railway redeploy
```

Wait and verify:

```bash
sleep 60
curl -s "$APP_URL/health" | jq '{ok, posts, lastCycleAt, nextPublishAt}'
curl -s "$APP_URL/api/agent/feed?agentId=$AGENT_ID" | jq '.posts | length'
```

Passing result: the post count is still present after redeploy. That proves the
volume is mounted and state survived.

---

## Troubleshooting

### `reqwest error` or `operation timed out`

Example:

```text
error sending request for url (https://backboard.railway.com/graphql/v2)
operation timed out
```

This is a Railway CLI/network problem, not necessarily an app problem. Check
the deployed app directly:

```bash
curl -s "$APP_URL/health" | jq .
curl -s "$APP_URL/api/agent/feed?agentId=$AGENT_ID" | jq '.posts | length'
```

If the app responds, the backend is working. Use the Railway dashboard for logs
or retry the CLI later.

Helpful CLI checks:

```bash
railway whoami
railway status
railway link
```

If the CLI keeps timing out, switch network/VPN or use the Railway web
dashboard.

### `502 Application failed to respond`

This can happen for a short time during redeploy. Wait 60-120 seconds and check:

```bash
curl -s "$APP_URL/health" | jq .
```

If `/health` returns `"ok": true`, the redeploy recovered.

If it still returns 502 after several minutes, open Railway dashboard -> service
-> logs and check the startup error.

### `/tmp/init-response.json` Is Empty

Usually `APP_URL` was blank or the init request failed.

```bash
echo "$APP_URL"
curl -i -X POST "$APP_URL/api/agent/init" \
  -H "content-type: application/json" \
  -d '{"persona":{"name":"Ada","domain":"AI Security"}}'
```

### `agentId=nonexistent`

This is only a robustness test. It is not your real agent id.

The real id comes from:

```bash
curl -s -X POST "$APP_URL/api/agent/init" \
  -H "content-type: application/json" \
  -d '{"persona":{"name":"Ada","domain":"AI Security"}}' \
  | tee /tmp/init-response.json | jq .
```

Then:

```bash
export AGENT_ID=$(jq -r .agentId /tmp/init-response.json)
```

### `railway volume add` Says No Service Found

Run:

```bash
railway link
railway status
railway volume add
```

Choose the project and linked service, then mount at `/data`.

### `WARN state-not-durable`

The app is warning that `/data` is not writable or not mounted. Confirm:

```bash
railway volume list
railway variables
```

`DATA_DIR` must be `/data`, and the volume mount path must also be `/data`.

---

## README Snippet For Evaluators

Paste this near the top of `README.md` after replacing the agent id:

````markdown
## Live Demo

Backend URL: https://aps-autobot-production.up.railway.app
Production agentId: agent-e72db96a

Check health:

```bash
export APP_URL="https://aps-autobot-production.up.railway.app"
export AGENT_ID="PASTE_PRODUCTION_AGENT_ID_HERE"
curl -s "$APP_URL/health" | jq .
```

Check feed:

```bash
curl -s "$APP_URL/api/agent/feed?agentId=$AGENT_ID" | jq .
```

The evaluator does not need Railway CLI access. The bot is already deployed and
publishes autonomously on the hosted backend.
````
## Why not Fly.io or Render?

- **Fly.io** requires a credit card after a 2-hour trial (as of 2024's
  pricing change) — not card-free for a 48-hour window.
- **Render's free tier** doesn't require a card, but free web services
  **cannot attach a persistent disk at all** — every sleep/redeploy wipes
  `data/state.json`. It's usable in a pinch only if you keep the process
  alive continuously via an aggressive external ping (every 5-10 minutes,
  under Render's 15-minute inactivity timeout) so the *same* process never
  restarts and the in-memory fallback in `src/store.js` carries the state —
  but this is fragile compared to Railway's real volume and isn't
  recommended as the primary path.
