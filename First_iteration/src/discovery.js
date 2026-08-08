const DEFAULT_TIMEOUT_MS = 7000;

const SOURCE_QUERIES = {
  "ai security": ["AI security", "LLM vulnerability", "prompt injection", "model safety"],
  "machine learning": ["machine learning", "LLM", "AI research", "deep learning"],
  robotics: ["robotics AI", "embodied AI", "robot learning"],
  "developer advocacy": ["developer tools AI", "open source AI", "AI SDK"],
  "ai ethics": ["AI ethics", "AI policy", "AI governance", "model transparency"]
};

function domainQueries(domain) {
  const normalized = String(domain || "AI technology").toLowerCase();
  const matched = Object.entries(SOURCE_QUERIES).find(([key]) => normalized.includes(key));
  if (matched) return matched[1];

  return [
    `${domain} AI`,
    `${domain} technology`,
    "artificial intelligence",
    "developer tools"
  ];
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "AutonomousAICreator/1.0"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function discoverFromHackerNews(query) {
  const url = new URL("https://hn.algolia.com/api/v1/search_by_date");
  url.searchParams.set("query", query);
  url.searchParams.set("tags", "story");
  url.searchParams.set("hitsPerPage", "10");

  const response = await fetchWithTimeout(url);
  const json = await response.json();

  return (json.hits || [])
    .filter((item) => item.title && (item.url || item.objectID))
    .map((item) => ({
      title: item.title,
      url: item.url || `https://news.ycombinator.com/item?id=${item.objectID}`,
      sourceName: "Hacker News",
      publishedAt: item.created_at,
      summary: item.story_text || item.title,
      signals: {
        points: item.points || 0,
        comments: item.num_comments || 0
      }
    }));
}

async function discoverFromDevTo(query) {
  const tag = query.toLowerCase().includes("security") ? "security" : "ai";
  const url = new URL("https://dev.to/api/articles");
  url.searchParams.set("tag", tag);
  url.searchParams.set("per_page", "10");
  url.searchParams.set("top", "7");

  const response = await fetchWithTimeout(url);
  const json = await response.json();

  return (json || []).map((item) => ({
    title: item.title,
    url: item.url,
    sourceName: "Dev.to",
    publishedAt: item.published_at,
    summary: item.description || item.title,
    signals: {
      points: item.public_reactions_count || 0,
      comments: item.comments_count || 0
    }
  }));
}

function extractXmlTag(entry, tag) {
  const match = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? match[1].replace(/\s+/g, " ").trim() : "";
}

async function discoverFromArxiv(query) {
  const url = new URL("https://export.arxiv.org/api/query");
  url.searchParams.set("search_query", `all:${query}`);
  url.searchParams.set("start", "0");
  url.searchParams.set("max_results", "5");
  url.searchParams.set("sortBy", "submittedDate");
  url.searchParams.set("sortOrder", "descending");

  const response = await fetchWithTimeout(url);
  const xml = await response.text();
  const entries = xml.split("<entry>").slice(1);

  return entries.map((entry) => ({
    title: extractXmlTag(entry, "title"),
    url: extractXmlTag(entry, "id"),
    sourceName: "arXiv",
    publishedAt: extractXmlTag(entry, "published"),
    summary: extractXmlTag(entry, "summary"),
    signals: {
      points: 1,
      comments: 0
    }
  }));
}

function dedupeTopics(topics) {
  const seen = new Set();
  const unique = [];

  for (const topic of topics) {
    const key = topic.url || topic.title.toLowerCase();
    if (!topic.title || seen.has(key)) continue;
    seen.add(key);
    unique.push(topic);
  }

  return unique;
}

export async function discoverTopics(persona) {
  const queries = domainQueries(persona.domain).slice(0, 3);
  const jobs = [];

  for (const query of queries) {
    jobs.push(discoverFromHackerNews(query));
  }

  jobs.push(discoverFromDevTo(queries[0]));
  jobs.push(discoverFromArxiv(queries[0]));

  const results = await Promise.allSettled(jobs);
  const topics = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));

  return dedupeTopics(topics).slice(0, 30);
}
