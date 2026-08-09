import fs from "node:fs/promises";
import path from "node:path";

const defaultDataDir = path.join(process.cwd(), "data");
const dataDir = process.env.DATA_DIR || defaultDataDir;
const statePath = path.join(dataDir, "state.json");
const backupPath = `${statePath}.bak`;
const tmpPath = `${statePath}.tmp`;

const CURRENT_VERSION = 2;

let memoryState = null;

// Serializes every load-mutate-save cycle through withStore() so concurrent
// callers (the background tick and multiple feed reads) can never race and
// silently drop each other's writes.
let writeQueue = Promise.resolve();

function emptyStore() {
  return { version: CURRENT_VERSION, agents: {} };
}

function normalizeAgentState(agentState) {
  return {
    ...agentState,
    posts: agentState.posts || [],
    rejectedTopics: agentState.rejectedTopics || [],
    seenTopics: agentState.seenTopics || [],
    memory: agentState.memory || { themes: {}, entities: {} },
    cycles: agentState.cycles || []
  };
}

// v1 stored a single agent at the top level: { agent, posts, rejectedTopics, ... }.
// v2 stores a map of agents so more than one persona can run at once.
function migrate(raw) {
  if (!raw || typeof raw !== "object") return emptyStore();
  if (raw.version === CURRENT_VERSION && raw.agents) {
    return {
      ...raw,
      agents: Object.fromEntries(
        Object.entries(raw.agents).map(([id, agentState]) => [id, normalizeAgentState(agentState)])
      )
    };
  }

  if (raw.agent?.id) {
    return {
      version: CURRENT_VERSION,
      agents: {
        [raw.agent.id]: normalizeAgentState({
          agent: raw.agent,
          posts: raw.posts || [],
          rejectedTopics: raw.rejectedTopics || [],
          seenTopics: raw.seenTopics || [],
          memory: raw.memory || { themes: {}, entities: {} },
          cycles: raw.cycles || [],
          nextPublishAt: raw.nextPublishAt || raw.agent.createdAt
        })
      }
    };
  }

  return emptyStore();
}

async function readJsonFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

export async function loadStore() {
  if (memoryState) {
    return structuredClone(memoryState);
  }

  try {
    const parsed = migrate(await readJsonFile(statePath));
    memoryState = parsed;
    return structuredClone(parsed);
  } catch (error) {
    if (error.code === "ENOENT") {
      return emptyStore();
    }

    console.error(`Primary state file unreadable (${error.message}), trying backup`);

    try {
      const parsed = migrate(await readJsonFile(backupPath));
      memoryState = parsed;
      console.warn("Recovered state from backup file after primary state was corrupt");
      return structuredClone(parsed);
    } catch (backupError) {
      // No usable file on disk and no in-memory cache (a fresh process would
      // have returned above via the memoryState check). Only now do we treat
      // the agent as uninitialized.
      console.error(`Backup state file also unreadable (${backupError.message}), starting fresh`);
      return emptyStore();
    }
  }
}

async function writeFileDurably(filePath, contents) {
  const handle = await fs.open(filePath, "w");
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function saveStore(store) {
  memoryState = structuredClone(store);

  try {
    await fs.mkdir(dataDir, { recursive: true });

    // Snapshot the last-known-good file as a backup before overwriting it, so
    // a crash mid-write always leaves a recoverable copy behind.
    try {
      await fs.copyFile(statePath, backupPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    await writeFileDurably(tmpPath, JSON.stringify(store, null, 2));
    await fs.rename(tmpPath, statePath);
  } catch (error) {
    if (["EROFS", "EACCES", "EPERM"].includes(error.code)) {
      return;
    }
    throw error;
  }
}

/**
 * Runs `mutator(store)` with exclusive access to the store: no other
 * withStore() call can read or write between this call's load and save.
 * Every read-modify-write of agent state should go through this instead of
 * calling loadStore()/saveStore() directly.
 *
 * If the mutator's return value has `save: false`, the store is not
 * persisted — useful for no-op catch-up calls (e.g. nothing was due) so a
 * feed poll doesn't force a disk write when nothing changed.
 */
export function withStore(mutator) {
  const task = writeQueue.then(async () => {
    const store = await loadStore();
    const result = await mutator(store);
    if (!(result && result.save === false)) {
      await saveStore(store);
    }
    return result;
  });

  // Keep the queue alive even if this task fails, so one failure doesn't
  // permanently wedge every future write.
  writeQueue = task.then(
    () => {},
    () => {}
  );

  return task;
}

/**
 * Verifies DATA_DIR is actually writable and warns loudly if not. A
 * non-durable data directory means every restart silently loses all agent
 * state, which is the single most likely way to fail the 48-hour
 * observation window.
 */
export async function assertDurableStorage() {
  const probePath = path.join(dataDir, ".write-probe");

  try {
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(probePath, "ok");
    await fs.rm(probePath, { force: true });
    return true;
  } catch (error) {
    console.warn(
      `WARN state-not-durable: DATA_DIR "${dataDir}" is not writable (${error.message}). ` +
        "Agent state will only live in process memory and will be LOST on restart or redeploy."
    );
    return false;
  }
}

export async function clearStateForTests() {
  memoryState = null;
  writeQueue = Promise.resolve();

  for (const filePath of [statePath, backupPath, tmpPath]) {
    try {
      await fs.rm(filePath, { force: true });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

export function resetMemoryCacheForTests() {
  memoryState = null;
}
