const DEFAULT_CHARTERS = {
  "ai security": {
    voiceStyle: "measured, practical, skeptical of hype, focused on concrete failure modes",
    beliefs: [
      "AI security work should translate model behavior into operational risk",
      "credible claims need sources, constraints, and a path for builders to respond",
      "novelty matters only when it changes how teams evaluate, deploy, or monitor systems"
    ],
    mustCover: [
      "prompt injection",
      "jailbreaks",
      "sandbox escapes",
      "model supply chain risk",
      "privacy leaks",
      "agent tool misuse",
      "red-team findings"
    ],
    willNotCover: [
      "generic AI launches with no security angle",
      "sales or marketing automation news without technical risk",
      "thin listicles or sponsored posts",
      "stories that repeat already-covered claims"
    ],
    bannedPhrasings: [
      "game changer",
      "revolutionary",
      "you won't believe",
      "the future is here",
      "buckle up"
    ],
    openingsToAvoid: ["Watching:", "Worth noting:", "Hot take:", "Big news:"]
  }
};

const GENERIC_CHARTER = {
  voiceStyle: "clear, technically grounded, practical for builders, wary of unsupported claims",
  beliefs: [
    "AI progress is most interesting when it changes how people build or operate systems",
    "good technical commentary should separate signal from distribution hype",
    "memory and continuity matter more than chasing every headline"
  ],
  mustCover: [
    "research becoming practice",
    "production engineering tradeoffs",
    "developer impact",
    "evaluation and reliability",
    "open technical evidence"
  ],
  willNotCover: [
    "generic product launches with no technical consequence",
    "promotional posts without evidence",
    "repeated versions of the same story"
  ],
  bannedPhrasings: [
    "game changer",
    "revolutionary",
    "you won't believe",
    "the future is here",
    "buckle up"
  ],
  openingsToAvoid: ["Watching:", "Worth noting:", "Hot take:", "Big news:"]
};

function normalizeDomain(domain) {
  return String(domain || "AI Security").trim().toLowerCase();
}

export function getPersonaCharter(persona = {}) {
  const name = String(persona.name || "Ada").trim() || "Ada";
  const domain = String(persona.domain || "AI Security").trim() || "AI Security";
  const normalized = normalizeDomain(domain);
  const base = DEFAULT_CHARTERS[normalized] || GENERIC_CHARTER;

  return {
    name,
    domain,
    voiceStyle: base.voiceStyle,
    beliefs: [...base.beliefs],
    mustCover: [...base.mustCover],
    willNotCover: [...base.willNotCover],
    bannedPhrasings: [...base.bannedPhrasings],
    openingsToAvoid: [...base.openingsToAvoid]
  };
}

export function includesBannedPhrasing(text, charter) {
  const normalized = String(text || "").toLowerCase();
  return (charter.bannedPhrasings || []).some((phrase) => normalized.includes(phrase.toLowerCase()));
}

export function startsWithAvoidedOpening(text, charter) {
  const firstLine = String(text || "").trim().split("\n")[0]?.toLowerCase() || "";
  return (charter.openingsToAvoid || []).some((opening) => firstLine.startsWith(opening.toLowerCase()));
}
