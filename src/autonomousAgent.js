import { DEFAULT_EDITORIAL_THRESHOLD, evaluateTopicsWithLLM } from "./editorial.js";
import { discoverTopics } from "./discovery.js";
import { buildMemoryHints, updateMemoryWithPost } from "./memory.js";
import { loadStore, withStore } from "./store.js";
import { createId, nowIso } from "./utils.js";
import { writePostWithLLM } from "./writer.js";

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

// Scheduling never goes silent for long: a quiet cycle decays the editorial
// threshold and retries soon rather than waiting a full interval, and a
// detected host gap is recovered gradually rather than backdated or dumped
// in one synchronous burst.
const THRESHOLD_DECAY_STEP = 0.75;
const THRESHOLD_FLOOR = Number(process.env.EDITORIAL_THRESHOLD_FLOOR) || 2.0;
const FIRST_POST_RETRY_MINUTES = 1;
const QUIET_CYCLE_RETRY_MINUTES = 10;
const CATCHUP_STEP_MINUTES = 8;
const MAX_CATCHUP_CYCLES = Number(process.env.MAX_CATCHUP_POSTS) || 3;
const JITTER_PCT = clamp01(process.env.PUBLISH_JITTER_PCT, 0.2);
const STRONG_POOL_SIZE = 3;
const STRONG_POOL_INTERVAL_FACTOR = 0.6;

