# Implementation Tickets — Autonomous AI Creator

**Time budget:** ~24h remaining. Tickets below total ~19.5h, leaving ~4.5h buffer. The buffer is not optional.

**Path convention:** T1 moves the app from `First_iteration/` to the repo root. Every ticket after T1 uses root-relative paths (`src/server.js`, not `First_iteration/src/server.js`).

**Critical sequencing rule:** Do **T5 (deploy + initialize) before T6 (LLM)**. Organic timestamp spread across 48h cannot be retrofitted; post quality can be improved on the next cycle. Ship, initialize, then improve.

**Priority legend:** 🔴 blocks submission or moves the score materially · 🟠 strong score contributor · 🟡 cut first if behind

| # | Ticket | Est | Pri | Depends on |
|---|---|---|---|---|
| T1 | Repo hygiene & structure | 45m | 🔴 | — |
| T2 | Harden the API contract | 1h | 🔴 | T1 |
| T3 | Durable, race-free state | 1.5h | 🔴 | T2 |
| T4 | Never-silent scheduler | 1h | 🔴 | T3 |
| T5 | Deploy + initialize production agent | 1.5h | 🔴 | T4 |
| T6 | Claude-backed editorial + writer | 3h | 🔴 | T5 |
| T7 | Rationale + memory upgrade | 2h | 🔴 | T6 |
| T8 | Transparency layer | 1.5h | 🟠 | T4 |
| T9 | Agent dashboard at `/` | 3.5h | 🔴 | T8 |
| T10 | Resilience + docs + final verification | 3h | 🟠 | all |

---

## T1 — Repo hygiene & structure

**Why:** Stage 1 eligibility requires an accessible AI usage log. A tracked `data/state.json` would hand the evaluator our test persona instead of theirs. `.DS_Store` and a buried log read as careless.

**Est:** 45m · **Pri:** 🔴 · **Depends:** —

### Scope
- Create `.gitignore` at repo root: `node_modules/`, `data/`, `.env`, `.env.*`, `.DS_Store`, `*.log`, `.claude/worktrees/`
- `git rm --cached .DS_Store` (and any other tracked `.DS_Store`)
- `git mv` the contents of `First_iteration/` to the repo root: `src/`, `test/`, `package.json`, `package-lock.json`, `AGENTS.md`. Remove the now-empty `First_iteration/` and its `touch.gitkeep` placeholders.
- Move `PROMPTS/GPT/AI_USAGE_LOG.md` → root `AI_USAGE_LOG.md`. Leave `PROMPTS/` in place; the root log will link to it.
- Root `README.md` (stub is fine here; T10 completes it) with: project title, one-line description, live demo URL placeholder, `agentId` placeholder, quickstart, link to `AI_USAGE_LOG.md`.
- Add `.env.example` listing every env var with safe defaults and no real key.
- Confirm `data/` is untracked and that no `state.json` is in history.

### Acceptance criteria
- [x] `git ls-files | grep -E 'DS_Store|state\.json|node_modules|\.env$'` returns **nothing**
- [x] `AI_USAGE_LOG.md` and `README.md` exist at the repo root and render on GitHub
- [x] `package.json` is at the repo root; `npm ci && npm test` passes from a **fresh clone into a new directory**
- [x] `npm start` from the repo root boots and serves `GET /` with 200
- [x] `First_iteration/` no longer exists
- [x] `git log --follow src/server.js` shows history preserved through the move (used `git mv`, not delete+add)
- [x] `.env.example` contains no secret values

### Verify
```bash
git ls-files | grep -E 'DS_Store|state\.json|node_modules' ; echo "exit=$?"
```

### Commits
```
chore: add .gitignore and remove committed .DS_Store
refactor: move application to repository root
chore: relocate AI usage log to repo root for accessibility
docs: add README and .env.example
```

---

## T2 — Harden the API contract

**Why:** `loadFeedState` currently awaits `runDueCycles` → 5 outbound fetches at 7s timeouts, and [server.js:29](First_iteration/src/server.js:29) turns any throw into **HTTP 500 with no posts**. An evaluator hitting a 500 or a multi-second hang can mark the live demo non-functional — Stage 1 failure. Separately, [autonomousAgent.js:139](First_iteration/src/autonomousAgent.js:139) 404s an unknown `agentId`, so one state loss permanently 404s every remaining request.

**Est:** 1h · **Pri:** 🔴 · **Depends:** T1

### Scope
- **`src/server.js`** — replace the if-cascade in `handleRequest` with a route table: `const ROUTES = [{ method, path, handler }]`. Adding an endpoint becomes one array entry (also T8/Live-Steer prep).
- **`src/autonomousAgent.js` `loadFeedState`** — becomes read-only:
  - Do **not** `await` cycle work. Call `maybeCatchUp()` without awaiting and swallow its rejection (`.catch(logAndContinue)`).
  - Never return 404 for a mismatched `agentId`. Resolve in this order: exact id match → if exactly one agent exists, serve it and log `agentId.mismatch` → if no agent exists, return `200 {"posts": []}`.
  - Only `agentId` missing entirely returns `400`.
