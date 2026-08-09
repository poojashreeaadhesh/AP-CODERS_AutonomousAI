import http from "node:http";
import { fileURLToPath } from "node:url";
import { getHealthSnapshot, initializeAgent, loadFeedState, startBackgroundWorker } from "./autonomousAgent.js";
import { assertDurableStorage } from "./store.js";
import { readRequestJson, sendJson } from "./utils.js";

const PORT = Number(process.env.PORT || 3000);

async function handleRoot(request, response) {
  sendJson(response, 200, {
    name: "Autonomous AI Creator",
    endpoints: {
      init: "POST /api/agent/init",
      feed: "GET /api/agent/feed?agentId=...",
      health: "GET /health"
    }
  });
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

const ROUTES = [
  { method: "GET", path: "/", handler: handleRoot },
  { method: "GET", path: "/health", handler: handleHealth },
  { method: "POST", path: "/api/agent/init", handler: handleInit },
  { method: "GET", path: "/api/agent/feed", handler: handleFeed }
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

const currentFile = fileURLToPath(import.meta.url);

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
