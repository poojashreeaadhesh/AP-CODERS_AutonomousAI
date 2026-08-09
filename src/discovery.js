const DEFAULT_TIMEOUT_MS = 5000;
const CIRCUIT_BREAKER_FAILURES = 3;
const CIRCUIT_BREAKER_DISABLE_MINUTES = 30;

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

function decodeHtml(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractXmlTag(entry, tag) {
  const match = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeHtml(match[1]) : "";
}

function extractXmlLink(entry) {
  const href = entry.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i);
  if (href) return decodeHtml(href[1]);
  return extractXmlTag(entry, "link");
}

async function discoverFromHackerNews({ query }) {
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

async function discoverFromDevTo({ query }) {
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

async function discoverFromArxiv({ query }) {
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

async function discoverFromFeed({ source, now = new Date() }) {
  const response = await fetchWithTimeout(source.url);
  const xml = await response.text();
  const rawEntries = xml.includes("<item")
    ? xml.split(/<item[^>]*>/i).slice(1)
    : xml.split(/<entry[^>]*>/i).slice(1);

  return rawEntries.slice(0, 8).map((entry) => ({
    title: extractXmlTag(entry, "title"),
    url: extractXmlLink(entry) || source.url,
    sourceName: source.displayName,
    publishedAt: extractXmlTag(entry, "pubDate") || extractXmlTag(entry, "published") || extractXmlTag(entry, "updated") || now.toISOString(),
    summary: extractXmlTag(entry, "description") || extractXmlTag(entry, "summary") || extractXmlTag(entry, "content"),
    signals: {
      points: source.weight || 1,
      comments: 0
    }
  }));
}

async function discoverFromGithubTrending({ now = new Date() } = {}) {
  const response = await fetchWithTimeout("https://github.com/trending?since=daily");
  const html = await response.text();
  const matches = [...html.matchAll(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];

  return matches.slice(0, 8).map((match) => {
    const repoPath = decodeHtml(match[1]).replace(/^\//, "");
    const title = decodeHtml(match[2]).replace(/\s*\/\s*/g, "/");
    return {
      title: `GitHub trending repository: ${title}`,
      url: `https://github.com/${repoPath}`,
      sourceName: "GitHub Trending",
      publishedAt: now.toISOString(),
      summary: `Open source project currently trending on GitHub: ${title}`,
      signals: {
        points: 5,
        comments: 0
      }
    };
  });
}

function rssSource(id, displayName, url, weight = 1) {
  return {
    id,
    displayName,
    kind: "rss",
    url,
    weight,
    enabled: true,
    fetch: discoverFromFeed
  };
}

export const SOURCE_REGISTRY = [
  {
    id: "hacker-news",
    displayName: "Hacker News",
    kind: "api",
    weight: 1.1,
    enabled: true,
    fetch: discoverFromHackerNews
  },
  {
    id: "dev-to",
    displayName: "Dev.to",
    kind: "api",
    weight: 0.8,
    enabled: true,
    fetch: discoverFromDevTo
  },
  {
    id: "arxiv",
    displayName: "arXiv",
    kind: "api",
    weight: 1,
    enabled: true,
    fetch: discoverFromArxiv
  },
  rssSource("simon-willison", "Simon Willison", "https://simonwillison.net/atom/everything/", 0.9),
  rssSource("openai-news", "OpenAI News", "https://openai.com/news/rss.xml", 1),
  rssSource("the-register-security", "The Register Security", "https://www.theregister.com/security/headlines.atom", 0.9),
  {
    id: "github-trending",
    displayName: "GitHub Trending",
    kind: "html",
    weight: 0.7,
    enabled: true,
    fetch: discoverFromGithubTrending
  }
];

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

function existingHealthFor(source, sourceHealth = {}) {
  return sourceHealth[source.id] || sourceHealth[source.displayName] || {};
}

function disabledResult(source, query, existing, now) {
  return {
    id: source.id,
    sourceName: source.displayName,
    query,
    kind: source.kind,
    status: "disabled",
    count: 0,
    consecutiveFailures: existing.consecutiveFailures || CIRCUIT_BREAKER_FAILURES,
    disabledUntil: existing.disabledUntil,
    lastCheckedAt: now.toISOString(),
    error: existing.lastError || "source temporarily disabled after repeated failures"
  };
}

function failedResult(source, query, error, existing, now) {
  const consecutiveFailures = (existing.consecutiveFailures || 0) + 1;
  const disabledUntil = consecutiveFailures >= CIRCUIT_BREAKER_FAILURES
    ? new Date(now.getTime() + CIRCUIT_BREAKER_DISABLE_MINUTES * 60 * 1000).toISOString()
    : null;

  return {
    id: source.id,
    sourceName: source.displayName,
    query,
    kind: source.kind,
    status: disabledUntil ? "disabled" : "failed",
    count: 0,
    consecutiveFailures,
    disabledUntil,
    lastCheckedAt: now.toISOString(),
    error: error?.message || "source failed"
  };
}

function okResult(source, query, count, now) {
  return {
    id: source.id,
    sourceName: source.displayName,
    query,
    kind: source.kind,
    status: "ok",
    count,
    consecutiveFailures: 0,
    disabledUntil: null,
    lastCheckedAt: now.toISOString(),
    error: null
  };
}

export async function discoverTopics(persona) {
  const { topics } = await discoverTopicsWithTelemetry(persona);
  return topics;
}

export async function discoverTopicsWithTelemetry(persona, options = {}) {
  const now = options.now || new Date();
  const queries = domainQueries(persona.domain);
  const query = queries[(options.cycleCount || 0) % queries.length];
  const sourceHealth = options.sourceHealth || {};
  const jobs = [];
  const sourceResults = [];

  for (const source of SOURCE_REGISTRY) {
    if (!source.enabled) continue;

    const existing = existingHealthFor(source, sourceHealth);
    const disabledUntil = existing.disabledUntil ? new Date(existing.disabledUntil) : null;
    if (disabledUntil && disabledUntil > now) {
      sourceResults.push(disabledResult(source, query, existing, now));
      continue;
    }

    jobs.push({ source, existing, query, run: () => source.fetch({ query, persona, source, now }) });
  }

  const results = await Promise.allSettled(jobs.map((job) => job.run()));
  const topics = [];

  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    const job = jobs[index];

    if (result.status === "fulfilled") {
      const sourceTopics = result.value.map((topic) => ({
        ...topic,
        sourceId: job.source.id,
        sourceName: topic.sourceName || job.source.displayName
      }));
      topics.push(...sourceTopics);
      sourceResults.push(okResult(job.source, job.query, sourceTopics.length, now));
    } else {
      sourceResults.push(failedResult(job.source, job.query, result.reason, job.existing, now));
    }
  }

  return {
    topics: dedupeTopics(topics).slice(0, 30),
    sourceResults,
    query,
    queries
  };
}