- **State shape becomes multi-tenant now**, even though only one agent will exist: `{ agents: { [agentId]: AgentState }, version: 2 }`. This is defensive Live-Steer prep (T8 notes) and costs ~15 minutes today versus an hour under time pressure. Include a migration that reads a v1 single-agent file and wraps it.
- Add `GET /health` → `{ ok, uptimeSeconds, agents, posts, lastCycleAt, nextPublishAt }`.
- Add process-level `unhandledRejection` and `uncaughtException` handlers that log and keep the server listening.
- Wrap the feed handler so **any** unexpected throw still returns `200` with the last known posts (or `[]`) rather than 500.

### Acceptance criteria
- [x] `GET /api/agent/feed?agentId=<valid>` responds in **< 500ms** measured while a cycle is due (no network work on the read path)
- [x] `GET /api/agent/feed?agentId=totally-bogus` returns **200** with the real posts array (not 404, not 500)
- [x] `GET /api/agent/feed` with no `agentId` returns **400** with a JSON error and no stack trace
- [x] With all outbound network blocked, `GET /feed` still returns **200** and valid JSON
- [x] Feed remains newest-first, `id`s unique, every `createdAt` an ISO-8601 string ending in `Z`
- [x] `GET /health` returns 200 with all documented fields
- [x] A v1 `data/state.json` on disk loads without error and is rewritten as v2
- [x] Throwing an error deliberately inside the discovery path does not produce a 5xx on `/feed`
- [x] New test: `test/api.test.js` covers the bogus-`agentId`, missing-`agentId`, and empty-state cases

### Verify
```bash
node -e "fetch('http://localhost:3000/api/agent/feed?agentId=bogus').then(r=>console.log(r.status))"
```

### Commits
```
refactor: replace request cascade with a route table
feat: multi-tenant agent state keyed by agentId, with v1 migration
fix: make /api/agent/feed read-only and non-blocking
fix: serve the existing agent for an unknown agentId instead of 404
feat: add /health and process-level error handlers
test: api contract behaviour under bad input and network failure
```

---

## T3 — Durable, race-free state

**Why:** Two concrete bugs. (1) `loadState()` returns a `structuredClone` ([store.js:19](First_iteration/src/store.js:19)) with no lock, so the background tick and concurrent feed reads each load-mutate-save and the last writer silently drops posts or republishes a topic. Over 48h of polling this will fire. (2) `saveState` writes `state.json` in place; a crash mid-write corrupts it, `JSON.parse` throws, and `loadState()` **rethrows** — total outage with no recovery.

**Est:** 1.5h · **Pri:** 🔴 · **Depends:** T2

### Scope
- **`src/store.js`** — extract a storage interface and keep the JSON implementation behind it:
  `getAgent(id)`, `listAgents()`, `saveAgent(agent)`, `appendPost(agentId, post)`, `listPosts(agentId, opts)`, `appendRejected`, `appendCycle`, `appendLog`, `getMemory`. One file to swap for Postgres later; also the answer to a Live Steer "persist to a DB" ask.
- **Atomic writes:** `writeFile(state.json.tmp)` → `fsync` → `rename(tmp, state.json)`. Before renaming, copy the current `state.json` to `state.json.bak`.
- **Corruption recovery:** on `JSON.parse` failure, log loudly, fall back to `state.json.bak`; if that also fails, fall back to the in-memory cache; only then treat as uninitialized. `loadState` must never throw to callers.
- **Single-flight mutex:** a promise-chain lock so at most one cycle runs at a time per agent. All read-modify-write of agent state goes through `withAgentLock(agentId, fn)`. The tick must no-op (not queue indefinitely) if a cycle is already in flight.
- Keep the existing in-memory fallback for read-only filesystems, but **log a prominent warning at boot** if `DATA_DIR` is not writable — that condition means the agent will lose everything on restart and you need to know before judging, not after.
- Enforce pruning caps in one place: `seenTopics` 300, `rejectedTopics` 150, `cycles` 100, `activityLog` 500. **`posts` is never truncated** (the spec requires previously returned posts to remain available).

### Acceptance criteria
- [x] New test: 20 concurrent `runDueCycles` calls produce **at most one** new post and zero lost posts
- [x] New test: a truncated/corrupt `state.json` with a valid `.bak` recovers all posts, and `loadState` does not throw
- [x] New test: a corrupt `state.json` with a corrupt `.bak` returns the in-memory state rather than throwing
- [x] After `kill -9` during a write, restarting yields valid JSON (either the pre-write or post-write state, never a partial file)
- [x] `state.json.tmp` never remains on disk after a successful save
- [x] Restarting the process preserves `agentId`, all posts, memory, and `nextPublishAt`
- [x] Boot with `DATA_DIR=/nonexistent-readonly` logs a `WARN state-not-durable` line and still serves requests
- [x] `posts.length` never decreases across the process lifetime
- [x] `store.js` exports only the interface functions; no other module reads or writes `state.json` directly (`grep -rn "state.json" src/ | grep -v store.js` is empty)

