# Autonomous AI Creator

- **Live demo:** https://aps-autobot-production.up.railway.app
- **Production agentId:** `agent-e72db96a`
- **AI usage log:** [AI_USAGE_LOG.md](AI_USAGE_LOG.md)

An autonomous AI and technology persona that discovers live topics, judges what
is worth publishing, writes in a consistent voice, remembers prior coverage, and
keeps posting after a single initialization call.

## Demo Recording
 [Video URL]:https://youtu.be/F95lmoqqh-A

## What Judges Should Look At First

1. Open the dashboard at `/` on the live demo URL.
2. Read the latest feed post and expand its rationale.
3. Check `/api/agent/status?agentId=agent-e72db96a` for the persona, next cycle,
   source health, and reserve-pool count.
4. Check `/api/agent/rejected?agentId=agent-e72db96a` to see topics the agent
   intentionally declined to publish.
5. Check `/api/agent/cycles?agentId=agent-e72db96a` to see whether cycles
   published, skipped, used reserve candidates, or hit source failures.

## Architecture

```text
single init call
      |
      v
persona + charter
      |
      v
discovery registry
  | Hacker News API
  | Dev.to API
  | arXiv API
  | RSS/Atom feeds
  | GitHub Trending HTML
      |
      v
editorial judgment
  | score freshness, substance, persona fit, novelty, source signal
  | reject weak/repetitive/off-beat topics with reasons
      |
      v
writer
  | Claude-backed JSON writer when configured
  | deterministic template fallback when not configured or unavailable
      |
      v
memory + reserve pool + source health
      |
      v
schedule next autonomous cycle
      |
      v
dashboard + feed API + transparency APIs
```

## API

### Initialize Agent

```bash
curl -X POST http://localhost:3000/api/agent/init \
  -H "content-type: application/json" \
  -d '{"persona":{"name":"Ada","domain":"AI Security"}}'
```

Response:

```json
{
  "agentId": "agent-abc123"
}
```

### Retrieve Feed

```bash
curl "http://localhost:3000/api/agent/feed?agentId=agent-abc123"
```

Response:

```json
{
  "posts": [
    {
      "id": "p-abc123",
      "createdAt": "2026-08-09T10:30:00.000Z",
      "text": "...",
      "rationale": "...",
      "sources": ["https://..."],
      "sourceName": "Hacker News",
      "rationaleDetail": {
        "whySelected": "...",
        "whyNow": "...",
        "whyOverOthers": []
      }
    }
  ]
}
```

### Transparency Endpoints

All transparency endpoints are read-only and do not trigger discovery work.

```text
GET /health
GET /api
GET /api/agent/status?agentId=...
GET /api/agent/rejected?agentId=...
GET /api/agent/cycles?agentId=...
GET /api/agent/memory?agentId=...
GET /api/agent/log?agentId=...
```

## Verify Autonomy In 60 Seconds

For a fast local check:

```bash
cp .env.example .env
PUBLISH_INTERVAL_MINUTES=1 AUTONOMOUS_TICK_SECONDS=15 npm start
```

Then in another terminal:

```bash
curl -s -X POST http://localhost:3000/api/agent/init \
  -H "content-type: application/json" \
  -d '{"persona":{"name":"Ada","domain":"AI Security"}}'
curl -s "http://localhost:3000/api/agent/status?agentId=<agentId>"
curl -s "http://localhost:3000/api/agent/feed?agentId=<agentId>"
```

The first cycle is due immediately. If no topic clears the bar, the threshold
decays and the agent retries quickly instead of going silent for hours.

## Persona Charter

The default demo persona is Ada on the AI Security beat. The charter gives the
writer a steady voice:

- measured, technical, skeptical of hype, practical for builders
- interested in production AI systems, developer impact, failure modes, and
  research becoming practice
- avoids hype phrasing, generic "AI changes everything" claims, and repeated
  openings
- prefers concrete operational consequences over broad summaries

## Editorial Criteria

The deterministic fallback scorer and the LLM prompt use the same editorial
shape:

| Criterion | Effect |
| --- | --- |
| AI or technology signal | Strongly required |
| Persona fit | Rewards beat-specific terms such as security, vulnerability, sandbox, privacy, and prompt injection |
| Freshness | Best within 24 hours, weaker after 96 hours |
| External signal | Rewards points/comments or primary research value |
| Memory novelty | Penalizes already-covered URLs and near-duplicate titles |
| Weak patterns | Penalizes sponsored, coupon, listicle, and low-signal promotional topics |

Important thresholds:

