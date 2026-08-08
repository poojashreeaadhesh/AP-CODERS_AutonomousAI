import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Each test file gets its own DATA_DIR so parallel test files (node --test
// runs files concurrently) never race on the same physical state.json.
process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "aic-api-test-"));

const { createServer } = await import("../src/server.js");
const { clearStateForTests } = await import("../src/store.js");

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
