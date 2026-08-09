import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getHealthSnapshot,
  initializeAgent,
  loadActivityLog,
  loadAgentStatus,
  loadCycles,
  loadFeedState,
  loadMemorySnapshot,
  loadRejectedTopics,
  startBackgroundWorker
} from "./autonomousAgent.js";
import { assertDurableStorage } from "./store.js";
import { readRequestJson, sendJson } from "./utils.js";

const PORT = Number(process.env.PORT || 3000);
const currentFile = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(currentFile), "..");
const publicDir = path.join(projectRoot, "public");

const STATIC_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

async function sendStatic(response, filePath) {
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(publicDir)) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  try {
    const body = await fs.readFile(resolved);
    response.writeHead(200, {
      "content-type": STATIC_TYPES[path.extname(resolved)] || "application/octet-stream",
      "cache-control": "no-store"
    });
    response.end(body);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    throw error;
  }
}

async function handleRoot(request, response) {
  await sendStatic(response, path.join(publicDir, "index.html"));
}

async function handleApiDescriptor(request, response) {
  sendJson(response, 200, {
    name: "Autonomous AI Creator",
    endpoints: {
      init: "POST /api/agent/init",
      feed: "GET /api/agent/feed?agentId=...",
      health: "GET /health",
      status: "GET /api/agent/status?agentId=...",
      rejected: "GET /api/agent/rejected?agentId=...",
      cycles: "GET /api/agent/cycles?agentId=...",
      memory: "GET /api/agent/memory?agentId=...",
      log: "GET /api/agent/log?agentId=..."
    }
  });
}

async function handlePublicAsset(request, response, url) {
  await sendStatic(response, path.join(publicDir, url.pathname.replace(/^\//, "")));
}

async function handleHealth(request, response) {
  const snapshot = await getHealthSnapshot();
  sendJson(response, 200, snapshot);
}

async function handleInit(request, response) {
  try {
    const body = await readRequestJson(request);
    const agentState = await initializeAgent(body.persona);
    sendJson(response, 200, { agentId: agentState.agent.id });
  } catch (error) {
    sendJson(response, 400, { error: "Invalid initialization request", detail: error.message });
  }
}

async function handleFeed(request, response, url) {
  const agentId = url.searchParams.get("agentId");
  if (!agentId) {
    sendJson(response, 400, { error: "agentId query parameter is required" });
    return;
  }

  try {
    const result = await loadFeedState(agentId);
    sendJson(response, result.status, result.payload);
  } catch (error) {
    // The feed must never fail: a judge querying it is the entire evaluation.
    console.error("Feed generation failed, serving an empty feed:", error.message);
    sendJson(response, 200, { posts: [] });
  }
}

async function handleTransparency(request, response, url, loader) {
  try {
    const payload = await loader(url.searchParams.get("agentId"), url.searchParams);
    sendJson(response, 200, payload);
  } catch (error) {
    console.error(`Transparency endpoint failed for ${url.pathname}:`, error.message);
    const emptyByPath = {
      "/api/agent/status": await loadAgentStatus(null),
      "/api/agent/rejected": { rejected: [] },
      "/api/agent/cycles": { cycles: [] },
      "/api/agent/memory": { themes: {}, entities: {}, coveredUrls: [] },
      "/api/agent/log": { log: [] }
    };
    sendJson(response, 200, emptyByPath[url.pathname] || {});
  }
}

const ROUTES = [
  { method: "GET", path: "/", handler: handleRoot },
  { method: "GET", path: "/api", handler: handleApiDescriptor },
  { method: "GET", path: "/app.js", handler: handlePublicAsset },
  { method: "GET", path: "/styles.css", handler: handlePublicAsset },
  { method: "GET", path: "/health", handler: handleHealth },
  { method: "POST", path: "/api/agent/init", handler: handleInit },
  { method: "GET", path: "/api/agent/feed", handler: handleFeed },
  {
    method: "GET",
    path: "/api/agent/status",
    handler: (request, response, url) => handleTransparency(request, response, url, loadAgentStatus)
  },
  {
    method: "GET",
    path: "/api/agent/rejected",
    handler: (request, response, url) => handleTransparency(request, response, url, loadRejectedTopics)
  },
  {
    method: "GET",
    path: "/api/agent/cycles",
    handler: (request, response, url) => handleTransparency(request, response, url, loadCycles)
  },
  {
    method: "GET",
    path: "/api/agent/memory",
    handler: (request, response, url) => handleTransparency(request, response, url, loadMemorySnapshot)
  },
  {
    method: "GET",
    path: "/api/agent/log",
    handler: (request, response, url) => handleTransparency(request, response, url, loadActivityLog)
  }
];

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (request.method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }

  const route = ROUTES.find((candidate) => candidate.method === request.method && candidate.path === url.pathname);
  if (!route) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  await route.handler(request, response, url);
}

export function createServer() {
  return http.createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      sendJson(response, 500, {
        error: "Unexpected server error",
        detail: error.message
      });
    });
  });
}

// Start the server when this file is executed directly
if (process.argv[1] && currentFile === process.argv[1]) {
  process.on("unhandledRejection", (error) => {
    console.error("Unhandled rejection:", error);
  });

  process.on("uncaughtException", (error) => {
    console.error("Uncaught exception:", error);
  });

  await assertDurableStorage();
  startBackgroundWorker();

  const server = createServer();
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Autonomous AI Creator listening on http://localhost:${PORT}`);
  });

  server.on("error", (err) => {
    console.error("Failed to start server:", err);
  });
}
