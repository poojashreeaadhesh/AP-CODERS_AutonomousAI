# Autonomous AI Creator

An autonomous AI and technology persona that discovers live topics, exercises
editorial judgment over what to publish, writes in a consistent voice,
remembers what it has already covered, and keeps publishing over time after
a single initialization call — no further prompts required.

> **Live demo:** _TODO — filled in once deployed (see [TICKETS.md](TICKETS.md) T5)_
> **Production `agentId`:** _TODO_
> **AI usage log:** [AI_USAGE_LOG.md](AI_USAGE_LOG.md)

## What to look at first

1. `POST /api/agent/init` once, then `GET /api/agent/feed?agentId=...` — the
   two required endpoints.
2. Watch the feed over time: new posts appear without any further requests.
3. Read a post's `rationale` — every post explains why it was selected, why
   it's relevant now, and what it was chosen over.

_A dashboard at `/` and additional transparency endpoints (`/api/agent/status`,
`/rejected`, `/cycles`, `/memory`, `/log`) are planned — see
[TICKETS.md](TICKETS.md) for the build plan and current status._

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
  "agentId": "abc-123"
}
```

### Retrieve Feed

```bash
curl "http://localhost:3000/api/agent/feed?agentId=abc-123"
```

Response:

```json
{
  "posts": [
    {
      "id": "p7",
      "createdAt": "2026-08-07T10:30:00Z",
      "text": "...",
      "rationale": "...",
      "sources": [
        "https://..."
      ]
    }
  ]
}
```

## Autonomous Behavior

After `POST /api/agent/init`, the service owns the publishing schedule:

- It discovers topics from live sources such as Hacker News, Dev.to, and arXiv.
- It rejects weak, stale, repetitive, or off-persona topics, and keeps the
  reasons for rejection.
- It writes in a stable persona voice based on the submitted name and domain.
- It persists posts, rejected topics, seen topics, and schedule state.
- It runs a background loop on long-running hosts and also catches up on
  feed reads if the host slept.

By default, the first post can be published immediately after initialization
and future posts are spaced out. For demos, set `PUBLISH_INTERVAL_MINUTES=1`.
For judging, see the recommended defaults in `.env.example`.

## Run Locally

```bash
npm install
cp .env.example .env
npm start
```

The app listens on `PORT` or `3000`.

## Test

```bash
npm test
```

## Environment Variables

See [.env.example](.env.example) for the full list with descriptions:
`PORT`, `DATA_DIR`, `PUBLISH_INTERVAL_MINUTES`, `AUTONOMOUS_TICK_SECONDS`,
`ANTHROPIC_API_KEY`, `LLM_ENABLED`, `LLM_MODEL`.

## Deployment Notes

This project has no required runtime dependencies beyond Node 18+ (an
optional Anthropic SDK dependency is planned — see TICKETS.md T6). It is
easiest to deploy on a long-running Node host with persistent storage, such
as Fly.io or Railway with a mounted volume. For best judging behavior, use a
host with persistent disk and a service that does not sleep, so memory
survives restarts.

## Roadmap

This README and the deployment are being actively hardened against the
hackathon's 48-hour observation window. See [TICKETS.md](TICKETS.md) for the
full improvement plan, ticket-by-ticket scope, and acceptance criteria.

## AI Usage

Development was AI-assisted throughout. See [AI_USAGE_LOG.md](AI_USAGE_LOG.md)
for prompts, tools used, and what was changed or rejected from AI output.
Additional raw prompt history is in [PROMPTS/](PROMPTS/).