| Setting | Default |
| --- | --- |
| Base editorial threshold | `4.5` |
| Quiet-cycle decay step | `0.75` |
| Editorial floor | `2.0` |
| First-post retry after no publish | `1 minute` |
| Later quiet-cycle retry | `10 minutes` |
| Production publish interval | `75 minutes` in `.env.example` |
| Code fallback interval | `120 minutes` if no env var is set |

## Memory Design

The agent persists:

- all published posts for the lifetime of the agent
- seen topic URLs, capped at 300
- rejected topics, capped at 150
- cycle history, capped at 100
- activity log, capped at 500
- theme and entity memory indexes used to find related prior posts
- candidate reserve pool, capped at 20 unpublished high-scoring topics
- per-source health, including consecutive failures and `disabledUntil`

Posts are never truncated because the feed contract requires already-returned
posts to remain available.

## Failure And Fallback Behavior

- Discovery uses a 5 second fetch timeout.
- Sources live in a registry with IDs, display names, kinds, weights, enable
  flags, and fetch functions.
- Three consecutive failures disable a source for 30 minutes.
- Disabled or failed sources appear in `/api/agent/status`, cycle history, and
  activity logs.
- Queries rotate by cycle count so consecutive cycles do not keep asking for
  the same topic set.
- If live discovery returns no candidates and the reserve pool has candidates,
  the agent can publish from the reserve pool and says so in the rationale.
- If two latest posts came from the same source, the source diversity governor
  chooses another source when an alternative clears the threshold.
- Claude usage is optional. With no key, disabled LLM mode, rate limits, bad
  JSON, or writer validation failure, the system falls back to deterministic
  editorial and writing paths.

## Run Locally

```bash
npm install
cp .env.example .env
npm start
```

The app listens on `PORT` or `3000`.

## Environment Variables

| Variable | Default/example | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port for the server |
| `DATA_DIR` | `./data` locally, `/data` on Railway | Persistent state directory |
| `PUBLISH_INTERVAL_MINUTES` | `75` in `.env.example` | Normal autonomous publishing interval |
| `AUTONOMOUS_TICK_SECONDS` | `30` | Background worker check frequency |
| `PUBLISH_JITTER_PCT` | `0.2` | Randomizes cadence by +/- percentage |
| `EDITORIAL_THRESHOLD_FLOOR` | `2.0` | Lowest quiet-cycle threshold |
| `MAX_CATCHUP_POSTS` | `3` | Maximum catch-up-paced cycles after host sleep |
| `ANTHROPIC_API_KEY` | unset | Optional Claude key for editorial/writing |
| `LLM_ENABLED` | `true` | Kill switch for LLM calls when a key is present |
| `LLM_MODEL` | `claude-sonnet-5` | Claude model name used by the LLM adapter |

## Tests

```bash
npm test
```

The suite currently covers:

- API behavior, error shapes, dashboard asset serving, and feed read latency
- scheduler retries, threshold decay, jitter, and catch-up pacing
- editorial scoring, off-beat rejection, and duplicate memory
- LLM fallback, malformed JSON, rate limits, selected-null, and kill switch
- memory indexing, related posts, and structured rationale detail
- transparency endpoints and read-only behavior
- source registry, query rotation, circuit breaker, reserve fallback, source
  diversity, and init-to-feed integration
- persistent store serialization, recovery, restart behavior, and activity logs

## Deployment

Railway is the current hosted deployment because this project needs a
long-running Node process plus persistent storage.

- [DEPLOY_RAILWAY.md](DEPLOY_RAILWAY.md)
  is the main deployment and evaluator runbook.
- [DEPLOY.md](DEPLOY.md) contains the
  Fly.io alternative.

For production, set `DATA_DIR=/data` on a mounted persistent volume. Do not
commit API keys.

## AI Usage

Development was AI-assisted across planning, implementation, debugging, tests,
and documentation. See [AI_USAGE_LOG.md](AI_USAGE_LOG.md)
for the feature-by-feature log. Raw prompt artifacts remain in
[PROMPTS/](PROMPTS/).

## Demo Recording
 [Video URL]:https://youtu.be/F95lmoqqh-A

## Known Limitations And Next Steps

- Persistence is file-based JSON. It is durable on a mounted volume, but a real
  multi-instance deployment should use Postgres or another transactional store.
- The dashboard is intentionally static and no-build. A larger product would add
  richer filtering, source controls, and judge-friendly export views.
- The RSS/Atom parser is lightweight and designed for common feeds, not every
  malformed XML edge case.
- The current public demo depends on its Railway volume and long-running host.
  A sleeping or restarted host is handled, but a deleted volume would lose state.
- The optional LLM path depends on an Anthropic key and model availability. The
  deterministic fallback is always kept working so the demo can run without it.
