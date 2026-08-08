import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Each test file gets its own DATA_DIR so parallel test files (node --test
// runs files concurrently) never race on the same physical state.json.
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "aic-store-test-"));
process.env.DATA_DIR = dataDir;

const { clearStateForTests, loadStore, resetMemoryCacheForTests, saveStore, withStore } = await import(
  "../src/store.js"
);

const statePath = path.join(dataDir, "state.json");
const backupPath = `${statePath}.bak`;
const tmpPath = `${statePath}.tmp`;

test.beforeEach(async () => {
  await clearStateForTests();
});

test.after(async () => {
  await clearStateForTests();
});

test("withStore serializes concurrent read-modify-write cycles without losing updates", async () => {
  await saveStore({ version: 2, agents: {}, counter: 0 });

  await Promise.all(
    Array.from({ length: 20 }, () =>
      withStore((store) => {
        store.counter = (store.counter || 0) + 1;
      })
    )
  );

  const finalStore = await loadStore();
  assert.equal(finalStore.counter, 20);
});

test("withStore never leaves a .tmp file behind after a successful save", async () => {
  await withStore((store) => {
    store.agents["agent-1"] = { agent: { id: "agent-1" }, posts: [] };
  });

  await assert.rejects(() => fs.access(tmpPath));
});

test("a corrupt state.json with a valid .bak recovers all posts without throwing", async () => {
  const goodStore = {
    version: 2,
    agents: {
      "agent-1": {
        agent: { id: "agent-1", persona: { name: "Ada", domain: "AI Security" }, createdAt: "2026-08-08T00:00:00.000Z" },
        posts: [{ id: "p-1", createdAt: "2026-08-08T00:00:00.000Z", text: "hi", rationale: "r", sources: [] }],
        rejectedTopics: [],
        seenTopics: [],
        cycles: [],
        nextPublishAt: "2099-01-01T00:00:00.000Z"
      }
    }
  };

  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(backupPath, JSON.stringify(goodStore, null, 2));
  await fs.writeFile(statePath, "{ this is not valid json");
  resetMemoryCacheForTests();

  const recovered = await loadStore();

  assert.equal(recovered.agents["agent-1"].posts.length, 1);
  assert.equal(recovered.agents["agent-1"].posts[0].id, "p-1");
});

test("a corrupt state.json with a corrupt .bak falls back to an empty store instead of throwing", async () => {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(statePath, "{ not json");
  await fs.writeFile(backupPath, "{ also not json");
  resetMemoryCacheForTests();

  const result = await loadStore();

  assert.deepEqual(result, { version: 2, agents: {} });
});

test("an in-memory cache survives disk corruption within the same process", async () => {
  await withStore((store) => {
    store.agents["agent-1"] = { agent: { id: "agent-1" }, posts: [{ id: "p-1" }] };
  });

  // Corrupt both files on disk directly, without touching the in-memory cache.
  await fs.writeFile(statePath, "{ not json");
  await fs.writeFile(backupPath, "{ also not json");

  const stillGood = await loadStore();
  assert.equal(stillGood.agents["agent-1"].posts.length, 1);
});

test("posts persist across a simulated process restart (memory cache cleared, disk intact)", async () => {
  await withStore((store) => {
    store.agents["agent-1"] = {
      agent: { id: "agent-1", createdAt: "2026-08-08T00:00:00.000Z" },
      posts: [{ id: "p-1" }, { id: "p-2" }]
    };
  });

  resetMemoryCacheForTests();

  const reloaded = await loadStore();
  assert.equal(reloaded.agents["agent-1"].posts.length, 2);
});
