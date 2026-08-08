# Deploy Runbook — Railway (no credit card required)

Fly.io dropped its free tier in 2024 and now requires a card after a 2-hour
trial, so this is the recommended path instead. Railway's Trial plan:

- **No credit card to sign up.** You get a one-time $5 usage credit, good
  for 30 days.
- **Real persistent volumes** — up to 50GB during the trial (they shrink to
  10GB after, and trial volumes are deleted 30 days after the trial credit
  expires — irrelevant for a 48-hour observation window).
- **No forced sleep.** Unlike Render's free tier (15-minute inactivity
  spin-down with *no* persistent disk at all on free services), Railway's
  "App Sleeping" feature is opt-in and disabled by default — your service
  stays up continuously unless you turn sleeping on.
- A tiny single-instance Node app running 48 hours costs a small fraction of
  the $5 credit.

Do this early — see the note at the top of `DEPLOY.md` about why
initializing at hour ~6 instead of hour ~23 matters. That reasoning applies
here unchanged; only the hosting steps below differ.

---

## 0. Prerequisites

```bash
# Install the CLI
curl -fsSL https://railway.com/install.sh | sh

# Log in (opens a browser, no card required)
railway login
```

## 1. Create the project

```bash
cd /path/to/repo
railway init
```

This prompts for a project name and creates it. It does **not** deploy yet.

## 2. Deploy

Railway auto-detects the `Dockerfile` already in this repo — no extra config
needed.

```bash
railway up
```

Watch the build logs for errors. Once it's live, generate a public domain:

```bash
railway domain
```

This prints a URL like `https://<something>.up.railway.app`. Save it:

```bash
export APP_URL="https://<something>.up.railway.app"
```

## 3. Set environment variables

Railway auto-injects `PORT` (the app already reads `process.env.PORT`, so
this just works). Set the rest to match the scheduler defaults from T4:

```bash
railway variables --set "DATA_DIR=/data" \
  --set "PUBLISH_INTERVAL_MINUTES=75" \
  --set "AUTONOMOUS_TICK_SECONDS=30" \
  --set "PUBLISH_JITTER_PCT=0.2" \
  --set "EDITORIAL_THRESHOLD_FLOOR=2.0" \
  --set "MAX_CATCHUP_POSTS=3"
```

Optional, only once T6 (LLM-backed writer) is implemented — never put this
in a committed file:

```bash
railway variables --set "ANTHROPIC_API_KEY=sk-ant-..."
```

## 4. Attach a persistent volume — do not skip this

This is the fix for the single most likely way to lose the submission: an
ephemeral filesystem wiping `data/state.json` on restart.

```bash
railway volume add
```

This is interactive: pick the service, then enter the mount path `/data`
when prompted. It redeploys the service automatically to attach the volume.

Confirm it's attached:

```bash
railway volume list
```

## 5. Redeploy so the new variables and volume take effect

```bash
railway up
```

Then check the logs:

```bash
railway logs
```

Look for `Autonomous AI Creator listening on http://localhost:3000` and
confirm there is **no** `WARN state-not-durable` line. If you see that
warning, the volume didn't mount at `/data` — go back to step 4 and confirm
the mount path exactly matches `DATA_DIR`.

## 6. Smoke-test against the deployed URL

```bash
curl -s "$APP_URL/health" | jq .
curl -s "$APP_URL/api/agent/feed?agentId=nonexistent" | jq .   # 200, empty posts
```

## 7. Initialize the agent — ONE TIME ONLY

```bash
curl -s -X POST "$APP_URL/api/agent/init" \
  -H "content-type: application/json" \
  -d '{"persona":{"name":"Ada","domain":"AI Security"}}' | tee /tmp/init-response.json | jq .

export AGENT_ID=$(jq -r .agentId /tmp/init-response.json)
echo "Production agentId: $AGENT_ID"
```

Save `$AGENT_ID` immediately — this runbook's output, your notes, and the
README (step 10). Do not run this `init` call again against this URL.

## 8. Confirm the schedule is alive

```bash
curl -s "$APP_URL/health" | jq .
curl -s "$APP_URL/api/agent/feed?agentId=$AGENT_ID" | jq '.posts | length'
```

Per T4, the first post should exist within about 90 seconds of init. If
`posts` is still `0` after a few minutes, check `railway logs` for discovery
errors — the agent retries every minute with a decayed threshold until
something clears the bar.

## 9. Restart test — the check that saves the submission

```bash
railway redeploy
sleep 20
curl -s "$APP_URL/health" | jq .
curl -s "$APP_URL/api/agent/feed?agentId=$AGENT_ID" | jq '.posts | length'
```

The post count must match what it was before the restart, and `agentId`
must still resolve. If posts came back empty, the volume isn't actually
mounted — fix this before trusting the deployment with 48 hours of
evaluation.

## 10. Record the URL and agentId

Update the top of `README.md`:

```markdown
> **Live demo:** https://<something>.up.railway.app
> **Production `agentId`:** agent-xxxxxxxx
```

```bash
git add README.md
git commit -m "docs: record the live demo URL and production agentId"
git push
```

## 11. External keep-alive (belt-and-braces)

Railway shouldn't sleep this service by default, but add an external ping
anyway as a second line of defense against any platform-side restart —
free at [cron-job.org](https://cron-job.org):

- URL: `$APP_URL/health`
- Method: GET
- Interval: every 5 minutes

Confirm at least 3 pings have succeeded before moving on.

## 12. Ongoing verification (spread across the next several hours)

```bash
curl -s "$APP_URL/api/agent/feed?agentId=$AGENT_ID" | jq '.posts | length, .posts[0].createdAt'
```

Check back at least 3 times, spaced 2+ hours apart. The post count should
only ever go up, and every prior post should still be present.

## 13. No secrets leaked

```bash
git log -p | grep -i 'sk-ant' && echo "LEAK FOUND - fix before submitting" || echo "clean"
```

## 14. Watch the trial credit

```bash
railway status
```

Check the dashboard's usage page occasionally. A single small instance for
48 hours should use well under the $5 trial credit, but confirm this isn't
drifting if you're also running other Railway projects on the same account.

---

## Rollback / troubleshooting

- **`WARN state-not-durable` in logs** → the volume isn't mounted at
  `/data`. Run `railway volume list` to confirm it's attached to the right
  service, and re-check the mount path from step 4.
- **Feed returns 0 posts for a long time** → check `railway logs` for
  repeated discovery failures. The scheduler retries every minute with a
  decaying threshold, so this should self-heal within a few minutes unless
  all three sources (Hacker News, Dev.to, arXiv) are unreachable from
  Railway's network.
- **Need to redeploy after a code change** → `git push` then `railway up`
  again (or connect the GitHub repo in the dashboard for auto-deploys on
  push). The volume and its data persist across deploys; no re-init needed.
- **Made a mistake and need a fresh agent** → do not delete and recreate the
  volume just to reset state; that also destroys legitimate history. Only
  do this before any evaluator has recorded an `agentId`.
- **Trial credit runs low** → this is unlikely for a tiny 48-hour deployment,
  but if it happens, Railway pauses the service rather than deleting the
  volume — top up (requires a card at that point) or move quickly to
  finish the evaluation window.

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
