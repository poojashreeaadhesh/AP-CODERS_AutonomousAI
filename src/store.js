import fs from "node:fs/promises";
import path from "node:path";

const defaultDataDir = path.join(process.cwd(), "data");
const dataDir = process.env.DATA_DIR || defaultDataDir;
const statePath = path.join(dataDir, "state.json");

const CURRENT_VERSION = 2;

let memoryState = null;

function emptyStore() {
  return { version: CURRENT_VERSION, agents: {} };
}

// v1 stored a single agent at the top level: { agent, posts, rejectedTopics, ... }.
// v2 stores a map of agents so more than one persona can run at once.
function migrate(raw) {
  if (!raw || typeof raw !== "object") return emptyStore();
  if (raw.version === CURRENT_VERSION && raw.agents) return raw;

  if (raw.agent?.id) {
    return {
      version: CURRENT_VERSION,
      agents: {
        [raw.agent.id]: {
          agent: raw.agent,
          posts: raw.posts || [],
          rejectedTopics: raw.rejectedTopics || [],
          seenTopics: raw.seenTopics || [],
          cycles: raw.cycles || [],
          nextPublishAt: raw.nextPublishAt || raw.agent.createdAt
        }
      }
    };
  }

  return emptyStore();
}

export async function loadStore() {
  if (memoryState) {
    return structuredClone(memoryState);
  }

  try {
    const raw = await fs.readFile(statePath, "utf8");
    const parsed = migrate(JSON.parse(raw));
    memoryState = parsed;
    return structuredClone(parsed);
  } catch (error) {
    if (error.code === "ENOENT") {
      return emptyStore();
    }

    // A corrupt or unreadable state file must never take the feed down.
    // Serve an empty store instead of throwing; T3 adds a .bak recovery path.
    console.error("Failed to load state, serving an empty store:", error.message);
    return emptyStore();
  }
}

export async function saveStore(store) {
  memoryState = structuredClone(store);

  try {
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(statePath, JSON.stringify(store, null, 2));
  } catch (error) {
    if (["EROFS", "EACCES", "EPERM"].includes(error.code)) {
      return;
    }
    throw error;
  }
}

export async function clearStateForTests() {
  memoryState = null;
  try {
    await fs.rm(statePath, { force: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
