import { displayTitleFromPost } from "./memory.js";
import { hoursBetween, normalizeText, similarity, titleFingerprint } from "./utils.js";
import { callClaudeJson, getLlmModel, isLlmEnabled } from "./llm.js";
import { getPersonaCharter } from "./persona.js";
import { editorialDecisionPrompt } from "./prompts.js";

const TECH_KEYWORDS = [
  "ai",
  "artificial intelligence",
  "llm",
  "model",
  "machine learning",
  "agent",
  "robot",
  "security",
  "open source",
  "developer",
  "data",
  "inference",
  "chip",
  "cloud",
  "software",
  "research",
  "policy"
];

const WEAK_PATTERNS = [
  "top 10",
  "ultimate guide",
  "you won't believe",
  "make money",
  "crypto giveaway",
  "coupon",
  "sponsored"
];

const BEAT_KEYWORDS = {
  security: [
    "security",
    "vulnerability",
    "exploit",
    "attack",
    "prompt injection",
    "jailbreak",
    "sandbox",
    "red team",
    "privacy",
    "leak",
    "supply chain",
    "auth",
    "malware",
    "risk"
  ],
  robotics: ["robot", "robotics", "embodied", "sensor", "actuator", "navigation", "manipulation"],
  ethics: ["ethics", "governance", "policy", "bias", "transparency", "accountability", "rights"],
  developer: ["developer", "sdk", "api", "open source", "tooling", "framework", "library"],
  "machine learning": ["training", "inference", "benchmark", "dataset", "model", "gradient", "evaluation"]
};

function domainTerms(domain) {
  return normalizeText(domain).split(" ").filter(Boolean);
}

function beatTerms(domain) {
  const normalized = normalizeText(domain);
  const matched = Object.entries(BEAT_KEYWORDS).find(([key]) => normalized.includes(key));
  return matched ? matched[1] : domainTerms(domain);
}

function scoreTopic(topic, state, now = new Date()) {
  const title = normalizeText(topic.title);
  const summary = normalizeText(topic.summary);
  const combined = `${title} ${summary}`;
  const personaTerms = domainTerms(state.agent.persona.domain);
  const specificBeatTerms = beatTerms(state.agent.persona.domain);
  const previousTitles = state.posts.map((post) => displayTitleFromPost(post)).filter(Boolean);
  const previousFingerprints = new Set(
    state.posts
      .map((post) => post.titleFingerprint || titleFingerprint(displayTitleFromPost(post)))
      .filter(Boolean)
  );

  let score = 0;
  const reasons = [];
  const rejectionReasons = [];

  const hasTechSignal = TECH_KEYWORDS.some((keyword) => combined.includes(keyword));
  if (hasTechSignal) {
    score += 2;
    reasons.push("it is clearly within AI or technology");
  } else {
    rejectionReasons.push("it does not have a strong AI or technology signal");
  }

  const personaMatches = personaTerms.filter((term) => combined.includes(term)).length;
  const beatMatches = specificBeatTerms.filter((term) => combined.includes(term)).length;
  if (personaMatches > 0) {
    score += Math.min(3, personaMatches * 1.5);
    reasons.push(`it matches the persona's ${state.agent.persona.domain} focus`);
  } else {
    score -= 1;
    rejectionReasons.push(`it is not close enough to the ${state.agent.persona.domain} beat`);
  }

  if (beatMatches > 0) {
    score += Math.min(2.5, beatMatches * 1.25);
    reasons.push("it contains specific beat-level signals rather than generic AI relevance");
  } else if (personaTerms.length > 1) {
    score -= 4.5;
    rejectionReasons.push(`it mentions AI or technology but lacks the specific ${state.agent.persona.domain} angle`);
  }

  const ageHours = hoursBetween(topic.publishedAt, now);
  if (ageHours <= 24) {
    score += 2;
    reasons.push("it is fresh within the last 24 hours");
  } else if (ageHours <= 96) {
    score += 1;
    reasons.push("it is still recent enough to be timely");
  } else {
    score -= 2;
    rejectionReasons.push("it is too old for a live feed");
  }

  const points = topic.signals?.points || 0;
  const comments = topic.signals?.comments || 0;
  if (points + comments >= 20) {
    score += 1.5;
    reasons.push("it shows meaningful community attention");
  } else if (topic.sourceName === "arXiv") {
    score += 1;
    reasons.push("it is primary research rather than engagement bait");
  } else {
    rejectionReasons.push("it has limited evidence of external importance");
  }

  const publishedUrls = new Set(state.posts.flatMap((post) => post.sources || []));
  if (publishedUrls.has(topic.url)) {
    score -= 5;
    rejectionReasons.push("it has already been published");
  } else if (state.seenTopics.some((item) => item.url === topic.url)) {
    score -= 1;
    rejectionReasons.push("it was considered in an earlier discovery cycle");
  }

  const topicFingerprint = titleFingerprint(topic.title);
  const repeated =
    previousFingerprints.has(topicFingerprint) ||
    previousTitles.some((title) => similarity(topic.title, title) > 0.45);
  if (repeated) {
    score -= 8;
    rejectionReasons.push("it appears to rehash information already covered in memory");
  } else {
    score += 1;
    reasons.push("it adds a new angle to the feed memory");
  }

  if (WEAK_PATTERNS.some((pattern) => combined.includes(pattern))) {
    score -= 4;
    rejectionReasons.push("it reads like low-signal promotional content");
  }

  if (topic.title.length < 18) {
    score -= 1;
    rejectionReasons.push("the topic is too thinly described");
  }

  return {
    topic,
    score,
    reasons,
    rejectionReasons
  };
}

