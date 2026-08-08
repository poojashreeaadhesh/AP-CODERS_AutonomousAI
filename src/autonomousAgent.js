import { discoverTopics } from "./discovery.js";
import { evaluateTopics } from "./editorial.js";
import { loadStore, withStore } from "./store.js";
import { createId, nowIso } from "./utils.js";
import { writePost } from "./writer.js";

const DEFAULT_INTERVAL_MINUTES = 120;
const MAX_POSTS_PER_CYCLE = 1;

// Centralized pruning caps so memory growth is bounded from a single place.
// Posts are exempt: the API contract requires previously returned posts to
// remain available for the life of the agent.
const PRUNE_LIMITS = {
  seenTopics: 300,
  rejectedTopics: 150,
  cycles: 100
};

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
  const agentState = createInitialState(personaInput);

  await withStore((store) => {
    store.agents[agentState.agent.id] = agentState;
  });

  return agentState;
}

function recordSeenTopics(agentState, topics, now) {
  const existing = new Set(agentState.seenTopics.map((item) => item.url));
  for (const topic of topics) {
    if (!topic.url || existing.has(topic.url)) continue;
    agentState.seenTopics.push({
      title: topic.title,
      url: topic.url,
      sourceName: topic.sourceName,
      firstSeenAt: now.toISOString()
    });
  }

  agentState.seenTopics = agentState.seenTopics.slice(-PRUNE_LIMITS.seenTopics);
}

async function runSingleDueCycle(agentState, now = new Date()) {
  const topics = await discoverTopics(agentState.agent.persona);
  const evaluation = evaluateTopics(topics, agentState, now);

  recordSeenTopics(agentState, topics, now);
  agentState.rejectedTopics.push(...evaluation.rejected);
  agentState.rejectedTopics = agentState.rejectedTopics.slice(-PRUNE_LIMITS.rejectedTopics);

  const cycle = {
    id: createId("cycle"),
    ranAt: now.toISOString(),
    candidatesDiscovered: topics.length,
    rejectedCount: evaluation.rejected.length,
    publishedPostId: null,
    status: "no_publishable_topic"
  };

  if (evaluation.selected) {
    const post = writePost(evaluation.selected, agentState, now, evaluation.rejected);
    agentState.posts.unshift(post);
    cycle.publishedPostId = post.id;
    cycle.status = "published";
  }

  agentState.cycles.unshift(cycle);
  agentState.cycles = agentState.cycles.slice(0, PRUNE_LIMITS.cycles);
  agentState.nextPublishAt = nextPublishIso(now);

  return cycle;
}

export async function runDueCyclesForAgent(agentState, now = new Date()) {
  if (!agentState?.agent?.id) return { agentState, ranCycles: 0 };

  let ranCycles = 0;
  while (new Date(agentState.nextPublishAt).getTime() <= now.getTime() && ranCycles < MAX_POSTS_PER_CYCLE) {
    await runSingleDueCycle(agentState, now);
    ranCycles += 1;
  }

  return { agentState, ranCycles };
}

/**
 * Runs due cycles for every agent and persists only if something changed.
 * Goes through withStore() so concurrent invocations (the background tick
 * and multiple feed reads) serialize instead of racing on a shared
 * load-mutate-save cycle, which would otherwise silently drop posts.
 *
 * Callers on the read path must not await this — it does discovery/
 * editorial/writer work and must never block or fail a feed read.
 */
export async function runDueCyclesForAllAgents(now = new Date()) {
  return withStore(async (store) => {
    const ids = Object.keys(store.agents);
    let ranCycles = 0;

    for (const id of ids) {
      const result = await runDueCyclesForAgent(store.agents[id], now);
      ranCycles += result.ranCycles;
    }

    return { ranCycles, save: ranCycles > 0 };
  });
}

function resolveAgentId(store, requestedAgentId) {
  if (store.agents[requestedAgentId]) return requestedAgentId;

  const ids = Object.keys(store.agents);
  if (ids.length === 0) return null;

  // No exact match: serve the most recently created agent instead of 404ing.
  // A stale or mismatched agentId must never permanently lock an evaluator
  // out of the feed.
  return ids.sort(
    (a, b) => new Date(store.agents[b].agent.createdAt) - new Date(store.agents[a].agent.createdAt)
  )[0];
}

export async function loadFeedState(requestedAgentId) {
  const store = await loadStore();
  const resolvedAgentId = resolveAgentId(store, requestedAgentId);

  if (!resolvedAgentId) {
    return { status: 200, payload: { posts: [] } };
  }

  if (resolvedAgentId !== requestedAgentId) {
    console.warn(`Unknown agentId "${requestedAgentId}" — serving agent "${resolvedAgentId}" instead`);
  }

  const agentState = store.agents[resolvedAgentId];

  // Fire-and-forget: a feed read returns immediately and never fails because
  // a discovery/editorial cycle happened to be due.
  runDueCyclesForAllAgents().catch((error) => {
    console.error("Background catch-up cycle failed:", error.message);
  });

  return {
    status: 200,
    payload: {
      posts: [...agentState.posts].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    }
  };
}

export async function getHealthSnapshot() {
  const store = await loadStore();
  const ids = Object.keys(store.agents);

  const totalPosts = ids.reduce((sum, id) => sum + store.agents[id].posts.length, 0);

  const lastCycleAt = ids.reduce((latest, id) => {
    const cycle = store.agents[id].cycles[0];
    if (!cycle) return latest;
    return !latest || new Date(cycle.ranAt) > new Date(latest) ? cycle.ranAt : latest;
  }, null);

  const nextPublishAt = ids.reduce((soonest, id) => {
    const npa = store.agents[id].nextPublishAt;
    if (!npa) return soonest;
    return !soonest || new Date(npa) < new Date(soonest) ? npa : soonest;
  }, null);

  return {
    ok: true,
    uptimeSeconds: Math.floor(process.uptime()),
    agents: ids.length,
    posts: totalPosts,
    lastCycleAt,
    nextPublishAt
  };
}

export function startBackgroundWorker() {
  const tickSeconds = Number(process.env.AUTONOMOUS_TICK_SECONDS || 60);
  const intervalMs = Math.max(15, tickSeconds) * 1000;

  // Skip a tick outright if the previous one is still running, rather than
  // queuing ticks indefinitely behind a slow discovery call.
  let tickInFlight = false;

  const tick = async () => {
    if (tickInFlight) return;
    tickInFlight = true;

    try {
      await runDueCyclesForAllAgents();
    } catch (error) {
      console.error("Autonomous tick failed:", error.message);
    } finally {
      tickInFlight = false;
    }
  };

  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  tick();

  return timer;
}
