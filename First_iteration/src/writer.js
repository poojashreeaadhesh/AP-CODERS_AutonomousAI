import { createId } from "./utils.js";

function personaAngle(domain) {
  const normalized = String(domain || "").toLowerCase();

  if (normalized.includes("security")) {
    return "I care less about the headline claim and more about the failure mode it exposes.";
  }
  if (normalized.includes("ethic") || normalized.includes("policy")) {
    return "The governance question is whether the people affected by this system can understand and contest it.";
  }
  if (normalized.includes("robot")) {
    return "The useful signal is where model capability survives contact with the physical world.";
  }
  if (normalized.includes("developer") || normalized.includes("open source")) {
    return "The practical test is whether builders can inspect it, adapt it, and recover when it breaks.";
  }
  if (normalized.includes("machine learning")) {
    return "The interesting part is the engineering tradeoff, not the benchmark headline.";
  }

  return "The question I keep coming back to is what changes for builders when this becomes ordinary infrastructure.";
}

function continuityLine(state) {
  if (state.posts.length === 0) {
    return "First note in this feed:";
  }

  const last = state.posts[0];
  const short = last.text.split("\n")[0].replace(/^Watching:\s*/i, "");
  return `Continuing the thread from "${short.slice(0, 72)}":`;
}

export function writePost(selected, state, createdAt = new Date(), rejected = []) {
  const { topic, reasons } = selected;
  const persona = state.agent.persona;
  const title = topic.title.replace(/\s+/g, " ").trim();
  const sourceName = topic.sourceName || "a live source";
  const angle = personaAngle(persona.domain);
  const firstLine = state.posts.length % 3 === 0 ? "Watching:" : "Worth noting:";

  const text = [
    `${firstLine} ${title}`,
    "",
    `${continuityLine(state)} ${sourceName} is a useful signal for ${persona.domain} because it points to a concrete shift, not just another broad AI claim.`,
    "",
    `${angle} My read: teams should treat this as a prompt to tighten evaluation, deployment assumptions, and user-facing explanations before the story becomes conventional wisdom.`,
    "",
    `- ${persona.name}`
  ].join("\n");

  const rejectedExamples = rejected
    .slice(0, 2)
    .map((item) => `"${item.title}" (${item.reason})`)
    .join("; ");

  const rationaleParts = [
    `Selected because ${reasons.slice(0, 3).join(", ")}.`,
    `Relevant now because the source item was published or surfaced recently from ${sourceName}.`,
    `Chosen over other candidates because it cleared the editorial threshold for novelty, persona fit, and substance.`
  ];

  if (rejectedExamples) {
    rationaleParts.push(`Rejected candidates included ${rejectedExamples}.`);
  }

  const rationale = rationaleParts.join(" ");

  return {
    id: createId("p"),
    createdAt: createdAt.toISOString(),
    text,
    rationale,
    sources: [topic.url]
  };
}
