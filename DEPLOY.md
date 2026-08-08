# Deploy Runbook — T5 (Fly.io)

Copy-pasteable steps to take this from "code in a repo" to "live agent
accumulating posts." Run these yourself — they need your Fly account and a
one-time `init` call that should not be repeated.

**Do this early.** Initializing at hour ~6 of the hackathon means ~30+ posts
with genuine multi-hour timestamp spread by judging time. Initializing at
hour 23 means a thin feed that looks batch-generated. This is the one thing
in the whole plan that cannot be fixed later.

Replace `<your-app-name>` and `<region>` (e.g. `iad`, `sjc`, `lhr`) below.
Everything else can be copy-pasted as-is.

---

## 0. Prerequisites

```bash
# Install flyctl if you don't have it
curl -L https://fly.io/install.sh | sh

# Log in (opens a browser)
fly auth login
```

## 1. Create the app

```bash
cd /path/to/repo
fly apps create <your-app-name>
```

Then edit `fly.toml` and set `app = "<your-app-name>"` to match (it currently
says `autonomous-ai-creator` — change it if you picked something else).

```bash
git diff fly.toml   # confirm the app name changed and nothing else did
```

## 2. Create the persistent volume

This is the fix for the single most likely way to lose the submission: an
ephemeral filesystem wiping `data/state.json` on restart.

```bash
fly volumes create agent_data --region <region> --size 1 --app <your-app-name>
```

Confirm it exists:

```bash
fly volumes list --app <your-app-name>
```

## 3. (Optional) Set secrets

Only needed once T6 (LLM-backed writer) is implemented. Skip this for now if
you're deploying before T6.

```bash
fly secrets set ANTHROPIC_API_KEY=sk-ant-... --app <your-app-name>
```

Never put this in `fly.toml` or any committed file — `fly secrets set` is
the only place it should live.

## 4. Deploy

```bash
fly deploy --app <your-app-name>
```

Watch the build logs for errors. When it finishes:

```bash
fly status --app <your-app-name>
fly logs --app <your-app-name>
```

Look for `Autonomous AI Creator listening on http://localhost:3000` in the
logs, and confirm there is **no** `WARN state-not-durable` line — if you see
that warning, the volume isn't mounted correctly; stop and fix it before
continuing (check `fly.toml`'s `[[mounts]]` block matches the volume name
from step 2).

## 5. Smoke-test against the deployed URL

Set your app's URL once:

```bash
export APP_URL="https://<your-app-name>.fly.dev"
```

```bash
# Health check
curl -s "$APP_URL/health" | jq .

# Feed before init — should be 200 with an empty array, never an error
curl -s "$APP_URL/api/agent/feed?agentId=nonexistent" | jq .
```

## 6. Initialize the agent — ONE TIME ONLY

This is the real, only `init` call. Do not run this more than once against
production; each call creates a brand-new agent.

```bash
curl -s -X POST "$APP_URL/api/agent/init" \
  -H "content-type: application/json" \
  -d '{"persona":{"name":"Ada","domain":"AI Security"}}' | tee /tmp/init-response.json | jq .

export AGENT_ID=$(jq -r .agentId /tmp/init-response.json)
echo "Production agentId: $AGENT_ID"
```

**Immediately save `$AGENT_ID` somewhere durable** (this runbook's output,
your notes, and the README in step 9). If you lose it, `GET /feed` with any
unknown `agentId` still serves the one real agent (per T2), so you are not
fully locked out — but the evaluator's saved `agentId` is what matters, and
that's the value you just printed.

## 7. Confirm the schedule is alive

```bash
curl -s "$APP_URL/health" | jq .
```

Expect `nextPublishAt` in the near future and (after the first cycle)
`nextPublishReason` describing what the agent decided. Check the feed:

```bash
curl -s "$APP_URL/api/agent/feed?agentId=$AGENT_ID" | jq '.posts | length'
```

Per T4, the first post should exist within about 90 seconds of init. If
`posts` is still `0` after a few minutes, check `fly logs` for discovery
errors (a source outage, rate limit, etc. — the agent should retry with a
decayed threshold every minute until something clears the bar).

## 8. Restart test — the check that saves the submission

Confirm state survives a full container restart before you trust this
deployment with 48 hours of evaluation:

```bash
fly apps restart <your-app-name>

# wait ~15s for it to come back
sleep 15

curl -s "$APP_URL/health" | jq .
curl -s "$APP_URL/api/agent/feed?agentId=$AGENT_ID" | jq '.posts | length'
```

The post count must be the same as before the restart, and `agentId` must
still resolve. If posts came back empty, the volume mount is broken — do not
proceed to judging until this passes.

## 9. External keep-alive (belt-and-braces)

`min_machines_running = 1` in `fly.toml` should already prevent Fly from
sleeping the machine, but add an external ping as a second line of defense —
free at [cron-job.org](https://cron-job.org):

- URL: `$APP_URL/health`
- Method: GET
- Interval: every 5 minutes

Confirm at least 3 pings have succeeded in cron-job.org's execution history
before moving on.

## 10. Record the URL and agentId

Update the top of `README.md`:

```markdown
> **Live demo:** https://<your-app-name>.fly.dev
> **Production `agentId`:** agent-xxxxxxxx
```

Commit it:

```bash
git add README.md
git commit -m "docs: record the live demo URL and production agentId"
git push
```

## 11. Ongoing verification (spread across the next several hours)

Don't just walk away — check back at least 3 times, spaced 2+ hours apart,
and confirm each time that the post count only ever goes up and every prior
post is still present:

```bash
curl -s "$APP_URL/api/agent/feed?agentId=$AGENT_ID" | jq '.posts | length, .posts[0].createdAt'
```

## 12. No secrets leaked

Before you consider this done:

```bash
git log -p | grep -i 'sk-ant' && echo "LEAK FOUND - fix before submitting" || echo "clean"
```

---

## Rollback / troubleshooting

- **`WARN state-not-durable` in logs** → the volume isn't mounted. Check
  `fly volumes list` shows the volume attached to a machine, and that
  `fly.toml`'s `[[mounts]] source` matches the volume's name exactly.
- **Feed returns 0 posts for a long time** → check `fly logs` for repeated
  discovery failures (network egress issues, rate limiting). The scheduler
  retries every minute with a decaying threshold, so this should self-heal
  within a few minutes unless all three sources (Hacker News, Dev.to, arXiv)
  are unreachable from Fly's network.
- **Need to redeploy after a code change** → `fly deploy --app <your-app-name>`
  again. The volume and its data persist across deploys; only `git push` +
  `fly deploy` is needed, no re-init.
- **Made a mistake and need a fresh agent** → do **not** delete and recreate
  the volume just to reset state; that also destroys legitimate history.
  Only do this before any evaluator has recorded an `agentId`.
