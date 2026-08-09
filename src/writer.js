import { createId } from "./utils.js";
import { callClaudeJson, getLlmModel, isLlmEnabled } from "./llm.js";
import { buildMemoryHints, memoryPostFields } from "./memory.js";
import { getPersonaCharter, includesBannedPhrasing, startsWithAvoidedOpening } from "./persona.js";
import { writerPrompt } from "./prompts.js";

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

function continuityLine(state, memoryHints) {
  const related = memoryHints?.relatedPosts?.[0];
  if (related) {
    return `This connects to prior coverage of "${related.title}":`;
  }

  if (state.posts.length === 0) {
    return "First note in this feed:";
  }

  return "New thread in this feed:";
}

function contextRationaleNotes(context = {}) {
  const notes = [];

  if (context.reserveFallback) {
    notes.push("Live sources were unreachable, so this came from the reserve candidate pool.");
  }

  if (context.sourceDiversityNote) {
    notes.push(context.sourceDiversityNote);
  }

  return notes;
}

export function writePost(selected, state, createdAt = new Date(), rejected = [], context = {}) {
  const { topic, reasons } = selected;
  const persona = state.agent.persona;
  const title = topic.title.replace(/\s+/g, " ").trim();
  const sourceName = topic.sourceName || "a live source";
  const angle = personaAngle(persona.domain);
  const openings = ["Signal from this cycle:", "The useful clue:", "This deserves scrutiny:"];
  const firstLine = openings[state.posts.length % openings.length];
  const memoryHints = selected.memoryHints || buildMemoryHints(state, topic);

  const text = [
    `${firstLine} ${title}`,
    "",
    `${continuityLine(state, memoryHints)} ${sourceName} is a useful signal for ${persona.domain} because it points to a concrete shift, not just another broad AI claim.`,
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

  rationaleParts.push(...contextRationaleNotes(context));

  const rationale = rationaleParts.join(" ");

  const post = {
    id: createId("p"),
    createdAt: createdAt.toISOString(),
    text,
    rationale,
    sources: [topic.url],
    sourceName: topic.sourceName || null,
    sourceId: topic.sourceId || null,
    decidedBy: selected.decidedBy || "heuristic-fallback",
    model: selected.model || "heuristic-template",
    tokensUsed: selected.tokensUsed || 0,
    editorialScore: Number(Number(selected.editorialScore ?? selected.score ?? 0).toFixed(2))
  };

  return {
    ...post,
    ...memoryPostFields({
      selected: { ...selected, memoryHints },
      state,
      post,
      context,
      rejected
    })
  };
}

function validateWriterJson(value, charter) {
  if (!value || typeof value !== "object") throw new Error("response must be an object");
  if (typeof value.text !== "string" || value.text.trim().split(/\s+/).length < 50) {
    throw new Error("text must be at least 50 words");
  }
  if (value.text.trim().split(/\s+/).length > 230) {
    throw new Error("text must stay under 230 words");
  }
  if (typeof value.rationale !== "string" || value.rationale.trim().length < 40) {
    throw new Error("rationale must be a useful string");
  }
  if (/#\w+/.test(value.text)) throw new Error("text must not contain hashtags");
  if (includesBannedPhrasing(value.text, charter)) throw new Error("text contains banned phrasing");
  if (startsWithAvoidedOpening(value.text, charter)) throw new Error("text reuses an avoided opening");
}

export async function writePostWithLLM(selected, state, createdAt = new Date(), rejected = [], context = {}) {
  const memoryHints = selected.memoryHints || buildMemoryHints(state, selected.topic);
  const selectedWithMemory = { ...selected, memoryHints };
  const fallback = writePost(selectedWithMemory, state, createdAt, rejected, context);
  if (!isLlmEnabled()) {
    return {
      ...fallback,
      decidedBy: "heuristic-fallback",
      model: "heuristic-template",
      tokensUsed: selectedWithMemory.tokensUsed || 0
    };
  }

  const charter = getPersonaCharter(state.agent?.persona);

  try {
    const { value, model, tokensUsed } = await callClaudeJson({
      prompt: writerPrompt({ charter, selected: selectedWithMemory, state, rejected }),
      validate: (candidate) => validateWriterJson(candidate, charter),
      maxTokens: 1600
    });

    const post = {
      id: createId("p"),
      createdAt: createdAt.toISOString(),
      text: value.text.trim(),
      rationale: [value.rationale.trim(), ...contextRationaleNotes(context)].join(" "),
      sources: [selectedWithMemory.topic.url],
      sourceName: selectedWithMemory.topic.sourceName || null,
      sourceId: selectedWithMemory.topic.sourceId || null,
      decidedBy: selectedWithMemory.decidedBy === "llm" ? "llm" : "heuristic-fallback",
      writerBy: "llm",
      model,
      tokensUsed: (selectedWithMemory.tokensUsed || 0) + tokensUsed,
      editorialScore: Number(Number(selectedWithMemory.editorialScore ?? selectedWithMemory.score ?? 0).toFixed(2))
    };

    return {
      ...post,
      ...memoryPostFields({
        selected: selectedWithMemory,
        state,
        post,
        writerThemes: Array.isArray(value.themes) ? value.themes.slice(0, 8) : [],
        writerEntities: Array.isArray(value.entities) ? value.entities.slice(0, 8) : [],
        context,
        rejected
      })
    };
  } catch (error) {
    console.warn(`LLM writer fallback: ${error.message}`);
    return {
      ...fallback,
      decidedBy: selectedWithMemory.decidedBy || "heuristic-fallback",
      writerBy: "heuristic-fallback",
      model: selectedWithMemory.model || getLlmModel(),
      tokensUsed: selectedWithMemory.tokensUsed || 0
    };
  }
}
