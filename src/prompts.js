function compactTopic(candidate) {
  const topic = candidate.topic;
  return {
    id: candidate.id,
    title: topic.title,
    url: topic.url,
    sourceName: topic.sourceName,
    publishedAt: topic.publishedAt,
    summary: topic.summary || "",
    heuristicScore: Number(candidate.score.toFixed(2)),
    heuristicReasons: candidate.reasons,
    heuristicRejectionReasons: candidate.rejectionReasons,
    signals: topic.signals || {}
  };
}

function recentTitles(state) {
  return state.posts.slice(0, 10).map((post) => ({
    id: post.id,
    title: (post.sourceTitle || post.text.split("\n")[0])
      .replace(/^(Watching|Worth noting|Signal from this cycle|The useful clue|This deserves scrutiny):\s*/i, "")
      .slice(0, 160),
    opening: post.text.split(/\s+/).slice(0, 12).join(" ")
  }));
}

function relatedPriorPosts(selected) {
  return (selected.memoryHints?.relatedPosts || []).map((post) => ({
    id: post.id,
    createdAt: post.createdAt,
    title: post.title,
    themes: post.themes || [],
    entities: post.entities || []
  }));
}

export function editorialDecisionPrompt({ charter, candidates, state }) {
  return [
    "You are the editorial brain for an autonomous AI and technology persona.",
    "Decide whether any candidate is worth publishing now. Intentional rejection is valid.",
    "",
    "Persona charter:",
    JSON.stringify(charter, null, 2),
    "",
    "Recent published titles to avoid repeating:",
    JSON.stringify(recentTitles(state), null, 2),
    "",
    "Candidates from the heuristic prefilter:",
    JSON.stringify(candidates.map(compactTopic), null, 2),
    "",
    "Return only strict JSON with this shape:",
    JSON.stringify(
      {
        selected: "candidate id or null",
        editorialScore: "number from 0 to 10",
        whySelected: "specific reason, or why none cleared the bar",
        whyNow: "specific freshness/timeliness reason",
        whyOverOthers: [{ id: "candidate id", reason: "why this was weaker" }],
        rejections: [{ id: "candidate id", reason: "specific editorial rejection reason" }]
      },
      null,
      2
    ),
    "",
    "Rules:",
    "- Select null if the best item is generic, repetitive, promotional, stale, or off-persona.",
    "- Do not select a candidate just because it mentions AI.",
    "- Prefer concrete failure modes, primary evidence, and operational consequences.",
    "- Keep reasons concise and useful to a judge reading the feed."
  ].join("\n");
}

export function writerPrompt({ charter, selected, state, rejected }) {
  const topic = selected.topic;
  return [
    "Write one feed post for an autonomous AI and technology persona.",
    "",
    "Persona charter:",
    JSON.stringify(charter, null, 2),
    "",
    "Selected topic:",
    JSON.stringify(
      {
        title: topic.title,
        url: topic.url,
        sourceName: topic.sourceName,
        publishedAt: topic.publishedAt,
        summary: topic.summary || "",
        signals: topic.signals || {},
        editorialScore: selected.editorialScore,
        whySelected: selected.whySelected,
        whyNow: selected.whyNow
      },
      null,
      2
    ),
    "",
    "Recent posts to avoid structurally repeating:",
    JSON.stringify(recentTitles(state), null, 2),
    "",
    "Related prior posts, if any. Reference these only when genuinely connected:",
    JSON.stringify(relatedPriorPosts(selected), null, 2),
    "",
    "Rejected candidates from this cycle:",
    JSON.stringify(
      rejected.slice(0, 6).map((item) => ({
        title: item.title,
        reason: item.reason,
        score: item.score
      })),
      null,
      2
    ),
    "",
    "Return only strict JSON with this shape:",
    JSON.stringify(
      {
        text: "80-200 words, no hashtags, no banned phrasing, varied opening, signed with the persona name",
        rationale: "2-4 sentences explaining why selected, why now, why over rejected candidates, and the source basis",
        themes: ["short normalized theme"],
        entities: ["company, model, framework, paper, or product names when relevant"]
      },
      null,
      2
    ),
    "",
    "Writing rules:",
    "- Do not use hashtags.",
    "- Do not use a LinkedIn hype cadence.",
    "- Do not use em dash-heavy prose.",
    "- Vary the first sentence from recent posts.",
    "- If related prior posts are supplied, make one concise continuity reference without repeating the earlier take.",
    "- If no related prior posts are supplied, do not pretend this continues earlier coverage.",
    "- Do not start with any opening listed in openingsToAvoid.",
    "- Never include API keys or private environment details."
  ].join("\n");
}

export function jsonRepairPrompt({ originalPrompt, badOutput, validationError }) {
  return [
    originalPrompt,
    "",
    "The previous response was invalid JSON for this task.",
    `Validation error: ${validationError}`,
    "Invalid response:",
    String(badOutput).slice(0, 2000),
    "",
    "Return only corrected strict JSON. No Markdown."
  ].join("\n");
}