### Commits
```
refactor: extract a storage interface from the JSON store
fix: atomic state writes with tmp+rename and a .bak fallback
fix: recover from corrupt state instead of throwing
fix: serialize cycles with a single-flight lock to prevent lost updates
feat: warn at boot when the data directory is not durable
test: concurrency and corruption recovery for the store
```

---

## T4 — Never-silent scheduler

**Why:** Threshold is `score >= 4.5` ([editorial.js:167](First_iteration/src/editorial.js:167)) and a cycle that publishes nothing still pushes `nextPublishAt` a **full 120 minutes** forward ([autonomousAgent.js:112](First_iteration/src/autonomousAgent.js:112)). Two unlucky cycles and a judge querying 30 minutes after init sees `{"posts": []}` — and forms their opinion right there. Separately, `MAX_POSTS_PER_CYCLE = 1` caps catch-up, so a 10-hour host sleep recovers exactly one post and resets the clock.

**Est:** 1h · **Pri:** 🔴 · **Depends:** T3

### Scope
- **Guaranteed first post:** at init, set `nextPublishAt = now`. If the first cycle publishes nothing, retry in **60 seconds** with the threshold decayed. Repeat until a post exists. Only after post #1 does the normal interval apply.
- **Progressive threshold decay:** on a no-publish cycle, `threshold = max(floor, threshold - 0.75)` and set the next attempt to **+10 minutes** instead of a full interval. Reset `threshold` to its configured base after any successful publish. Floor default `2.0` via `EDITORIAL_THRESHOLD_FLOOR` — the agent must still be *able* to publish nothing, just not able to go silent for hours.
- **Interval jitter:** `interval * (0.8 + rand*0.4)`, via `PUBLISH_JITTER_PCT` (default `0.2`). Perfectly regular 120-minute gaps look cron-generated; irregular gaps look like an agent deciding.
- **Self-selected cadence + `nextPublishReason`:** after each cycle, record a human-readable reason on the agent — e.g. `"3 strong candidates queued, publishing again in 45m"`, `"quiet news cycle, backing off to 30m"`, `"nothing cleared the bar, retrying in 10m at a lower threshold"`. Shorten the interval when ≥3 candidates scored above threshold; lengthen it when the pool is thin. This is what converts a timer into visible *judgment*.
- **Catch-up:** raise `MAX_CATCHUP_POSTS` to `3` (env-configurable). Space recovered posts ≥8 minutes apart by advancing `nextPublishAt`, so a sleep gap recovers without a visible burst.
- **Never backdate `createdAt`.** Recovered posts use the real current time. Log the gap (`"resumed after 6h12m host gap"`) — an honest gap with a logged explanation is more credible than a suspiciously perfect cadence, and fabricated timestamps are a disqualification risk if a judge diffs them.
- Defaults: `PUBLISH_INTERVAL_MINUTES=75` (not 120 — that halves feed volume and makes any stall conspicuous), `AUTONOMOUS_TICK_SECONDS=30`.

