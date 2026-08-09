const state = {
  agentId: new URLSearchParams(location.search).get("agentId") || "auto",
  status: null,
  feed: { posts: [] },
  rejected: { rejected: [] },
  cycles: { cycles: [] },
  memory: { themes: {}, entities: {}, coveredUrls: [] },
  log: { log: [] },
  seenPostIds: new Set(),
  pollTimer: null,
  clockTimer: null
};

const $ = (selector) => document.querySelector(selector);

function endpoint(path) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}agentId=${encodeURIComponent(state.agentId)}`;
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2600);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function relativeTime(iso) {
  if (!iso) return "unknown";
  const diffSeconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const minutes = Math.floor(diffSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatCountdown(targetIso) {
  if (!targetIso) return { label: "--:--", progress: 0 };
  const ms = new Date(targetIso).getTime() - Date.now();
  if (ms <= 0) return { label: "due", progress: 360 };
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const label = hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
  const horizonMs = 75 * 60 * 1000;
  const progress = Math.max(0, Math.min(360, 360 - (ms / horizonMs) * 360));
  return { label, progress };
}

function postTitle(post) {
  return post.sourceTitle || String(post.text || "").split("\n")[0].replace(/^(Signal from this cycle|The useful clue|This deserves scrutiny):\s*/i, "");
}

function renderStatus() {
  const status = state.status || {};
  const persona = status.persona || {};
  const charter = status.charter || {};
  const counts = status.counts || {};

  $("#persona-name").textContent = persona.name || "Autonomous Agent";
  $("#persona-domain").textContent = persona.domain || "Waiting for initialization";
  $("#persona-monogram").textContent = (persona.name || "AI").slice(0, 2).toUpperCase();
  $("#agent-id-label").textContent = `agentId: ${status.agent?.id || state.agentId}`;
  $("#count-posts").textContent = counts.posts || 0;
  $("#count-evaluated").textContent = counts.evaluated || 0;
  $("#count-rejected").textContent = counts.rejected || 0;
  $("#count-cycles").textContent = counts.cycles || 0;
  $("#countdown-reason").textContent = status.nextPublishReason || "The agent has not scheduled a cycle yet.";

  $("#charter-list").innerHTML = [
    ["Voice", charter.voiceStyle],
    ["Beliefs", (charter.beliefs || []).join("; ")],
    ["Must cover", (charter.mustCover || []).join(", ")],
    ["Will not cover", (charter.willNotCover || []).join(", ")]
  ]
    .map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || "Waiting for persona data.")}</dd>`)
    .join("");

  updateCountdown();
}

function updateCountdown() {
  const { label, progress } = formatCountdown(state.status?.nextPublishAt);
  $("#countdown-value").textContent = label;
  $("#countdown-ring").style.setProperty("--progress", `${progress}deg`);
}

function renderHealth(ok) {
  const dot = $("#live-dot");
  dot.classList.toggle("ok", ok);
  $("#live-label").textContent = ok ? "live" : "degraded";
}

function renderFeed() {
  const posts = state.feed.posts || [];
  if (posts.length === 0) {
    $("#feed-list").innerHTML = `<article class="panel empty">No posts yet. The agent is evaluating live topics and will publish when something clears the editorial bar.</article>`;
    return;
  }

  $("#feed-list").innerHTML = posts
    .map((post) => {
      const isNew = !state.seenPostIds.has(post.id);
      const detail = post.rationaleDetail || {};
      const relatedId = (post.relatedPostIds || [])[0];
      const relatedPost = posts.find((candidate) => candidate.id === relatedId);
      const whyOverOthers = (detail.whyOverOthers || [])
        .map((item) => `<li>${escapeHtml(item.title)}: ${escapeHtml(item.reason)}${item.score ? ` (${item.score})` : ""}</li>`)
        .join("");
      const sources = (post.sources || [])
        .map((source) => `<a class="source-chip" href="${escapeHtml(source)}" target="_blank" rel="noreferrer">source</a>`)
        .join("");

      return `
        <article class="panel post-card ${isNew ? "new" : ""}" id="post-${escapeHtml(post.id)}">
          <div class="post-meta">
            <span class="pill good">${escapeHtml(post.decidedBy || "agent")}</span>
            <span class="pill" title="${escapeHtml(post.createdAt)}">${relativeTime(post.createdAt)}</span>
            <span class="pill">score ${escapeHtml(post.editorialScore ?? "n/a")}</span>
          </div>
          <h2>${escapeHtml(postTitle(post))}</h2>
          ${relatedPost ? `<p class="continuity"><a class="source-chip" href="#post-${escapeHtml(relatedPost.id)}">continues from: ${escapeHtml(postTitle(relatedPost))}</a></p>` : ""}
          <p class="post-text">${escapeHtml(post.text)}</p>
          <div class="source-row">${sources}</div>
          <details>
            <summary>Why I published this</summary>
            <p><strong>Selected:</strong> ${escapeHtml(detail.whySelected || post.rationale)}</p>
            <p><strong>Relevant now:</strong> ${escapeHtml(detail.whyNow || "Live source surfaced this item recently.")}</p>
            <ul>${whyOverOthers || "<li>No weaker candidates were recorded for this cycle.</li>"}</ul>
          </details>
        </article>
      `;
    })
    .join("");

  posts.forEach((post) => state.seenPostIds.add(post.id));
}

