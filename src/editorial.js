import { hoursBetween, normalizeText, similarity } from "./utils.js";

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
  const previousTexts = state.posts.map((post) => `${post.text} ${post.rationale}`);

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

  const repeated = previousTexts.some((text) => similarity(topic.title, text) > 0.32);
  if (repeated) {
    score -= 4;
    rejectionReasons.push("it is too similar to earlier published content");
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
    threshold
  };
}
