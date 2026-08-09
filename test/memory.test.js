import test from "node:test";
import assert from "node:assert/strict";
import { createInitialState, runPublishingCycle } from "../src/autonomousAgent.js";
import { evaluateTopics } from "../src/editorial.js";
import { titleFingerprint, similarity } from "../src/utils.js";

function topic(title, overrides = {}) {
  return {
    title,
    url: `https://example.com/${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    sourceName: "Hacker News",
    publishedAt: "2026-08-08T08:00:00Z",
    summary: `${title}. AI security researchers discuss prompt injection, sandbox controls, and agent tool risk.`,
    signals: { points: 60, comments: 25 },
    ...overrides
  };
}

test("near-duplicate title similarity catches the sandbox escape case", () => {
  assert.ok(
    similarity(
      "AI model escapes sandbox in security test",
      "Kimi K3 AI model escapes isolated sandbox during security test"
    ) > 0.45
  );
});

test("same title with a different URL is rejected as repeated coverage", () => {
  const state = createInitialState({ name: "Ada", domain: "AI Security" });
  const title = "Kimi K3 AI model escapes isolated sandbox during security test";
  state.posts.unshift({
    id: "p-old",
    createdAt: "2026-08-08T09:00:00Z",
    sourceTitle: title,
    titleFingerprint: titleFingerprint(title),
    text: `Signal from this cycle: ${title}`,
    rationale: "Selected earlier.",
    sources: ["https://example.com/original"],
    themes: ["sandbox"],
    entities: ["kimi", "k3"]
  });

  const result = evaluateTopics(
    [
      topic(title, {
        url: "https://example.com/syndicated-copy"
      })
    ],
    state,
    new Date("2026-08-08T10:00:00Z")
  );

  assert.equal(result.selected, null);
  assert.match(result.rejected[0].reason, /rehash information already covered/);
});

test("unrelated security topic is not rejected as a duplicate", () => {
  const state = createInitialState({ name: "Ada", domain: "AI Security" });
  state.posts.unshift({
    id: "p-old",
    createdAt: "2026-08-08T09:00:00Z",
    sourceTitle: "Kimi K3 AI model escapes isolated sandbox during security test",
    text: "Signal from this cycle: Kimi K3 AI model escapes isolated sandbox during security test",
    rationale: "Selected earlier.",
    sources: ["https://example.com/original"],
    themes: ["sandbox"],
    entities: ["kimi", "k3"]
  });

  const result = evaluateTopics(
    [
      topic("Open source scanner finds AI supply chain vulnerability", {
        url: "https://example.com/supply-chain"
      })
    ],
    state,
    new Date("2026-08-08T10:00:00Z")
  );

  assert.ok(result.selected, "expected unrelated security topic to remain publishable");
});

test("published posts build a theme memory index with valid post references", async () => {
  const state = createInitialState({ name: "Ada", domain: "AI Security" });
  const titles = [
    "Prompt injection benchmark exposes risky agent tool calls",
    "Open source scanner finds AI supply chain vulnerability",
    "Red team report shows privacy leak in model evaluation",
    "Jailbreak research maps production AI security risk",
    "Sandbox controls for LLM agents get new security test"
  ];

  for (let index = 0; index < titles.length; index += 1) {
    await runPublishingCycle(state, [topic(titles[index])], new Date(`2026-08-08T1${index}:00:00Z`));
  }

  const postIds = new Set(state.posts.map((post) => post.id));
  assert.equal(state.posts.length, 5);
  assert.ok(Object.keys(state.memory.themes).length > 0);

  for (const entry of Object.values(state.memory.themes)) {
    assert.ok(entry.count >= 1);
    assert.ok(entry.postIds.every((id) => postIds.has(id)));
  }
});

test("relatedPostIds link later posts to prior related coverage and rationaleDetail is populated", async () => {
  const state = createInitialState({ name: "Ada", domain: "AI Security" });

  await runPublishingCycle(
    state,
    [topic("Prompt injection benchmark exposes risky agent tool calls")],
    new Date("2026-08-08T10:00:00Z")
  );
  await runPublishingCycle(
    state,
    [topic("Security report shows agent tool permissions need tighter review")],
    new Date("2026-08-08T11:00:00Z")
  );

  const latest = state.posts[0];
  const allIds = new Set(state.posts.map((post) => post.id));

  assert.ok(latest.relatedPostIds.length > 0);
  assert.ok(latest.relatedPostIds.every((id) => allIds.has(id)));
  assert.match(latest.text, /prior coverage/);
  assert.equal(latest.rationaleDetail.candidatesEvaluated, 1);
  assert.deepEqual(latest.rationaleDetail.sourcesQueried, ["Hacker News"]);
  assert.equal(latest.rationaleDetail.cycleId, state.cycles[0].id);
  assert.equal(latest.rationaleDetail.decidedBy, latest.decidedBy);
  assert.equal(latest.rationaleDetail.editorialScore, latest.editorialScore);
  assert.deepEqual(latest.rationaleDetail.relatedPostIds, latest.relatedPostIds);
  assert.ok(latest.rationaleDetail.whySelected);
  assert.ok(latest.rationaleDetail.whyNow);
  assert.ok(Array.isArray(latest.rationaleDetail.whyOverOthers));
});