export const DEFAULT_EDITORIAL_THRESHOLD = 4.5;

export function evaluateTopics(topics, state, now = new Date(), threshold = DEFAULT_EDITORIAL_THRESHOLD) {
  const scored = topics.map((topic) => scoreTopic(topic, state, now));
  const accepted = scored
    .filter((item) => item.score >= threshold)
    .sort((a, b) => b.score - a.score);

  const rejected = scored
    .filter((item) => item.score < threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((item) => ({
      title: item.topic.title,
      url: item.topic.url,
      score: Number(item.score.toFixed(2)),
      rejectedAt: now.toISOString(),
      reason: item.rejectionReasons[0] || "it did not clear the editorial threshold"
    }));

  return {
    selected: accepted[0] || null,
    rejected,
    scored,
    acceptedCount: accepted.length,
    threshold,
    decidedBy: "heuristic-fallback",
    model: "heuristic",
    tokensUsed: 0
  };
}

function candidateId(index) {
  return `c${index + 1}`;
}

function topCandidates(scored) {
  return [...scored]
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((item, index) => ({ ...item, id: candidateId(index) }));
}

function validateEditorialJson(value) {
  if (!value || typeof value !== "object") throw new Error("response must be an object");
  if (!(value.selected === null || typeof value.selected === "string")) {
    throw new Error("selected must be a candidate id or null");
  }
  if (!Number.isFinite(Number(value.editorialScore))) {
    throw new Error("editorialScore must be a number");
  }
  for (const key of ["whySelected", "whyNow"]) {
    if (typeof value[key] !== "string" || value[key].trim().length < 8) {
      throw new Error(`${key} must be a useful string`);
    }
  }
  if (!Array.isArray(value.whyOverOthers)) throw new Error("whyOverOthers must be an array");
  if (!Array.isArray(value.rejections)) throw new Error("rejections must be an array");
}

function llmRejections({ decision, candidates, now, fallbackRejected }) {
  const byId = new Map(candidates.map((item) => [item.id, item]));
  const seenUrls = new Set();
  const rejected = [];

  for (const item of decision.rejections || []) {
    const candidate = byId.get(item.id);
    if (!candidate || seenUrls.has(candidate.topic.url)) continue;
    seenUrls.add(candidate.topic.url);
    rejected.push({
      title: candidate.topic.title,
      url: candidate.topic.url,
      score: Number(candidate.score.toFixed(2)),
      rejectedAt: now.toISOString(),
      reason: String(item.reason || "Claude rejected this candidate as lower priority").slice(0, 300)
    });
  }

  for (const item of fallbackRejected) {
    if (seenUrls.has(item.url)) continue;
    rejected.push(item);
  }

  return rejected.slice(0, 10);
}

function annotateFallback(result) {
  if (!result.selected) return result;
  return {
    ...result,
    selected: {
      ...result.selected,
      editorialScore: Number(result.selected.score.toFixed(2)),
      whySelected: result.selected.reasons[0] || "it cleared the heuristic editorial bar",
      whyNow: "it was surfaced by a live source during this publishing cycle",
      whyOverOthers: [],
      decidedBy: "heuristic-fallback",
      model: "heuristic",
      tokensUsed: 0
    }
  };
}

function enrichWhyOverOthers(items, candidatesById) {
  return (items || [])
    .map((item) => {
      const candidate = candidatesById.get(item.id);
      if (!candidate) return null;
      return {
        id: item.id,
        title: candidate.topic.title,
        url: candidate.topic.url,
        score: Number(candidate.score.toFixed(2)),
        reason: String(item.reason || "lower editorial priority").slice(0, 300)
      };
    })
    .filter(Boolean);
}

export async function evaluateTopicsWithLLM(
  topics,
  state,
  now = new Date(),
  threshold = DEFAULT_EDITORIAL_THRESHOLD
) {
  const fallback = annotateFallback(evaluateTopics(topics, state, now, threshold));

  if (!isLlmEnabled() || topics.length === 0) {
    return fallback;
  }

  const candidates = topCandidates(fallback.scored);
  const candidatesById = new Map(candidates.map((item) => [item.id, item]));
  const charter = getPersonaCharter(state.agent?.persona);

  try {
    const { value: decision, model, tokensUsed } = await callClaudeJson({
      prompt: editorialDecisionPrompt({ charter, candidates, state }),
      validate: (value) => {
        validateEditorialJson(value);
        if (value.selected !== null && !candidatesById.has(value.selected)) {
          throw new Error("selected must match one of the supplied candidate ids");
        }
      }
    });

    const rejected = llmRejections({
      decision,
      candidates,
      now,
      fallbackRejected: fallback.rejected
    });

    if (decision.selected === null) {
      return {
        ...fallback,
        selected: null,
        rejected,
        acceptedCount: 0,
        decidedBy: "llm",
        model,
        tokensUsed,
        llmDecision: decision
      };
    }

    const selected = candidatesById.get(decision.selected);
    return {
      ...fallback,
      selected: {
        ...selected,
        editorialScore: Number(Number(decision.editorialScore).toFixed(2)),
        whySelected: decision.whySelected.trim(),
        whyNow: decision.whyNow.trim(),
        whyOverOthers: enrichWhyOverOthers(decision.whyOverOthers, candidatesById),
        decidedBy: "llm",
        model,
        tokensUsed
      },
      rejected,
      decidedBy: "llm",
      model,
      tokensUsed,
      llmDecision: decision
    };
  } catch (error) {
    console.warn(`LLM editorial fallback: ${error.message}`);
    return {
      ...fallback,
      model: getLlmModel(),
      llmError: "editorial_fallback"
    };
  }
}
