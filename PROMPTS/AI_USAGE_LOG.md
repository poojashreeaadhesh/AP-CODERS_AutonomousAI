# AI Usage Log

This log records the AI-assisted development process for the hackathon submission.

## 2026-08-08

### Prompt

The user provided the hackathon rules and the "Autonomous AI Creator" problem statement, including the required endpoints, autonomous feed behavior, editorial judgment, memory, and publishing rationale requirements.

### AI Assistance

Codex read the rules and generated the initial implementation plan:

- Build a dependency-free Node.js HTTP API.
- Implement `POST /api/agent/init` and `GET /api/agent/feed`.
- Add live topic discovery from technology information sources.
- Add editorial scoring and rejection reasons.
- Persist posts, rejected topics, seen topics, and schedule memory.
- Add autonomous publishing through a background loop plus due-cycle catch-up.
- Add tests and documentation for setup, demo, and judging.

### Human Decisions

The human selected problem statement 3, "Autonomous AI Creator."

### Implemented Features

- Created the API server.
- Created the autonomous agent loop.
- Created source discovery modules.
- Created editorial evaluation and rejection logic.
- Created persona-based post generation.
- Created persistent memory storage.
- Created tests for editorial judgment and post generation.

## 2026-08-09

### Prompt

The user asked Codex to take over from the Claude session transcript and begin ticket T6: Claude-backed editorial judgment and writing.

### AI Assistance

Codex implemented the T6 LLM integration plan:

- Added the Anthropic SDK dependency.
- Added a persona charter module for stable voice, beliefs, coverage boundaries, banned phrasings, and avoided openings.
- Added named prompt templates for editorial selection, post writing, and JSON repair.
- Added an LLM adapter with `LLM_ENABLED`, `LLM_MODEL`, retry/backoff behavior, strict JSON parsing, validation repair, and API-key redaction.
- Wrapped the existing heuristic scorer with a Claude-backed editorial decision stage that can select a candidate or intentionally publish nothing.
- Added a Claude-backed writer with deterministic fallback when the API key is absent, disabled, rate-limited, or returns malformed JSON.
- Recorded `decidedBy`, `model`, `tokensUsed`, and `editorialScore` on posts/cycles.
- Added tests for no-key fallback, malformed JSON fallback, rate-limit fallback, selected-null behavior, kill switch behavior, and writer metadata.

### Human Decisions

The human directed the project to continue after T5 and start T6.

### Implemented Features

- Claude-backed editorial judgment with heuristic fallback.
- Claude-backed post writing with template fallback.
- Persona charter and prompt-template files for faster future changes.
- LLM metadata on generated posts.
- Test coverage for the critical fallback paths.

### Prompt

The user asked Codex to move from T6 to T7: rationale and memory upgrades.

### AI Assistance

Codex implemented the T7 memory and rationale plan:

- Replaced whole-post duplicate comparison with title-to-title similarity and title fingerprints.
- Added a memory module for theme/entity hints, related-post lookup, memory indexing, and structured rationale detail.
- Added `memory.themes` and `memory.entities` to agent state.
- Added `sourceTitle`, `titleFingerprint`, `themes`, `entities`, `relatedPostIds`, and `rationaleDetail` to generated posts.
- Updated the writer prompt to pass genuinely related prior posts and ask for continuity only when relevant.
- Updated the fallback writer to reference prior related coverage instead of mechanically quoting the previous post.
- Added tests for near-duplicate detection, same-title repetition rejection, no false-positive duplicate rejection, memory indexing, related post links, and rationale details.

### Implemented Features

- Near-duplicate title rejection.
- Theme/entity memory index.
- Related post links for continuity.
- Structured `rationaleDetail` while preserving the required `rationale` string.
- Tests for T7 memory and rationale behavior.

### Prompt

The user asked Codex to move from T7 to T8: the transparency layer.

### AI Assistance

Codex implemented the T8 transparency layer:

- Added discovery telemetry so cycles can record queried and failed sources.
- Added a persisted activity log on agent state with capped append-only entries.
- Logged initialization, discovery starts/source failures, evaluated topics, rejected topics, published posts, quiet cycles, schedule updates, and LLM fallback events.
- Added read-only transparency payloads for status, rejected topics, cycle history, memory, and activity log.
- Added route-table entries for `/api/agent/status`, `/api/agent/rejected`, `/api/agent/cycles`, `/api/agent/memory`, and `/api/agent/log`.
- Added tests proving the endpoints return shaped JSON before initialization, expose live-agent transparency data, do not trigger discovery when a cycle is due, and persist activity logs across restarts.

### Implemented Features

- Persisted activity log.
- Status, rejected-topic, cycle-history, memory, and log endpoints.
- Source telemetry in cycle records.
- Read-only transparency endpoint tests.