function renderRejected() {
  const rejected = state.rejected.rejected || [];
  $("#rejected-count-label").textContent = `${rejected.length} rejected`;
  $("#rejected-list").innerHTML = rejected.length
    ? rejected.map((item) => `
      <div class="decision">
        <strong>${escapeHtml(item.title)}</strong>
        <p>${escapeHtml(item.sourceName || "source")} · score ${escapeHtml(item.score ?? "n/a")}</p>
        <p>${escapeHtml(item.reason)}</p>
      </div>
    `).join("")
    : `<p class="empty">No rejected topics recorded yet. Quiet cycles will appear here.</p>`;
}

function renderTimeline() {
  const cycles = state.cycles.cycles || [];
  $("#timeline-strip").innerHTML = cycles.length
    ? cycles.slice().reverse().map((cycle) => {
      const failed = (cycle.sourcesFailed || []).length > 0;
      return `<button class="tick ${failed ? "failed" : escapeHtml(cycle.status)}" title="${escapeHtml(cycle.ranAt)}" data-cycle="${escapeHtml(cycle.id)}"></button>`;
    }).join("")
    : `<p class="empty">No cycles yet.</p>`;

  $("#timeline-strip").querySelectorAll(".tick").forEach((tick) => {
    tick.addEventListener("click", () => {
      const cycle = cycles.find((item) => item.id === tick.dataset.cycle);
      $("#cycle-detail").textContent = JSON.stringify(cycle, null, 2);
    });
  });
}

function renderMemory() {
  const themes = Object.entries(state.memory.themes || {})
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10);
  const entities = Object.entries(state.memory.entities || {})
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 8);
  const rows = [...themes, ...entities];

  $("#memory-list").innerHTML = rows.length
    ? rows.map(([key, entry]) => `
      <div class="memory-item">
        <strong>${escapeHtml(key)} <span class="pill">${entry.count}</span></strong>
        <p>${escapeHtml(entry.kind)} · posts ${escapeHtml((entry.postIds || []).join(", "))}</p>
      </div>
    `).join("")
    : `<p class="empty">Memory will populate as posts publish themes and entities.</p>`;
}

function renderLog() {
  const log = state.log.log || [];
  $("#activity-log").innerHTML = log.length
    ? log.map((entry) => `
      <div class="log-entry">
        <strong>${escapeHtml(entry.event)} <span class="pill">${relativeTime(entry.at)}</span></strong>
        <p>${escapeHtml(entry.message)}</p>
      </div>
    `).join("")
    : `<p class="empty">No activity recorded yet.</p>`;
}

function renderApiExample() {
  const path = endpoint("/api/agent/feed");
  $("#curl-example").textContent = `curl ${location.origin}${path}`;
}

async function runApiCheck() {
  const output = $("#api-output");
  output.textContent = "Running...";
  try {
    const json = await fetchJson(endpoint("/api/agent/feed"));
    output.textContent = JSON.stringify(json, null, 2);
  } catch (error) {
    output.textContent = JSON.stringify({ error: error.message }, null, 2);
  }
}

async function refreshAll({ quiet = false } = {}) {
  try {
    const [health, status, feed, rejected, cycles, memory, log] = await Promise.all([
      fetchJson("/health"),
      fetchJson(endpoint("/api/agent/status")),
      fetchJson(endpoint("/api/agent/feed")),
      fetchJson(endpoint("/api/agent/rejected?limit=30")),
      fetchJson(endpoint("/api/agent/cycles?limit=30")),
      fetchJson(endpoint("/api/agent/memory")),
      fetchJson(endpoint("/api/agent/log?limit=40"))
    ]);

    state.status = status;
    state.feed = feed;
    state.rejected = rejected;
    state.cycles = cycles;
    state.memory = memory;
    state.log = log;

    renderHealth(Boolean(health.ok));
    renderStatus();
    renderFeed();
    renderRejected();
    renderTimeline();
    renderMemory();
    renderLog();
    renderApiExample();
    if (!quiet) showToast("Dashboard refreshed");
  } catch (error) {
    renderHealth(false);
    showToast(`Dashboard degraded: ${error.message}`);
    $("#feed-list").innerHTML = `<article class="panel empty">The dashboard could not load live agent data. The API may still be starting up.</article>`;
  }
}

$("#refresh-button").addEventListener("click", () => refreshAll());
$("#api-run-button").addEventListener("click", runApiCheck);

state.clockTimer = setInterval(updateCountdown, 1000);
state.pollTimer = setInterval(() => refreshAll({ quiet: true }), 10000);
refreshAll({ quiet: true });
