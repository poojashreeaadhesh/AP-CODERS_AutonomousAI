import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "aic-llm-test-"));
process.env.LLM_RETRY_BASE_MS = "0";

const { createInitialState, runPublishingCycle } = await import("../src/autonomousAgent.js");
const { evaluateTopicsWithLLM } = await import("../src/editorial.js");
const { resetLlmClientForTests, setLlmClientForTests } = await import("../src/llm.js");
const { writePostWithLLM } = await import("../src/writer.js");

function candidateTopic(overrides = {}) {
  return {
    title: "New LLM prompt injection benchmark exposes agent sandbox risks",
    url: "https://example.com/prompt-injection",
    sourceName: "Hacker News",
    publishedAt: "2026-08-08T08:00:00Z",
    summary: "AI security researchers evaluate prompt injection and sandbox escape failures in LLM agents.",
    signals: { points: 44, comments: 19 },
    ...overrides
  };
}

function fakeClient(responses) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    messages: {
      create: async () => {
        const next = responses[Math.min(calls, responses.length - 1)];
        calls += 1;
        if (next instanceof Error) throw next;
        return {
          content: [{ type: "text", text: next }],
          usage: { input_tokens: 10, output_tokens: 20 }
        };
      }
    }
  };
}

afterEach(() => {
  resetLlmClientForTests();
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.LLM_ENABLED;
});

test("without an API key, editorial and writer fall back and still produce a valid post", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const state = createInitialState({ name: "Ada", domain: "AI Security" });

  const evaluation = await evaluateTopicsWithLLM(
    [candidateTopic()],
    state,
    new Date("2026-08-08T10:00:00Z")
  );
  const post = await writePostWithLLM(evaluation.selected, state, new Date("2026-08-08T10:00:00Z"), evaluation.rejected);

  assert.equal(evaluation.selected.decidedBy, "heuristic-fallback");
  assert.equal(post.decidedBy, "heuristic-fallback");
  assert.equal(post.model, "heuristic-template");
  assert.equal(post.tokensUsed, 0);
  assert.match(post.text, /Ada/);
});

test("malformed Claude editorial JSON retries once, then falls back without crashing", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  const client = fakeClient(["not json", "{\"selected\":"]);
  setLlmClientForTests(client);
  const state = createInitialState({ name: "Ada", domain: "AI Security" });

  const evaluation = await evaluateTopicsWithLLM(
    [candidateTopic()],
    state,
    new Date("2026-08-08T10:00:00Z")
  );

  assert.equal(client.calls, 2);
  assert.equal(evaluation.selected.decidedBy, "heuristic-fallback");
  assert.equal(evaluation.llmError, "editorial_fallback");
});

test("rate-limited Claude editorial calls retry twice, then fall back", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  const rateLimit = new Error("overloaded");
  rateLimit.status = 529;
  const client = fakeClient([rateLimit, rateLimit, rateLimit]);
  setLlmClientForTests(client);
  const state = createInitialState({ name: "Ada", domain: "AI Security" });

  const evaluation = await evaluateTopicsWithLLM(
    [candidateTopic()],
    state,
    new Date("2026-08-08T10:00:00Z")
  );

  assert.equal(client.calls, 3);
  assert.equal(evaluation.selected.decidedBy, "heuristic-fallback");
  assert.equal(evaluation.llmError, "editorial_fallback");
});

test("Claude selected null is respected as an intentional no-publish cycle", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  const client = fakeClient([
    JSON.stringify({
      selected: null,
      editorialScore: 3.1,
      whySelected: "None of the candidates adds enough new AI Security signal.",
      whyNow: "The items are current but not strong enough for this persona today.",
      whyOverOthers: [],
      rejections: [{ id: "c1", reason: "It repeats a known prompt-injection pattern without new operational detail." }]
    })
  ]);
  setLlmClientForTests(client);
  const state = createInitialState({ name: "Ada", domain: "AI Security" });

  const cycle = await runPublishingCycle(
    state,
    [candidateTopic()],
    new Date("2026-08-08T10:00:00Z")
  );

  assert.equal(cycle.status, "no_publishable_topic");
  assert.equal(cycle.decidedBy, "llm");
  assert.equal(cycle.publishedPostId, null);
  assert.equal(state.posts.length, 0);
  assert.match(state.rejectedTopics[0].reason, /repeats a known prompt-injection pattern/);
});

test("LLM_ENABLED=false prevents outbound Claude calls even when a client is configured", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.LLM_ENABLED = "false";
  const client = fakeClient([
    JSON.stringify({
      selected: "c1",
      editorialScore: 8,
      whySelected: "Strong security signal.",
      whyNow: "Fresh now.",
      whyOverOthers: [],
      rejections: []
    })
  ]);
  setLlmClientForTests(client);
  const state = createInitialState({ name: "Ada", domain: "AI Security" });

  const evaluation = await evaluateTopicsWithLLM(
    [candidateTopic()],
    state,
    new Date("2026-08-08T10:00:00Z")
  );

  assert.equal(client.calls, 0);
  assert.equal(evaluation.selected.decidedBy, "heuristic-fallback");
});

test("Claude writer returns varied text with model and token metadata", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  const client = fakeClient([
    JSON.stringify({
      selected: "c1",
      editorialScore: 8.4,
      whySelected: "It exposes a concrete sandbox failure mode for agentic systems.",
      whyNow: "The benchmark surfaced this week and has active community discussion.",
      whyOverOthers: [],
      rejections: []
    }),
    JSON.stringify({
      text:
        "A useful signal here is not that another benchmark exists, but that prompt injection is still escaping the neat boxes teams draw around agent tools. The practical risk is ordinary: a model gets trusted with file, browser, or code access before the surrounding product has proven that isolation actually holds under hostile instructions. For AI security teams, this is a reminder to test the tool boundary, not only the model answer. Ship agents with narrower permissions, replayable traces, and failure drills before the demo path becomes the deployment path.\n\n- Ada",
      rationale:
        "Selected because it shows a concrete prompt-injection and sandboxing failure mode for AI Security. It is relevant now because the item was surfaced by Hacker News during this cycle. It beat weaker candidates because it has operational consequences for agent deployment.",
      themes: ["prompt-injection", "sandboxing"],
      entities: []
    })
  ]);
  setLlmClientForTests(client);
  const state = createInitialState({ name: "Ada", domain: "AI Security" });

  const evaluation = await evaluateTopicsWithLLM(
    [candidateTopic()],
    state,
    new Date("2026-08-08T10:00:00Z")
  );
  const post = await writePostWithLLM(evaluation.selected, state, new Date("2026-08-08T10:00:00Z"), evaluation.rejected);

  assert.equal(post.decidedBy, "llm");
  assert.equal(post.writerBy, "llm");
  assert.equal(post.model, "claude-sonnet-5");
  assert.ok(post.tokensUsed > 0);
  assert.equal(post.editorialScore, 8.4);
  assert.notEqual(post.text.split(/\s+/).slice(0, 8).join(" "), "Watching: New LLM prompt injection benchmark exposes agent");
  assert.deepEqual(post.themes, ["prompt-injection", "sandboxing"]);
});
