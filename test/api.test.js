import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Each test file gets its own DATA_DIR so parallel test files (node --test
// runs files concurrently) never race on the same physical state.json.
process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "aic-api-test-"));

const { createServer } = await import("../src/server.js");
const { createInitialState, runPublishingCycle } = await import("../src/autonomousAgent.js");
const { clearStateForTests, saveStore, withStore } = await import("../src/store.js");

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

test("feed with no agentId returns 400 and no stack trace", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/agent/feed`);
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(typeof body.error, "string");
    assert.equal(body.stack, undefined);
  });
});

test("feed with an unknown agentId before any agent exists returns 200 with an empty feed", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/agent/feed?agentId=totally-bogus`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, { posts: [] });
  });
});

test("feed with an unknown agentId after init still returns 200 with the real posts, not 404", async () => {
  await withServer(async (baseUrl) => {
    const initResponse = await fetch(`${baseUrl}/api/agent/init`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ persona: { name: "Ada", domain: "AI Security" } })
    });
    const { agentId } = await initResponse.json();
    assert.equal(typeof agentId, "string");

    const feedResponse = await fetch(`${baseUrl}/api/agent/feed?agentId=some-other-id`);
    const body = await feedResponse.json();

    assert.equal(feedResponse.status, 200);
    assert.ok(Array.isArray(body.posts));
  });
});

test("feed for the real agentId returns quickly and never blocks on discovery", async () => {
  await withServer(async (baseUrl) => {
    const initResponse = await fetch(`${baseUrl}/api/agent/init`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ persona: { name: "Ada", domain: "AI Security" } })
    });
    const { agentId } = await initResponse.json();

    const startedAt = Date.now();
    const feedResponse = await fetch(`${baseUrl}/api/agent/feed?agentId=${agentId}`);
    const elapsedMs = Date.now() - startedAt;
    const body = await feedResponse.json();

    assert.equal(feedResponse.status, 200);
    assert.ok(Array.isArray(body.posts));
    assert.ok(elapsedMs < 500, `feed read took ${elapsedMs}ms, expected < 500ms`);
  });
});

test("health endpoint reports the documented fields", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(typeof body.uptimeSeconds, "number");
    assert.equal(typeof body.agents, "number");
    assert.equal(typeof body.posts, "number");
    assert.ok("lastCycleAt" in body);
    assert.ok("nextPublishAt" in body);
  });
});

async function seedTransparentAgent({ due = false } = {}) {
  const state = createInitialState({ name: "Ada", domain: "AI Security" });
  await runPublishingCycle(
    state,
    [
      {
        title: "Prompt injection benchmark exposes risky agent tool calls",
        url: "https://example.com/prompt-injection",
        sourceName: "Hacker News",
        publishedAt: "2026-08-08T08:00:00Z",
        summary: "AI security researchers discuss prompt injection and agent tool risk.",
        signals: { points: 60, comments: 20 }
      }
    ],
    new Date("2026-08-08T10:00:00Z")
  );
  await runPublishingCycle(
    state,
    Array.from({ length: 12 }, (_, index) => ({
      title: `Top ${index + 1} coupon tricks for weekend shopping`,
      url: `https://example.com/coupon-${index + 1}`,
      sourceName: "Dev.to",
      publishedAt: "2026-08-08T09:00:00Z",
      summary: "Sponsored shopping content.",
      signals: { points: 40, comments: 20 }
    })),
    new Date("2026-08-08T11:00:00Z")
  );
  state.nextPublishAt = due
    ? "2000-01-01T00:00:00.000Z"
    : new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await saveStore({ version: 2, agents: { [state.agent.id]: state } });
  return state.agent.id;
}

test("transparency endpoints return empty shaped payloads before initialization", async () => {
  await withServer(async (baseUrl) => {
    const endpoints = {
      status: "/api/agent/status?agentId=missing",
      rejected: "/api/agent/rejected?agentId=missing",
      cycles: "/api/agent/cycles?agentId=missing",
      memory: "/api/agent/memory?agentId=missing",
      log: "/api/agent/log?agentId=missing"
    };

    for (const [name, pathName] of Object.entries(endpoints)) {
      const response = await fetch(`${baseUrl}${pathName}`);
      const body = await response.json();
      assert.equal(response.status, 200, `${name} should return 200`);
      assert.equal(body.error, undefined);
    }
  });
});

test("transparency endpoints expose status, rejections, cycles, memory, and activity log for a live agent", async () => {
  await withServer(async (baseUrl) => {
    const agentId = await seedTransparentAgent();

    const [status, rejected, cycles, memory, log, feed] = await Promise.all(
      [
        `/api/agent/status?agentId=${agentId}`,
        `/api/agent/rejected?agentId=${agentId}&limit=20`,
        `/api/agent/cycles?agentId=${agentId}&limit=20`,
        `/api/agent/memory?agentId=${agentId}`,
        `/api/agent/log?agentId=${agentId}&limit=50`,
        `/api/agent/feed?agentId=${agentId}`
      ].map(async (pathName) => {
        const response = await fetch(`${baseUrl}${pathName}`);
        assert.equal(response.status, 200, `${pathName} should return 200`);
        return response.json();
      })
    );

    assert.equal(status.persona.domain, "AI Security");
    assert.ok(status.nextPublishAt);
    assert.ok(status.nextPublishReason);
    assert.equal(status.counts.posts, 1);
    assert.equal(status.counts.cycles, 2);
    assert.equal(status.llmEnabled, false);

    assert.ok(rejected.rejected.length >= 10);
    assert.ok(rejected.rejected.every((item) => item.reason));
    assert.ok(cycles.cycles.some((cycle) => cycle.status === "no_publishable_topic"));

    const postIds = new Set(feed.posts.map((post) => post.id));
    for (const entry of Object.values(memory.themes)) {
      assert.ok(entry.postIds.every((id) => postIds.has(id)));
    }

    const publishedEvent = log.log.find((entry) => entry.event === "post.published");
    assert.ok(publishedEvent);
    assert.ok(postIds.has(publishedEvent.data.postId));
  });
});

test("transparency endpoints are read-only and do not trigger discovery even when a cycle is due", async () => {
  await withServer(async (baseUrl) => {
    const agentId = await seedTransparentAgent({ due: true });
    const originalFetch = globalThis.fetch;
    let outboundFetches = 0;

    globalThis.fetch = async (input, init) => {
      const target = String(input?.url || input);
      if (!target.startsWith(baseUrl)) {
        outboundFetches += 1;
        throw new Error("unexpected outbound fetch");
      }
      return originalFetch(input, init);
    };

    try {
      const paths = [
        `/api/agent/status?agentId=${agentId}`,
        `/api/agent/rejected?agentId=${agentId}`,
        `/api/agent/cycles?agentId=${agentId}`,
        `/api/agent/memory?agentId=${agentId}`,
        `/api/agent/log?agentId=${agentId}`
      ];

      for (let i = 0; i < 4; i += 1) {
        await Promise.all(paths.map((pathName) => fetch(`${baseUrl}${pathName}`).then((response) => response.json())));
      }
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(outboundFetches, 0);

    await withStore((store) => {
      assert.equal(store.agents[agentId].cycles.length, 2);
      return { save: false };
    });
  });
});
