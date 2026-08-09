import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "aic-resilience-test-"));
process.env.LLM_ENABLED = "false";
delete process.env.ANTHROPIC_API_KEY;

const { createServer } = await import("../src/server.js");
const {
  createInitialState,
  initializeAgent,
  runDueCyclesForAgent,
  runPublishingCycle
} = await import("../src/autonomousAgent.js");
const { discoverTopicsWithTelemetry, SOURCE_REGISTRY } = await import("../src/discovery.js");
const { clearStateForTests, withStore } = await import("../src/store.js");

function topic(overrides = {}) {
  return {
    title: "Prompt injection exploit exposes AI security sandbox risk",
    url: `https://example.com/topic-${Math.random().toString(16).slice(2)}`,
    sourceName: "Hacker News",
    sourceId: "hacker-news",
    publishedAt: "2026-08-09T08:00:00.000Z",
    summary: "AI security teams found prompt injection and sandbox escape risk in production agent tool calls.",
    signals: { points: 120, comments: 40 },
    ...overrides
  };
}

function sourceHealthFromResults(results) {
  return Object.fromEntries(
    results.map((result) => [
      result.id,
      {
        sourceName: result.sourceName,
        kind: result.kind,
        status: result.status,
        query: result.query,
        lastCount: result.count,
        lastCheckedAt: result.lastCheckedAt,
        consecutiveFailures: result.consecutiveFailures,
        disabledUntil: result.disabledUntil,
        lastError: result.error
      }
    ])
  );
}

