import { normalizeText, titleFingerprint } from "./utils.js";

const THEME_PHRASES = [
  "prompt injection",
  "sandbox",
  "sandbox escape",
  "jailbreak",
  "red team",
  "supply chain",
  "privacy leak",
  "agent tool",
  "model evaluation",
  "inference",
  "open source",
  "governance",
  "robotics"
];

const ENTITY_WORDS = new Set([
  "AI",
  "LLM",
  "Kimi",
  "K3",
  "OpenAI",
  "Anthropic",
  "Claude",
  "Google",
  "DeepMind",
  "Meta",
  "Microsoft",
  "GitHub",
  "NVIDIA",
  "arXiv"
]);

function ensureMemory(state) {
  if (!state.memory || typeof state.memory !== "object") {
    state.memory = { themes: {}, entities: {} };
  }
  state.memory.themes ||= {};
  state.memory.entities ||= {};
  return state.memory;
}

export function normalizeMemoryKey(value) {
  return normalizeText(value).replace(/\s+/g, "-");
}

export function displayTitleFromPost(post) {
  if (post.sourceTitle) return post.sourceTitle;
  return String(post.text || "")
    .split("\n")[0]
    .replace(/^(Watching|Worth noting|Signal from this cycle|The useful clue|This deserves scrutiny):\s*/i, "")
    .trim();
}

function titleFromTopic(topic) {
  return String(topic?.title || "").replace(/\s+/g, " ").trim();
}

function extractThemeHints(topic) {
  const combined = normalizeText(`${topic?.title || ""} ${topic?.summary || ""}`);
  const themes = [];

  for (const phrase of THEME_PHRASES) {
    if (combined.includes(phrase)) themes.push(normalizeMemoryKey(phrase));
  }

  if (combined.includes("security") || combined.includes("vulnerability") || combined.includes("exploit")) {
    themes.push("ai-security");
  }

  return [...new Set(themes)].slice(0, 6);
}

function extractEntityHints(topic) {
  const raw = `${topic?.title || ""} ${topic?.summary || ""}`;
  const entities = [];

  for (const word of ENTITY_WORDS) {
    const pattern = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (pattern.test(raw)) entities.push(word);
  }

  const modelMatches = raw.match(/\b[A-Z][a-zA-Z]+(?:\s+[A-Z0-9][a-zA-Z0-9-]*){0,2}\s+(?:K\d+|GPT-\d+(?:\.\d+)?|Sonnet|Opus)\b/g) || [];
  entities.push(...modelMatches);

  return [...new Set(entities)].slice(0, 6);
}

export function deriveTopicMemory(topic) {
  return {
    titleFingerprint: titleFingerprint(titleFromTopic(topic)),
    themes: extractThemeHints(topic),
    entities: extractEntityHints(topic)
  };
}

function normalizedList(values) {
  return [
    ...new Set(
      (values || [])
        .map((value) => normalizeMemoryKey(value))
        .filter((value) => value.length > 1)
    )
  ];
}

function relatedIdsFromIndex(index, keys) {
  const ids = new Set();
  for (const key of keys) {
    for (const id of index[key]?.postIds || []) {
      ids.add(id);
    }
  }
  return ids;
}

export function findRelatedPosts(state, { themes = [], entities = [] } = {}, limit = 5) {
  const memory = ensureMemory(state);
  const themeKeys = normalizedList(themes);
  const entityKeys = normalizedList(entities);
  const ids = new Set([
    ...relatedIdsFromIndex(memory.themes, themeKeys),
    ...relatedIdsFromIndex(memory.entities, entityKeys)
  ]);

  return state.posts
    .filter((post) => ids.has(post.id))
    .slice(0, limit)
    .map((post) => ({
      id: post.id,
      createdAt: post.createdAt,
      title: displayTitleFromPost(post),
      themes: post.themes || [],
      entities: post.entities || []
    }));
}

export function buildMemoryHints(state, topic) {
  const derived = deriveTopicMemory(topic);
  const relatedPosts = findRelatedPosts(state, derived);
  return {
    ...derived,
    relatedPostIds: relatedPosts.map((post) => post.id),
    relatedPosts
  };
}

function upsertMemoryEntry(bucket, key, kind, postId, nowIso) {
  if (!key) return;
  const entry = bucket[key] || {
    kind,
    count: 0,
    firstSeenAt: nowIso,
    lastSeenAt: nowIso,
    postIds: []
  };

  entry.count += 1;
  entry.lastSeenAt = nowIso;
  if (!entry.postIds.includes(postId)) entry.postIds.push(postId);
  bucket[key] = entry;
}

export function updateMemoryWithPost(state, post) {
  const memory = ensureMemory(state);
  const themes = normalizedList(post.themes);
  const entities = normalizedList(post.entities);
  const nowIso = post.createdAt || new Date().toISOString();

  post.themes = themes;
  post.entities = entities;
  post.relatedPostIds = post.relatedPostIds || [];

  for (const theme of themes) {
    upsertMemoryEntry(memory.themes, theme, "theme", post.id, nowIso);
  }
  for (const entity of entities) {
    upsertMemoryEntry(memory.entities, entity, "entity", post.id, nowIso);
  }

  return memory;
}

export function buildRationaleDetail({ selected, rejected, context, relatedPostIds }) {
  const whyOverOthers = (selected.whyOverOthers || [])
    .map((item) => ({
      title: item.title || item.id || "evaluated candidate",
      reason: item.reason || "lower editorial priority",
      score: Number.isFinite(Number(item.score)) ? Number(Number(item.score).toFixed(2)) : undefined
    }))
    .slice(0, 5);

  if (whyOverOthers.length === 0) {
    for (const item of rejected.slice(0, 3)) {
      whyOverOthers.push({
        title: item.title,
        reason: item.reason,
        score: item.score
      });
    }
  }

  return {
    whySelected: selected.whySelected || selected.reasons?.[0] || "it cleared the editorial bar",
    whyNow: selected.whyNow || "it was surfaced by a live source during this publishing cycle",
    whyOverOthers,
    candidatesEvaluated: context.candidatesEvaluated || 0,
    sourcesQueried: context.sourcesQueried || [],
    editorialScore: Number(Number(selected.editorialScore ?? selected.score ?? 0).toFixed(2)),
    decidedBy: selected.decidedBy || "heuristic-fallback",
    cycleId: context.cycleId || null,
    relatedPostIds: relatedPostIds || []
  };
}

export function memoryPostFields({ selected, state, post, writerThemes = [], writerEntities = [], context = {}, rejected = [] }) {
  const hints = selected.memoryHints || buildMemoryHints(state, selected.topic);
  const themes = normalizedList([...hints.themes, ...writerThemes]);
  const entities = normalizedList([...hints.entities, ...writerEntities]);
  const relatedPosts = findRelatedPosts(state, { themes, entities });
  const relatedPostIds = [...new Set([...hints.relatedPostIds, ...relatedPosts.map((item) => item.id)])];

  return {
    sourceTitle: titleFromTopic(selected.topic),
    titleFingerprint: hints.titleFingerprint || titleFingerprint(titleFromTopic(selected.topic)),
    themes,
    entities,
    relatedPostIds,
    rationaleDetail: buildRationaleDetail({
      selected,
      rejected,
      context,
      relatedPostIds
    }),
    continuityLead:
      relatedPosts[0]?.title ||
      (post ? displayTitleFromPost(post) : null)
  };
}
