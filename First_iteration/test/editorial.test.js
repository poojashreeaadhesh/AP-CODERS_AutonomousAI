import test from "node:test";
import assert from "node:assert/strict";
import { createInitialState } from "../src/autonomousAgent.js";
import { evaluateTopics } from "../src/editorial.js";
import { writePost } from "../src/writer.js";

test("editorial judgment accepts fresh persona-relevant technology topics", () => {
  const state = createInitialState({ name: "Ada", domain: "AI Security" });
  const now = new Date("2026-08-08T10:00:00Z");

  const result = evaluateTopics(
    [
      {
        title: "New LLM prompt injection benchmark exposes agent tool risks",
        url: "https://example.com/security",
        sourceName: "Hacker News",
        publishedAt: "2026-08-08T08:00:00Z",
        summary: "AI security researchers evaluate prompt injection failures in LLM agents.",
        signals: { points: 30, comments: 12 }
      }
    ],
    state,
    now
  );

  assert.equal(result.selected.topic.url, "https://example.com/security");
});

test("editorial judgment rejects off-beat promotional topics", () => {
  const state = createInitialState({ name: "Ada", domain: "AI Security" });
  const now = new Date("2026-08-08T10:00:00Z");

  const result = evaluateTopics(
    [
      {
        title: "Top 10 coupon tricks for weekend shopping",
        url: "https://example.com/coupons",
        sourceName: "Dev.to",
        publishedAt: "2026-08-08T08:00:00Z",
        summary: "Sponsored shopping content.",
        signals: { points: 100, comments: 20 }
      }
    ],
    state,
    now
  );

  assert.equal(result.selected, null);
  assert.equal(result.rejected.length, 1);
});

test("compound personas require specific beat signals", () => {
  const state = createInitialState({ name: "Ada", domain: "AI Security" });
  const now = new Date("2026-08-08T10:00:00Z");

  const result = evaluateTopics(
    [
      {
        title: "AI-native CRM workflow launches for sales teams",
        url: "https://example.com/crm",
        sourceName: "Hacker News",
        publishedAt: "2026-08-08T08:00:00Z",
        summary: "A new AI product for revenue operations and CRM automation.",
        signals: { points: 40, comments: 20 }
      }
    ],
    state,
    now
  );

  assert.equal(result.selected, null);
  assert.match(result.rejected[0].reason, /lacks the specific AI Security angle/);
});

test("post writer includes rationale and source transparency", () => {
  const state = createInitialState({ name: "Ada", domain: "AI Security" });
  const post = writePost(
    {
      topic: {
        title: "LLM agents need better sandboxing",
        url: "https://example.com/agents",
        sourceName: "arXiv"
      },
      reasons: ["it matches the persona's AI Security focus", "it is fresh within the last 24 hours"]
    },
    state,
    new Date("2026-08-08T10:00:00Z")
  );

  assert.match(post.text, /Ada/);
  assert.match(post.rationale, /Selected because/);
  assert.deepEqual(post.sources, ["https://example.com/agents"]);
});

test("memory rejects already published sources", () => {
  const state = createInitialState({ name: "Ada", domain: "AI Security" });
  state.posts.unshift({
    id: "p-old",
    createdAt: "2026-08-08T09:00:00Z",
    text: "Watching: LLM agents need better sandboxing",
    rationale: "Selected earlier.",
    sources: ["https://example.com/agents"]
  });

  const result = evaluateTopics(
    [
      {
        title: "LLM agents need better sandboxing after prompt injection tests",
        url: "https://example.com/agents",
        sourceName: "Hacker News",
        publishedAt: "2026-08-08T09:30:00Z",
        summary: "AI security teams test sandbox escape and prompt injection risk.",
        signals: { points: 80, comments: 30 }
      }
    ],
    state,
    new Date("2026-08-08T10:00:00Z")
  );

  assert.equal(result.selected, null);
  assert.match(result.rejected[0].reason, /already been published/);
});
