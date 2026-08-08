import fs from "node:fs/promises";
import path from "node:path";

const defaultDataDir = path.join(process.cwd(), "data");
const dataDir = process.env.DATA_DIR || defaultDataDir;
const statePath = path.join(dataDir, "state.json");

let memoryState = null;

export async function loadState() {
  if (memoryState) {
    return structuredClone(memoryState);
  }

  try {
    const raw = await fs.readFile(statePath, "utf8");
    const parsed = JSON.parse(raw);
    memoryState = parsed;
    return structuredClone(parsed);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function saveState(state) {
  memoryState = structuredClone(state);

  try {
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(statePath, JSON.stringify(state, null, 2));
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
