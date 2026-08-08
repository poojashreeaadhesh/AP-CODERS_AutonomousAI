import http from "node:http";
import { initializeAgent, loadFeedState, startBackgroundWorker } from "./autonomousAgent.js";
import { readRequestJson, sendJson } from "./utils.js";

const PORT = Number(process.env.PORT || 3000);

async function handleInit(request, response) {
  try {
    const body = await readRequestJson(request);
    const state = await initializeAgent(body.persona);
    sendJson(response, 200, { agentId: state.agent.id });
  } catch (error) {
    sendJson(response, 400, { error: "Invalid initialization request", detail: error.message });
  }
}

async function handleFeed(url, response) {
  const agentId = url.searchParams.get("agentId");
  if (!agentId) {
    sendJson(response, 400, { error: "agentId query parameter is required" });
    return;
  }

  try {
    const result = await loadFeedState(agentId);
    sendJson(response, result.status, result.payload);
  } catch (error) {
    sendJson(response, 500, { error: "Feed generation failed", detail: error.message });
  }
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (request.method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }

  if (request.method === "GET" && url.pathname === "/") {
    sendJson(response, 200, {
      name: "Autonomous AI Creator",
      endpoints: {
        init: "POST /api/agent/init",
        feed: "GET /api/agent/feed?agentId=..."
      }
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/agent/init") {
    await handleInit(request, response);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/agent/feed") {
    await handleFeed(url, response);
    return;
  }

  sendJson(response, 404, { error: "Not found" });
}

export function createServer() {
  return http.createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      sendJson(response, 500, { error: "Unexpected server error", detail: error.message });
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startBackgroundWorker();
  createServer().listen(PORT, () => {
    console.log(`Autonomous AI Creator listening on http://localhost:${PORT}`);
  });
}
