import { discoverTopics } from "./discovery.js";
import { evaluateTopics } from "./editorial.js";
import { loadState, saveState } from "./store.js";
import { createId, nowIso } from "./utils.js";
import { writePost } from "./writer.js";

const DEFAULT_INTERVAL_MINUTES = 120;
const MAX_POSTS_PER_CYCLE = 1;

function publishIntervalMs() {
  const configured = Number(process.env.PUBLISH_INTERVAL_MINUTES || DEFAULT_INTERVAL_MINUTES);
  const minutes = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_INTERVAL_MINUTES;
  return minutes * 60 * 1000;
}

function nextPublishIso(fromDate = new Date()) {
  return new Date(fromDate.getTime() + publishIntervalMs()).toISOString();
}

function normalizePersona(persona = {}) {
  return {
    name: String(persona.name || "Ada").trim().slice(0, 80) || "Ada",
    domain: String(persona.domain || "AI Security").trim().slice(0, 120) || "AI Security"
  };
}

export function createInitialState(personaInput) {
  const createdAt = nowIso();
  const persona = normalizePersona(personaInput);

  return {
    agent: {
      id: createId("agent"),
      persona,
      createdAt,
      voice: {
        style: "measured, technical, skeptical of hype, practical for builders",
        interests: [
          persona.domain,
          "AI systems in production",
          "developer impact",
          "failure modes",
          "research becoming practice"
        ],
        opinions: [
          "freshness is not enough without substance",
          "claims need operational consequences",
          "memory matters because repeated takes erode trust"
        ]
      }
    },
    posts: [],
    rejectedTopics: [],
    seenTopics: [],
    cycles: [],
    nextPublishAt: createdAt
  };
}

export async function initializeAgent(personaInput) {
  const existing = await loadState();
  if (existing?.agent?.id) {
    return existing;
  }

  const state = createInitialState(personaInput);
  await saveState(state);
  return state;
}

function recordSeenTopics(state, topics, now) {
  const existing = new Set(state.seenTopics.map((item) => item.url));
  for (const topic of topics) {
    if (!topic.url || existing.has(topic.url)) continue;
    state.seenTopics.push({
      title: topic.title,
      url: topic.url,
      sourceName: topic.sourceName,
      firstSeenAt: now.toISOString()
    });
  }

  state.seenTopics = state.seenTopics.slice(-300);
}

async function runSingleDueCycle(state, now = new Date()) {
  const topics = await discoverTopics(state.agent.persona);
  const evaluation = evaluateTopics(topics, state, now);

  recordSeenTopics(state, topics, now);
  state.rejectedTopics.push(...evaluation.rejected);
  state.rejectedTopics = state.rejectedTopics.slice(-150);

  const cycle = {
    id: createId("cycle"),
    ranAt: now.toISOString(),
    candidatesDiscovered: topics.length,
    rejectedCount: evaluation.rejected.length,
    publishedPostId: null,
    status: "no_publishable_topic"
  };

  if (evaluation.selected) {
    const post = writePost(evaluation.selected, state, now, evaluation.rejected);
    state.posts.unshift(post);
    cycle.publishedPostId = post.id;
    cycle.status = "published";
  }

  state.cycles.unshift(cycle);
  state.cycles = state.cycles.slice(0, 100);
  state.nextPublishAt = nextPublishIso(now);

  return cycle;
}

export async function runDueCycles(state, now = new Date()) {
  if (!state?.agent?.id) return state;

  let cycles = 0;
  while (new Date(state.nextPublishAt).getTime() <= now.getTime() && cycles < MAX_POSTS_PER_CYCLE) {
    await runSingleDueCycle(state, now);
    cycles += 1;
  }

  if (cycles > 0) {
    await saveState(state);
  }

  return state;
}

export async function loadFeedState(agentId) {
  const state = await loadState();
  if (!state?.agent?.id) {
    return { status: 404, payload: { error: "Agent has not been initialized" } };
  }

  if (state.agent.id !== agentId) {
    return { status: 404, payload: { error: "Unknown agentId" } };
  }

  await runDueCycles(state);

  return {
    status: 200,
    payload: {
      posts: [...state.posts].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    }
  };
}

export function startBackgroundWorker() {
  const tickSeconds = Number(process.env.AUTONOMOUS_TICK_SECONDS || 60);
  const intervalMs = Math.max(15, tickSeconds) * 1000;

  const tick = async () => {
    const state = await loadState();
    if (!state?.agent?.id) return;
    await runDueCycles(state);
  };

  const timer = setInterval(() => {
    tick().catch((error) => {
      console.error("Autonomous tick failed:", error.message);
    });
  }, intervalMs);

  timer.unref?.();
  tick().catch((error) => {
    console.error("Initial autonomous tick failed:", error.message);
  });

  return timer;
}