function clamp01(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

function publishIntervalMs() {
  const configured = Number(process.env.PUBLISH_INTERVAL_MINUTES || DEFAULT_INTERVAL_MINUTES);
  const minutes = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_INTERVAL_MINUTES;
  return minutes * 60 * 1000;
}

function jitteredMs(ms) {
  const factor = 1 - JITTER_PCT + Math.random() * (2 * JITTER_PCT);
  return Math.round(ms * factor);
}

function isoAfterMinutes(fromDate, minutes, { jitter = false } = {}) {
  const ms = Math.max(0, minutes) * 60 * 1000;
  return new Date(fromDate.getTime() + (jitter ? jitteredMs(ms) : ms)).toISOString();
}

export function decayThreshold(current) {
  return Math.max(THRESHOLD_FLOOR, Number((current - THRESHOLD_DECAY_STEP).toFixed(2)));
}

/**
 * Pure scheduling decision, kept separate from the cycle side effects so it
 * can be unit tested without touching discovery or the network. Decides the
 * next publish time, a human-readable reason for it, the editorial threshold
 * for the next cycle, and how many catch-up-paced cycles remain.
 */
export function computeSchedule({
  now,
  previousNextPublishAt,
  hadNoPostsBefore,
  published,
  acceptedCount,
  currentThreshold,
  catchUpCreditsRemaining
}) {
  const baseIntervalMs = publishIntervalMs();
  const baseIntervalMinutes = Math.round(baseIntervalMs / 60000);
  const overdueMs = now.getTime() - new Date(previousNextPublishAt).getTime();
  const isGap = overdueMs > baseIntervalMs;

  let credits = catchUpCreditsRemaining || 0;
  const usingCatchUpPacing = isGap || credits > 0;

  if (isGap && credits <= 0) {
    credits = MAX_CATCHUP_CYCLES - 1;
    console.warn(
      `Resumed after a ${Math.round(overdueMs / 60000)}m host gap; ` +
        `pacing up to ${MAX_CATCHUP_CYCLES} catch-up cycles ${CATCHUP_STEP_MINUTES}m apart instead of backdating`
    );
  } else if (credits > 0) {
    // Consume one credit for this cycle; usingCatchUpPacing was already
    // captured above so the cycle that spends the last credit still uses
    // catch-up pacing instead of falling through to the normal cadence.
    credits -= 1;
  }

  if (!published) {
    const editorialThreshold = decayThreshold(currentThreshold);

    if (hadNoPostsBefore) {
      return {
        nextPublishAt: isoAfterMinutes(now, FIRST_POST_RETRY_MINUTES),
        nextPublishReason: `no post published yet; nothing cleared the bar, retrying in ${FIRST_POST_RETRY_MINUTES}m at a lower threshold`,
        editorialThreshold,
        catchUpCreditsRemaining: credits
      };
    }

    return {
      nextPublishAt: isoAfterMinutes(now, QUIET_CYCLE_RETRY_MINUTES),
      nextPublishReason: `nothing cleared the bar, retrying in ${QUIET_CYCLE_RETRY_MINUTES}m at a lower threshold`,
      editorialThreshold,
      catchUpCreditsRemaining: credits
    };
  }

  // Published — reset the threshold to base and pick a cadence.
  if (usingCatchUpPacing) {
    return {
      nextPublishAt: isoAfterMinutes(now, CATCHUP_STEP_MINUTES),
      nextPublishReason: `catching up after a host gap, publishing again in ${CATCHUP_STEP_MINUTES}m`,
      editorialThreshold: DEFAULT_EDITORIAL_THRESHOLD,
      catchUpCreditsRemaining: credits
    };
  }

  if (acceptedCount >= STRONG_POOL_SIZE) {
    const minutes = Math.round(baseIntervalMinutes * STRONG_POOL_INTERVAL_FACTOR);
    return {
      nextPublishAt: isoAfterMinutes(now, minutes, { jitter: true }),
      nextPublishReason: `${acceptedCount} strong candidates queued, publishing again in ${minutes}m`,
      editorialThreshold: DEFAULT_EDITORIAL_THRESHOLD,
      catchUpCreditsRemaining: 0
    };
  }

  return {
    nextPublishAt: isoAfterMinutes(now, baseIntervalMinutes, { jitter: true }),
    nextPublishReason:
      acceptedCount <= 1
        ? `quiet news cycle, backing off to ${baseIntervalMinutes}m`
        : `publishing again in ${baseIntervalMinutes}m`,
    editorialThreshold: DEFAULT_EDITORIAL_THRESHOLD,
    catchUpCreditsRemaining: 0
  };
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
    memory: { themes: {}, entities: {} },
    cycles: [],
    nextPublishAt: createdAt,
    nextPublishReason: "initial cycle scheduled immediately after initialization",
    editorialThreshold: DEFAULT_EDITORIAL_THRESHOLD,
    catchUpCreditsRemaining: 0
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

export async function runPublishingCycle(agentState, topics, now = new Date()) {
  const hadNoPostsBefore = agentState.posts.length === 0;
  const previousNextPublishAt = agentState.nextPublishAt;
  const threshold = agentState.editorialThreshold ?? DEFAULT_EDITORIAL_THRESHOLD;

  const evaluation = await evaluateTopicsWithLLM(topics, agentState, now, threshold);

  recordSeenTopics(agentState, topics, now);
  agentState.rejectedTopics.push(...evaluation.rejected);
  agentState.rejectedTopics = agentState.rejectedTopics.slice(-PRUNE_LIMITS.rejectedTopics);

  const cycle = {
    id: createId("cycle"),
    ranAt: now.toISOString(),
    candidatesDiscovered: topics.length,
    rejectedCount: evaluation.rejected.length,
    acceptedCount: evaluation.acceptedCount,
    editorialThreshold: threshold,
    decidedBy: evaluation.decidedBy || "heuristic-fallback",
    model: evaluation.model || "heuristic",
    tokensUsed: evaluation.tokensUsed || 0,
    publishedPostId: null,
    status: "no_publishable_topic"
  };

  if (evaluation.selected) {
    evaluation.selected.memoryHints = buildMemoryHints(agentState, evaluation.selected.topic);
    const post = await writePostWithLLM(evaluation.selected, agentState, now, evaluation.rejected, {
      cycleId: cycle.id,
      candidatesEvaluated: topics.length,
      sourcesQueried: [...new Set(topics.map((topic) => topic.sourceName).filter(Boolean))]
    });
    updateMemoryWithPost(agentState, post);
    agentState.posts.unshift(post);
    cycle.publishedPostId = post.id;
    cycle.decidedBy = post.decidedBy;
    cycle.model = post.model;
    cycle.tokensUsed = post.tokensUsed || cycle.tokensUsed;
    cycle.status = "published";
  }

  const schedule = computeSchedule({
    now,
    previousNextPublishAt,
    hadNoPostsBefore,
    published: cycle.status === "published",
    acceptedCount: evaluation.acceptedCount,
    currentThreshold: threshold,
    catchUpCreditsRemaining: agentState.catchUpCreditsRemaining || 0
  });

  agentState.nextPublishAt = schedule.nextPublishAt;
  agentState.nextPublishReason = schedule.nextPublishReason;
  agentState.editorialThreshold = schedule.editorialThreshold;
  agentState.catchUpCreditsRemaining = schedule.catchUpCreditsRemaining;
  cycle.nextPublishReason = schedule.nextPublishReason;

  agentState.cycles.unshift(cycle);
  agentState.cycles = agentState.cycles.slice(0, PRUNE_LIMITS.cycles);

  return cycle;
}

async function runSingleDueCycle(agentState, now = new Date()) {
  const topics = await discoverTopics(agentState.agent.persona);
  return runPublishingCycle(agentState, topics, now);
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

  let nextPublishAt = null;
  let nextPublishReason = null;
  for (const id of ids) {
    const candidate = store.agents[id].nextPublishAt;
    if (!candidate) continue;
    if (!nextPublishAt || new Date(candidate) < new Date(nextPublishAt)) {
      nextPublishAt = candidate;
      nextPublishReason = store.agents[id].nextPublishReason || null;
    }
  }

  return {
    ok: true,
    uptimeSeconds: Math.floor(process.uptime()),
    agents: ids.length,
    posts: totalPosts,
    lastCycleAt,
    nextPublishAt,
    nextPublishReason
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