### Acceptance criteria
- [ ] From a clean state, `POST /init` then poll `/feed`: **at least one post exists within 90 seconds**, with no other request made
- [ ] New test: an agent whose candidates all score below threshold still publishes within 5 simulated retry cycles (threshold decay works and is bounded by the floor)
- [ ] New test: threshold resets to base after a successful publish
- [ ] With `PUBLISH_INTERVAL_MINUTES=1`, 10 consecutive gaps between `createdAt` values are **not all identical** (jitter is live)
- [ ] `GET /health` (and T8's `/status`) exposes a non-empty `nextPublishReason` after the first cycle
- [ ] New test: simulating a 10-hour gap produces **exactly 3** catch-up posts, each ≥8 minutes apart in `nextPublishAt` scheduling, none with a `createdAt` earlier than the resume time
- [ ] No `createdAt` in the feed is ever earlier than the cycle that produced it
- [ ] A quiet cycle is still recorded with `status: "no_publishable_topic"` and appears in the cycle history

### Commits
```
feat: guarantee the first post within 90s of initialization
feat: progressive editorial threshold decay on quiet cycles
feat: jittered publish intervals
feat: self-selected cadence with a recorded nextPublishReason
feat: recover up to three posts after a host gap without backdating
test: scheduler never goes silent and never backdates
```

---

## T5 — Deploy + initialize production agent

**Why:** This is the highest-leverage scheduling decision in the plan and it cannot be retrofitted. Initializing at hour ~6 means ~30+ posts with genuine multi-hour timestamp spread by judging time. Initializing at hour 23 means a thin feed that looks batch-generated. Also: `data/state.json` on an ephemeral filesystem is the single most likely way to lose outright — Render's free tier both sleeps and has no disk, which is exactly the fatal combination.

**Est:** 1.5h · **Pri:** 🔴 · **Depends:** T4

### Scope
- **Host: Fly.io.** `min_machines_running = 1` (no sleep) plus a 1GB volume mounted at `/data`, `DATA_DIR=/data`. Fixes sleep *and* durability in one move on a free-friendly tier. Acceptable alternative: Railway (doesn't sleep, has volumes). **Not** Render free.
- `Dockerfile` (~5 lines, `node:22-alpine`, no build step needed) and `fly.toml` with the volume mount, `min_machines_running`, health check pointed at `/health`.
- Pin `engines.node` in `package.json`.
- Set production env: `PUBLISH_INTERVAL_MINUTES=75`, `AUTONOMOUS_TICK_SECONDS=30`, `DATA_DIR=/data`, `PUBLISH_JITTER_PCT=0.2`.
- **External keep-alive:** cron-job.org (free) hitting `/health` every 5 minutes. Belt-and-braces — do not rely on a self-ping from inside a process that may be asleep.
- Run pre-submission checks 1–9 from T10 against the **deployed URL**, not localhost.
- **Then `POST /api/agent/init` once** and record the returned `agentId` in the README. Do not init again.
- Add the live URL + `agentId` to the top of the README.

### Acceptance criteria
- [ ] `POST /api/agent/init` against the deployed URL returns an `agentId`; the persona in `/health` matches what was sent
- [ ] `GET /feed?agentId=<real>` returns 200 in **< 1s** with valid, newest-first JSON
- [ ] `GET /feed?agentId=garbage` returns **200 with posts**
- [ ] **`fly apps restart` (or equivalent) → `/feed` returns the same posts with the same `agentId`.** Test this for real; it is the check that saves the submission.
- [ ] Waiting one full interval with **zero requests sent** produces a new post
- [ ] Three feed reads spaced ≥2h apart each return strictly more posts than the previous, and all prior posts are still present
- [ ] Keep-alive cron is configured and its last 3 pings succeeded
- [ ] No secrets in the repo: `git log -p | grep -i 'sk-ant'` is empty
- [ ] README top shows the live URL and the production `agentId`

### Commits
```
chore: add Dockerfile and fly.toml with a persistent volume
chore: pin the Node engine
docs: record the live demo URL and production agentId
```

---

## T6 — Claude-backed editorial + writer

**Why:** The largest single score mover. [writer.js:43-51](First_iteration/src/writer.js:43) emits the same five lines every time with only `title`/`sourceName`/`domain` swapped, and the opener alternates between two strings via `posts.length % 3`. A judge reading 24 posts over 48h sees one post rendered 24 times. That torches three rubric lines at once — persona consistency (consistency-as-repetition is not voice), feed coherence, and rationale transparency (*"Chosen over other candidates because it cleared the editorial threshold"* is a tautology, identical on every post). And a hackathon named "Autonomous AI Creator" currently contains no LLM at all.

**Est:** 3h · **Pri:** 🔴 · **Depends:** T5

### Scope
- Add the `@anthropic-ai/sdk` dependency. Model: **`claude-sonnet-5`** via `LLM_MODEL`.
- **`src/persona.js` — the charter**, one config object: `name`, `domain`, `voiceStyle`, `beliefs[]`, `mustCover[]`, `willNotCover[]`, `bannedPhrasings[]`, `openingsToAvoid[]`. Feeds the prompts, the scorer, and the dashboard. One file to edit for a Live Steer "make the persona care about X" ask.
- **`src/prompts.js` — every prompt as a named template function.** Any tone/format request then becomes a single-file edit.
- **Two-stage editorial funnel:**
  1. The existing keyword scorer drops obvious junk and ranks the top ~8. Keep it — it is a genuinely good pre-filter and the fallback.
  2. One `claude-sonnet-5` call receives the 8 candidates + the charter + the last 10 published titles, and returns strict JSON: `{ selected: id|null, editorialScore, whySelected, whyNow, whyOverOthers: [{id, reason}], rejections: [{id, reason}] }`.
  3. **`selected: null` is explicitly valid and must be respected.** The rubric rewards *intentional* rejection; a cycle that publishes nothing and logs why scores better than one that publishes filler.
- **Writer call:** charter + selected topic + last 10 titles + top themes. Instruct explicitly: vary the opening, never reuse a structure from the supplied recent posts, no hashtags, no em-dash-heavy LinkedIn cadence, 80–200 words.
- **Resilience:** every LLM call wrapped with 2 retries + exponential backoff, then falls back to the existing deterministic scorer and template writer. The agent must never stop publishing because the API returned 529. Set `LLM_ENABLED=false` as a kill switch.
- Record `decidedBy: "llm" | "heuristic-fallback"` plus `model` and `tokensUsed` on every post. The honesty flag reads as engineering maturity, not weakness.
- Validate the model's JSON against a schema; on a validation failure, retry once with the error appended, then fall back.

### Acceptance criteria
- [ ] With `ANTHROPIC_API_KEY` set, three consecutive posts have **different opening sentences and visibly different structure** (manual read + an automated check that the first 8 words of each are distinct)
- [ ] New test: **with `ANTHROPIC_API_KEY` unset, a full cycle still publishes** a post via the template fallback, and `decidedBy === "heuristic-fallback"`
- [ ] New test: a mocked malformed LLM JSON response triggers one retry, then the fallback — no crash, no missing post
- [ ] New test: a mocked 529 triggers backoff retries then the fallback
- [ ] New test: the LLM returning `selected: null` results in a cycle with `status: "no_publishable_topic"` and no post — the null is respected, not overridden
- [ ] `rationale` differs materially between posts (no two rationales share a full sentence)
- [ ] No post text contains any string from `bannedPhrasings` or reuses an opening from `openingsToAvoid`
- [ ] Every post carries `decidedBy`, `model`, `editorialScore`
- [ ] `LLM_ENABLED=false` produces a working agent with zero outbound Anthropic calls
- [ ] No API key appears in any log line, in `/status`, or in any response body
- [ ] `grep -rn "sk-ant" .` returns nothing outside `.env` (untracked)

### Commits
```
feat: persona charter configuration
feat: extract all model prompts into src/prompts.js
feat: Claude-backed editorial judgment with heuristic fallback
feat: Claude-backed post writer preserving persona voice
feat: record decidedBy, model, and token usage per post
test: editorial and writer fall back cleanly without an API key
test: malformed and rate-limited model responses degrade gracefully
```

---

## T7 — Rationale + memory upgrade

**Why:** Two rubric lines, both currently weak. **Memory:** `similarity(topic.title, wholePostText) > 0.32` ([editorial.js:137](First_iteration/src/editorial.js:137)) compares ~8 title tokens against ~60 post tokens normalized by `max(size)` — it can essentially never exceed 0.32, so the dedup-by-similarity branch is **effectively dead code** and the same *story* from a different URL will get republished. There is also no entity/theme memory, so `continuityLine()` just quotes the previous post's first line, which reads mechanical when topics are unrelated. **Transparency:** the rationale is boilerplate.

**Est:** 2h · **Pri:** 🔴 · **Depends:** T6

### Scope
- **Fix `similarity`** in `src/utils.js`: symmetric Dice/Jaccard, compared **title ↔ prior titles** (not title ↔ full post text), threshold ~0.45. Add a `titleFingerprint` (sorted content tokens, hashed) for cheap near-duplicate lookup.
- **`memory.themes` and `memory.entities`:** `{ [normalizedKey]: { kind, count, firstSeenAt, lastSeenAt, postIds[] } }`. Themes normalized (`"prompt-injection"`); entities are orgs/models (`"Kimi K3"`, `"Anthropic"`). Extract them in the same LLM writer call — ask for `themes[]` and `entities[]` in the response, no extra call.
- **`relatedPostIds`** on each post: prior posts sharing ≥1 theme or entity. Powers the dashboard's continuity thread — the visual proof of memory.
- **Substantive continuity:** replace the "quote the last post's first line" behaviour. Pass related prior posts into the writer prompt with the instruction to reference prior coverage only when *genuinely* related and never to repeat a take (e.g. "I flagged sandbox escapes on Tuesday; this is the second instance this week").
- **`rationaleDetail`** alongside the required `rationale` string (keep the string — it's the contract):
  ```json
  "rationaleDetail": {
    "whySelected": "...", "whyNow": "...",
    "whyOverOthers": [{ "title": "...", "reason": "...", "score": 2.1 }],
    "candidatesEvaluated": 27,
    "sourcesQueried": ["Hacker News", "arXiv", "Dev.to"],
    "editorialScore": 7.4, "decidedBy": "llm",
    "cycleId": "cycle-...", "relatedPostIds": ["p-3f2a"]
  }
  ```
- Add **"is this actually new information or a rehash of something already covered"** as a first-class rejection reason, backed by the theme index.

### Acceptance criteria
- [ ] New test: `similarity("AI model escapes sandbox in security test", "Kimi K3 AI model escapes isolated sandbox during security test") > 0.45` — the near-duplicate is caught (this case fails on the current implementation)
- [ ] New test: a topic with the same title but a different URL than an already-published post is **rejected** with a repetition reason
- [ ] New test: an unrelated topic is **not** rejected as a duplicate (no false positives)
- [ ] After 5 posts, `memory.themes` is non-empty and every `postIds` entry references a real post
- [ ] At least one post in a 10-post feed has non-empty `relatedPostIds`, and every referenced id exists in the feed
- [ ] A post with non-empty `relatedPostIds` contains a textual reference to the prior coverage (manual read of 3 examples)
- [ ] Every post has `rationaleDetail` with all documented keys present and non-empty (`whyOverOthers` may be `[]` only when exactly one candidate existed)
- [ ] `rationale` (the string) remains present, human-readable, and materially different per post
- [ ] `whyOverOthers` entries correspond to topics that were actually evaluated in that cycle (cross-check against the cycle record)

### Commits
```
fix: symmetric title-to-title similarity for near-duplicate detection
feat: theme and entity memory index
feat: relatedPostIds linking posts to prior coverage
feat: substantive continuity references in generated posts
feat: structured rationaleDetail on every post
feat: reject rehashes of already-covered stories
test: near-duplicate detection and memory continuity
```

---

## T8 — Transparency layer

**Why:** "Autonomous operation after initialization" is a scored rubric line and there are currently **zero** artifacts proving it. An activity log a judge can scroll is the cheapest, most persuasive proof available. These endpoints also power the entire T9 dashboard, so build them first.

**Est:** 1.5h · **Pri:** 🟠 · **Depends:** T4 (can run in parallel with T6/T7)

### Scope
- **Persisted append-only activity log**, capped at 500 entries: `{ at, level, event, message, data }`. Events: `agent.initialized`, `discovery.start`, `discovery.source_failed`, `source.disabled`, `topics.evaluated`, `topic.rejected`, `post.published`, `cycle.no_publish`, `schedule.updated`, `host.gap_detected`, `llm.fallback`. Human-readable messages: `[14:32:07] discovered 27 candidates from 4 sources`, `[14:32:14] published p-7f3 — sandbox escape`, `[14:32:14] next cycle 15:47 (strong candidate queue)`.
- **Endpoints** (route-table entries):
  - `GET /api/agent/status?agentId=` → persona, charter, counts (posts / evaluated / rejected / cycles), `initializedAt`, uptime, `lastCycleAt`, `nextPublishAt`, `nextPublishReason`, `currentThreshold`, source health, `llmEnabled`
  - `GET /api/agent/rejected?agentId=&limit=` → rejected topics with title, source, score, reason, `rejectedAt`
  - `GET /api/agent/cycles?agentId=&limit=` → cycle history incl. sources queried/failed, candidate counts, status, `decidedBy`
  - `GET /api/agent/memory?agentId=` → themes and entities with counts and post ids; covered-URL list
  - `GET /api/agent/log?agentId=&limit=` → activity log, newest first
- **Ensure cycles that published nothing are recorded and returned.** Nothing proves an autonomous *editor* like a visible record of it deciding no.
- All new endpoints are read-only, must never trigger cycle work, and must never 500 — same hardening rules as T2.
- **Redaction:** no API keys, no full prompts containing keys, no env dump.

### Acceptance criteria
- [ ] All five endpoints return 200 with valid JSON for a live agent, and a sane empty shape (not 404/500) for an uninitialized one
- [ ] `/status` shows a `nextPublishAt` in the future and a non-empty `nextPublishReason`
- [ ] `/cycles` includes at least one entry with `status: "no_publishable_topic"` after a quiet cycle
- [ ] `/log` contains a `post.published` entry whose `data.postId` matches a real post in `/feed`
- [ ] `/rejected` returns ≥10 entries after several cycles, each with a non-empty human-readable reason
- [ ] Every `/memory` theme's `postIds` resolve to real posts
- [ ] Activity log survives a process restart
- [ ] None of the endpoints trigger a discovery cycle (verified by asserting no outbound fetch during 20 rapid calls)
- [ ] No response contains `sk-ant` or any env var value
- [ ] Adding one of these endpoints required exactly one route-table entry (confirms T2's refactor holds)

### Commits
```
feat: persisted agent activity log
feat: /api/agent/status endpoint
feat: /api/agent/rejected and /api/agent/cycles endpoints
feat: /api/agent/memory endpoint
feat: /api/agent/log endpoint
test: transparency endpoints are read-only and never 5xx
```

---

## T9 — Agent dashboard at `/`

**Why:** Highest perception impact in the project. This is the first thing a judge sees. The live countdown is the single most persuasive element you can build: a judge who reads "next post in 04:12", waits, refreshes, and sees a new post has **personally verified autonomy** — nothing else you can ship beats that.

**Est:** 3.5h · **Pri:** 🔴 · **Depends:** T8

### Scope
- **One static `public/index.html` + `app.js` + `styles.css`**, served by the existing Node server, polling the T8 endpoints every 10s. **No React, no Vite, no bundler, no build step.** A judge cannot tell what framework rendered a good dashboard, and you have hours, not days.
- **`/` is the dashboard. There is no marketing landing page.** Serve the JSON service descriptor at `/api` instead.
- Structure: one `fetch` function per panel, one `render` function per panel — so a Live Steer "add a panel" ask is two small functions plus a div.
- **Left rail — Identity & Vitals:** persona name/domain/monogram; charter (style, interests, stated opinions, will-not-cover); counters (published / evaluated / rejected / cycles / uptime); then the hero element — **a live countdown "Next editorial cycle in 12:47"** with a thin progress ring.
- **Center — Feed:** reverse-chronological cards; relative time ("2h ago") with absolute UTC on hover; post text; clickable source chips; a collapsed **"Why I published this"** drawer expanding to `whySelected` / `whyNow` / `whyOverOthers` with scores; and when `relatedPostIds` is non-empty, a **"↩ continues from: <prior title>"** link that scrolls to that post — the memory proof, visible at a glance.
- **Right rail — Editorial Decisions:** the live rejected list (title, source, score, plain-language reason, subtle ✕). Most teams won't build this. A judge seeing 26 rejections beside 1 publication instantly grasps that the editorial judgment is real and selective.
- **Timeline strip:** horizontal 48h axis, one tick per cycle — green published, grey evaluated-but-published-nothing, red source failure; click for cycle detail. Irregular tick spacing is visual proof of non-batch generation. *(🟡 first thing to cut)*
- **Memory panel:** theme list sized/sorted by mention count, expanding to the posts that touched it, plus a covered-stories table with URL + date. **Skip a force-directed graph** — 3 hours for less communication than a sorted list.
- **API tab:** live `curl` examples with the real deployed URL and real `agentId`, plus a "Run" button that fetches and pretty-prints the raw contract response so a judge can verify the contract without leaving the page.
- **Polish that's cheap:** dark, monospace-accented, one accent color (terminal-adjacent — fits the persona and hides weak design instincts); new posts fade in with a brief "NEW" pill; skeleton loaders never spinners; empty states that say what the agent is *doing*; a `● live` pulse bound to `/health`.
- **Zero auth, zero modals, zero onboarding.** Nothing between the judge and the working agent.

### Acceptance criteria
- [ ] `GET /` serves the dashboard HTML (not JSON); the service descriptor moved to `GET /api`
- [ ] Dashboard loads with **zero console errors** and zero failed network requests
- [ ] The countdown decrements in real time and, when it reaches zero, a new post appears in the feed within one poll interval **without a manual refresh**
- [ ] Rejected panel shows ≥10 real rejections with reasons
- [ ] A post with `relatedPostIds` renders a working "continues from" link that scrolls to the referenced post
- [ ] Expanding a rationale drawer shows `whySelected`, `whyNow`, and `whyOverOthers` populated from the API (no hardcoded text anywhere in `app.js`)
- [ ] Timeline shows at least one grey (no-publish) tick
- [ ] API tab's "Run" button returns and pretty-prints the live contract response
- [ ] Layout does not break at 768px width
- [ ] Dashboard degrades gracefully with a friendly message if an endpoint 500s or the agent is uninitialized — no blank white screen
- [ ] No build step: a fresh clone + `npm start` serves the working dashboard
- [ ] Deployed dashboard verified in a logged-out browser

### Commits
```
feat: serve a static agent dashboard at /
feat: identity, vitals, and live next-cycle countdown
feat: feed cards with expandable publishing rationale
feat: editorial decisions panel showing rejected topics
feat: memory continuity view
feat: activity timeline visualization
feat: live API contract explorer
```

---

## T10 — Resilience + docs + final verification

**Why:** Stage 1 and Stage 2 gates, plus the outage insurance that keeps the feed alive across 48h. Note the Stage 2 exposure that needs active mitigation: commit `ea79d05` is a single large commit containing the setup, core functionality, and tests — that is a **literally enumerated** authenticity red flag ("first commit already contains most of the project"). It can't be undone, so it has to be overwhelmed with a dense, granular history. The ~30 commit messages across T1–T10 are that mitigation; commit as you go, spread across real hours.

**Est:** 3h · **Pri:** 🟠 · **Depends:** all

### Scope

**Resilience**
- **Generic RSS/Atom adapter** (~30 lines given the existing arXiv XML parsing) — unlocks a dozen sources.
- **Source registry:** `SOURCES = [{ id, displayName, kind, fetch, weight, enabled }]` in one array. Adding a source becomes one object — a very likely Live Steer ask.
- Add 3–4 feeds: Simon Willison, a major lab research blog, a security outlet, GitHub Trending.
- **Per-source circuit breaker:** 3 consecutive failures → disable 30 min, recorded in the cycle log and surfaced in `/status`. A source outage becomes *visible robustness* instead of a silent hole.
- **Query rotation:** `queries[cycleCount % queries.length]` so you stop re-fetching the same 30 items.
- **Candidate reserve pool:** persist the top ~20 unpublished ranked candidates. If every source fails, publish from the pool and say so in the rationale. Outage insurance.
- Drop fetch timeouts 7s → 5s.
- **Source diversity governor** *(cheap, high-signal)*: track publications per source, down-weight a source used twice consecutively, and say so in the rationale — "deliberately going outside Hacker News; three of my last five came from there." Editorial judgment about its own diet.

**Docs — README sections still missing**
Live demo URL + `agentId` at the very top; "what judges should look at first"; ASCII architecture flow (discovery → editorial → writer → memory → schedule); how autonomy works and how to verify it in 60 seconds; the persona charter; editorial criteria with actual thresholds; memory design; failure/fallback behaviour; full env var table; deploy instructions; link to `AI_USAGE_LOG.md`; test list; and an honest **"known limitations / what we'd build next"** (judges reward this, and it doubles as the database + frontend roadmap).

**Docs — `AI_USAGE_LOG.md`**
Structure **feature-by-feature, not as a prompt dump** — Stage 2 checks whether the log "reasonably corresponds to the implemented features." Per feature: the prompt (or a faithful summary), what the AI produced, and **what you changed or rejected and why** — that last part is what separates a genuine log from a generated one. Include tools used (Claude Code / GPT / Gemini) and what each did. Link `PROMPTS/` rather than deleting it; genuine multi-tool prompt history is good Stage 2 evidence. Include the debugging moments — the `import.meta.url` Windows bug is a perfect entry, unmistakably real work. Add a short "AI limitations we hit" section; nobody fakes those.

**Tests**
Integration test: init → forced cycle → feed contains a valid post with rationale and sources. Confirm all five originally-claimed areas are actually covered (don't claim coverage you don't have).

**Demo asset**
90-second screen recording: dashboard → countdown → wait → new post appears → open its rationale → open the rejected list. Link it in the README for judges who won't wait.

### Acceptance criteria — resilience
- [ ] ≥6 sources registered; `/status` reports per-source health
- [ ] New test: with **all** outbound HTTP mocked to fail, a cycle still publishes from the reserve pool and the rationale states the sources were unreachable
- [ ] New test: 3 consecutive failures disable a source and set `disabledUntil`; it re-enables after the window
- [ ] Adding a new RSS source required exactly one registry entry
- [ ] Two consecutive posts do not come from the same source unless no alternative cleared the bar (and the rationale says so)
- [ ] Consecutive cycles issue different queries

### Acceptance criteria — the 14 pre-submission checks (run against the **deployed** URL)
- [ ] 1. `POST /init` on a clean deploy returns an `agentId`; `/status` persona matches what was sent
- [ ] 2. `GET /feed?agentId=<real>` → 200 in <1s, valid JSON, newest-first
- [ ] 3. `GET /feed?agentId=garbage` → **200 with posts** (not 404, not 500)
- [ ] 4. `GET /feed` with no `agentId` → clean 400, no stack trace
- [ ] 5. Every `createdAt` parses as ISO-8601 UTC and ends in `Z`
- [ ] 6. Every `id` is unique across the whole feed
- [ ] 7. Every post has ≥1 non-empty, resolvable `sources` URL (HTTP HEAD each; ≥90% resolve)
- [ ] 8. **Restart the host → `/feed` returns the same posts with the same `agentId`**
- [ ] 9. Wait one full interval → a new post appears with no request from you
- [ ] 10. Posts persist and accumulate across 3 checks spaced ≥2h apart
- [ ] 11. Repo is public in a logged-out browser; `README.md` and `AI_USAGE_LOG.md` render
- [ ] 12. `npm ci && npm test` passes on a fresh clone
- [ ] 13. No secrets in git: `git log -p | grep -i 'sk-ant'` empty
- [ ] 14. Dashboard loads with no console errors

### Acceptance criteria — docs & authenticity
- [ ] README contains every section listed above
- [ ] `AI_USAGE_LOG.md` covers each shipped feature with prompt → output → what changed
- [ ] `git log --oneline | wc -l` ≥ 30, spread across real working hours, no single commit adding most of the diff
- [ ] Demo recording linked and plays

### Commits
```
feat: generic RSS/Atom source adapter
refactor: source registry with weights and enable flags
feat: expand sources with research and security feeds
feat: per-source circuit breaker with health reporting
feat: candidate reserve pool for total-outage resilience
feat: source diversity governor
feat: rotate discovery queries per cycle
test: integration test for init -> cycle -> feed
test: total source outage still publishes
docs: architecture, autonomy verification, and env reference
docs: complete feature-by-feature AI usage log
docs: known limitations and roadmap
```

---

## Cut order if behind

Cut in this order, and **never cut T1–T6**:
1. Timeline strip (T9)
2. RSS source expansion (T10)
3. Reserve pool (T10)
4. Memory themes view (T9)

## Explicitly out of scope

Multi-agent architectures · images/video · real LinkedIn or X posting · auth · a React/Next frontend with a build step · embeddings or vector memory · the Postgres migration unless it lands before hour 18 (a mounted volume buys the same durability in 15 minutes, and the rubric awards zero points for schema).
