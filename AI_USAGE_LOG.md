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