### Prompt

The user asked Codex to move from T8 to T9 and asked what to do with the leftover `First_iteration` directory.

### AI Assistance

Codex implemented the T9 static dashboard and inspected the leftover Claude worktree:

- Added a no-build static dashboard at `/` with `public/index.html`, `public/styles.css`, and `public/app.js`.
- Moved the JSON service descriptor from `/` to `/api`.
- Added dashboard panels for persona identity, vitals, countdown, feed, rationale drawers, related-post links, rejected topics, cycle timeline, memory, activity log, and API contract explorer.
- Added static file serving for dashboard assets in the existing Node server.
- Added tests that verify `/` serves HTML, `/api` serves JSON, and dashboard assets load without a build step.
- Ran a seeded local dashboard verification with browser automation at desktop and 768px width, checking for console errors, layout overflow, populated feed/rejected/timeline/memory/log data, rationale drawer behavior, timeline click behavior, API explorer output, and related-post anchor scrolling.
- Confirmed `First_iteration/` contains a nested Claude worktree/archive and should not be deleted casually; added an ignore rule so it stays untracked while preserving the local archive.

### Implemented Features

- Static agent dashboard served at `/`.
- `/api` service descriptor.
- Live countdown, feed cards, rejected-topic panel, memory panel, timeline strip, activity log, and API contract explorer.
- Dashboard server tests and browser smoke verification.

### Prompt

The user asked Codex to move from T9 to T10: resilience, documentation, and final verification.

### AI Assistance

Codex implemented the T10 resilience layer and documentation pass:

- Replaced fixed discovery wiring with a source registry containing stable source IDs, display names, kinds, weights, enable flags, and fetch functions.
- Added a generic RSS/Atom adapter and registered Simon Willison, OpenAI News, The Register Security, plus GitHub Trending alongside Hacker News, Dev.to, and arXiv.
- Reduced discovery timeout behavior to a 5 second fetch timeout.
- Added query rotation based on cycle count so the agent does not ask the same query every cycle.
- Added per-source circuit breaker telemetry: three consecutive failures disable a source for 30 minutes and surface `disabledUntil` in status/cycle data.
- Added a persisted candidate reserve pool capped at 20 unpublished candidates.
- Added total-outage behavior: when live discovery returns no candidates and the reserve pool has suitable candidates, the agent can publish from reserve and says so in the rationale.
- Added a source diversity governor that chooses an alternate accepted source after two consecutive posts from the same source, and records the reason in the post rationale.
- Added `sourceName` and `sourceId` to posts so diversity can be evaluated from published history.
- Added resilience tests for registry coverage, query rotation, circuit breaker disable/re-enable, reserve fallback, source diversity, and init-to-feed integration.
- Updated the README with live URL, production `agentId`, architecture, autonomy verification, persona charter, thresholds, memory design, fallback behavior, env table, deployment notes, tests, and honest limitations.
- Updated the Railway deployment runbook to remove stale LLM wording and fix evaluator environment exports.

### Human Decisions

The human directed the project to continue with T10 after the dashboard ticket.

### Implemented Features

- Source registry with API, RSS/Atom, and HTML sources.
- Generic RSS/Atom feed adapter.
- Per-source circuit breaker and health reporting.
- Rotating discovery queries.
- Candidate reserve pool for live-source outage insurance.
- Source diversity governor.
- Updated documentation and deployment notes.
- Resilience and integration test coverage.

### What Codex Changed Or Rejected

- Kept the reserve pool tied to the existing editorial scoring rather than adding a second ranking system. This keeps reserve behavior aligned with the same judgment rules used for normal publishing.
- Did not claim the demo recording is complete. The README now marks it as a pending submission asset because no recording link exists in the repo yet.
- Did not delete the old `First_iteration/` archive. It remains ignored so prior local context is preserved without entering the submission diff.
- Did not rely on real network calls for resilience tests. Tests mock source responses and failures so they are repeatable in CI and local runs.

### Verification

- Ran `npm test` with local test-server permission. Result: 48 tests passed.
- The first sandboxed run failed only because the sandbox blocked opening local ephemeral ports for API integration tests; the non-server resilience tests passed in that run.

## AI Limitations We Hit

- AI-generated documentation can drift behind the implementation quickly. T10 included a README correction because earlier docs still described shipped dashboard and transparency endpoints as planned.
- Network behavior is not reliable enough for tests, so source outage and recovery behavior must be mocked.
- LLM output needs strict validation and deterministic fallback. Earlier T6 work added JSON validation and repair because malformed or unavailable model responses are normal failure modes.
- The assistant can improve local code and docs, but it cannot honestly create a demo recording link or verify logged-out public GitHub visibility without the required external action/state.