function successResponseFor(input) {
  const target = String(input?.url || input);

  if (target.includes("hn.algolia.com")) {
    return new Response(
      JSON.stringify({
        hits: [
          {
            title: "Prompt injection exploit reaches production AI agents",
            url: "https://example.com/hn-agent-security",
            created_at: "2026-08-09T08:00:00.000Z",
            story_text: "AI security prompt injection sandbox exploit",
            points: 80,
            num_comments: 15
          }
        ]
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  if (target.includes("dev.to")) {
    return new Response(
      JSON.stringify([
        {
          title: "AI security guide for agent tool calls",
          url: "https://example.com/devto-agent-security",
          published_at: "2026-08-09T08:00:00.000Z",
          description: "Prompt injection risk and sandbox safety for AI developer tools.",
          public_reactions_count: 40,
          comments_count: 8
        }
      ]),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  if (target.includes("export.arxiv.org")) {
    return new Response(
      `<feed><entry><title>AI Security Benchmark for Prompt Injection</title><id>https://arxiv.org/abs/2608.00001</id><published>2026-08-09T08:00:00Z</published><summary>Model security benchmark for prompt injection and sandbox risk.</summary></entry></feed>`,
      { status: 200, headers: { "content-type": "application/atom+xml" } }
    );
  }

  if (target.includes("github.com/trending")) {
    return new Response(
      `<html><h2><a href="/secure-ai/agent-sandbox">secure-ai / agent-sandbox</a></h2></html>`,
      { status: 200, headers: { "content-type": "text/html" } }
    );
  }

  return new Response(
    `<feed><entry><title>AI security incident response for agent tools</title><link href="https://example.com/rss-agent-security" /><updated>2026-08-09T08:00:00Z</updated><summary>Prompt injection risk and practical sandbox mitigations for AI systems.</summary></entry></feed>`,
    { status: 200, headers: { "content-type": "application/atom+xml" } }
  );
}

async function withServer(fn) {
  await clearStateForTests();
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await fn(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await clearStateForTests();
  }
}

test("source registry includes API, RSS or Atom, and HTML discovery sources", () => {
  assert.ok(SOURCE_REGISTRY.length >= 6);
  assert.ok(SOURCE_REGISTRY.some((source) => source.kind === "api"));
  assert.ok(SOURCE_REGISTRY.some((source) => source.kind === "rss"));
  assert.ok(SOURCE_REGISTRY.some((source) => source.kind === "html"));
});

test("consecutive discovery cycles rotate queries", async () => {
  const disabledUntil = "2026-08-09T11:00:00.000Z";
  const sourceHealth = Object.fromEntries(
    SOURCE_REGISTRY.map((source) => [
      source.id,
      {
        status: "disabled",
        disabledUntil,
        consecutiveFailures: 3,
        lastError: "test-disabled"
      }
    ])
  );

  const first = await discoverTopicsWithTelemetry(
    { domain: "AI Security" },
    { cycleCount: 0, sourceHealth, now: new Date("2026-08-09T10:00:00.000Z") }
  );
  const second = await discoverTopicsWithTelemetry(
    { domain: "AI Security" },
    { cycleCount: 1, sourceHealth, now: new Date("2026-08-09T10:01:00.000Z") }
  );

  assert.notEqual(first.query, second.query);
  assert.equal(first.sourceResults[0].query, "AI security");
  assert.equal(second.sourceResults[0].query, "LLM vulnerability");
});

test("source circuit breaker disables failing sources and retries after the window", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let sourceHealth = {};

  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("network down");
  };

  try {
    for (let i = 0; i < 3; i += 1) {
      const result = await discoverTopicsWithTelemetry(
        { domain: "AI Security" },
        {
          cycleCount: i,
          sourceHealth,
          now: new Date(`2026-08-09T10:0${i}:00.000Z`)
        }
      );
      sourceHealth = sourceHealthFromResults(result.sourceResults);
    }

    assert.ok(Object.values(sourceHealth).every((entry) => entry.status === "disabled"));
    assert.ok(Object.values(sourceHealth).every((entry) => entry.disabledUntil));
    assert.equal(calls, SOURCE_REGISTRY.length * 3);

    const skipped = await discoverTopicsWithTelemetry(
      { domain: "AI Security" },
      { cycleCount: 3, sourceHealth, now: new Date("2026-08-09T10:10:00.000Z") }
    );
    assert.equal(calls, SOURCE_REGISTRY.length * 3);
    assert.ok(skipped.sourceResults.every((result) => result.status === "disabled"));

    globalThis.fetch = async (input) => {
      calls += 1;
      return successResponseFor(input);
    };

    const recovered = await discoverTopicsWithTelemetry(
      { domain: "AI Security" },
      { cycleCount: 4, sourceHealth, now: new Date("2026-08-09T10:35:00.000Z") }
    );
    assert.ok(recovered.sourceResults.every((result) => result.status === "ok"));
    assert.ok(recovered.topics.length > 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("when all outbound HTTP fails, a due cycle publishes from the reserve pool", async () => {
  const originalFetch = globalThis.fetch;
  const state = createInitialState({ name: "Ada", domain: "AI Security" });
  const now = new Date("2026-08-09T10:00:00.000Z");
  state.nextPublishAt = now.toISOString();
  state.candidateReserve = [
    topic({
      title: "Prompt injection sandbox escape gives AI security teams a concrete incident drill",
      url: "https://example.com/reserve-agent-security",
      sourceName: "Hacker News",
      reserveScore: 9.5,
      reservedAt: "2026-08-09T09:00:00.000Z"
    })
  ];

  globalThis.fetch = async () => {
    throw new Error("network down");
  };

  try {
    const result = await runDueCyclesForAgent(state, now);
    assert.equal(result.ranCycles, 1);
    assert.equal(state.posts.length, 1);
    assert.match(state.posts[0].rationale, /Live sources were unreachable|reserve candidate pool/);
    assert.equal(state.cycles[0].usedReserve, true);
    assert.equal(state.cycles[0].sourceOutage, true);
    assert.ok(state.cycles[0].sourcesFailed.length >= SOURCE_REGISTRY.length);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("source diversity governor chooses another source after two same-source posts", async () => {
  const state = createInitialState({ name: "Ada", domain: "AI Security" });
  state.posts.unshift(
    {
      id: "p-old-1",
      createdAt: "2026-08-09T09:00:00.000Z",
      text: "Signal from this cycle: old Hacker News story",
      rationale: "Selected earlier.",
      sources: ["https://example.com/old-1"],
      sourceName: "Hacker News"
    },
    {
      id: "p-old-2",
      createdAt: "2026-08-09T08:00:00.000Z",
      text: "Signal from this cycle: older Hacker News story",
      rationale: "Selected earlier.",
      sources: ["https://example.com/old-2"],
      sourceName: "Hacker News"
    }
  );

  const cycle = await runPublishingCycle(
    state,
    [
      topic({
        title: "Prompt injection exploit reaches production AI agent sandbox",
        url: "https://example.com/hn-diversity",
        sourceName: "Hacker News",
        signals: { points: 250, comments: 90 }
      }),
      topic({
        title: "AI security benchmark maps prompt injection failures in agent sandboxes",
        url: "https://example.com/arxiv-diversity",
        sourceName: "arXiv",
        sourceId: "arxiv",
        signals: { points: 1, comments: 0 }
      })
    ],
    new Date("2026-08-09T10:00:00.000Z")
  );

  assert.equal(cycle.status, "published");
  assert.equal(state.posts[0].sourceName, "arXiv");
  assert.match(state.posts[0].rationale, /outside Hacker News|last two posts/);
});

test("integration: init, force one cycle, then feed returns a valid post", async () => {
  const originalFetch = globalThis.fetch;

  await withServer(async (baseUrl) => {
    globalThis.fetch = async (input, init) => {
      const target = String(input?.url || input);
      if (target.startsWith(baseUrl)) {
        return originalFetch(input, init);
      }
      return successResponseFor(input);
    };

    try {
      const initResponse = await fetch(`${baseUrl}/api/agent/init`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ persona: { name: "Ada", domain: "AI Security" } })
      });
      const { agentId } = await initResponse.json();
      const now = new Date("2026-08-09T10:00:00.000Z");

      await withStore(async (store) => {
        store.agents[agentId].nextPublishAt = now.toISOString();
        await runDueCyclesForAgent(store.agents[agentId], now);
        store.agents[agentId].nextPublishAt = "2099-01-01T00:00:00.000Z";
      });

      const feedResponse = await fetch(`${baseUrl}/api/agent/feed?agentId=${agentId}`);
      const feed = await feedResponse.json();

      assert.equal(feedResponse.status, 200);
      assert.equal(feed.posts.length, 1);
      assert.ok(feed.posts[0].id);
      assert.ok(feed.posts[0].rationale);
      assert.ok(feed.posts[0].sources.length > 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
