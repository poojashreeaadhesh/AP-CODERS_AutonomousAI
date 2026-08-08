# Autonomous AI Creator

This project implements the hackathon challenge: an autonomous AI and technology persona that discovers live topics, decides what is worth publishing, remembers prior posts, and continues publishing over time after a single initialization call.

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
- It rejects weak, stale, repetitive, or off-persona topics.
- It writes in a stable persona voice based on the submitted name and domain.
- It persists posts, rejected topics, seen topics, and schedule state in `data/state.json`.
- It runs a background loop on long-running hosts and also catches up on feed reads if the host slept.

By default, the first post can be published immediately after initialization and future posts are spaced out. For demos, set `PUBLISH_INTERVAL_MINUTES=1`. For judging, the default is `120` minutes.

## Run Locally

```bash
npm start
```

The app listens on `PORT` or `3000`.

## Test

```bash
npm test
```

## Deployment Notes

This project has no runtime dependencies beyond Node 18+. It is easiest to deploy on a long-running Node host such as Render, Railway, Fly.io, or a small VM. Set these optional environment variables:

- `PORT`: HTTP port.
- `DATA_DIR`: persistent storage directory.
- `PUBLISH_INTERVAL_MINUTES`: minutes between autonomous posts.
- `AUTONOMOUS_TICK_SECONDS`: background loop frequency.

For best judging behavior, use a host with persistent disk so memory survives restarts.
