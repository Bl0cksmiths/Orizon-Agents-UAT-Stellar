/**
 * Where the drill keeps what it learns as it runs — the hashes, the
 * authorization id, the times — so the evidence can be written from the run
 * itself. $RECLAIM_STATE, refused inside the repository: it sits beside the
 * buyer's key, and nothing in it belongs in git.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

// Playwright loads the drill as CommonJS, as it does the rest of the suite.
const REPO = path.resolve(__dirname, "..", "..");

export function stateDir(): string {
  const raw = process.env.RECLAIM_STATE;
  if (!raw) throw new Error("set RECLAIM_STATE to a directory outside the repository");
  const dir = path.resolve(raw);
  const inside = path.relative(REPO, dir);
  if (inside === "" || (!inside.startsWith("..") && !path.isAbsolute(inside))) {
    throw new Error(`RECLAIM_STATE ${dir} is inside the repository; it sits beside the buyer's secret`);
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}

const factsFile = () => path.join(stateDir(), "reclaim-run.json");

/** Everything recorded so far in this state directory. */
export function readFacts(): Record<string, string> {
  const file = factsFile();
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, string>) : {};
}

/** Records one fact of the run, keeping every earlier one. */
export function recordFact(name: string, value: string): void {
  writeFileSync(factsFile(), JSON.stringify({ ...readFacts(), [name]: value }, null, 2));
}

/** One timestamped line in $RECLAIM_STATE/progress.log, to follow a run in the background. */
export function progress(line: string): void {
  appendFileSync(path.join(stateDir(), "progress.log"), `${new Date().toISOString()} ${line}\n`);
}

/** $RECLAIM_LOCK: the 6.07 run lock directory, shared by every stream that drives a browser or the chain. */
function lockDir(): string {
  const raw = process.env.RECLAIM_LOCK;
  if (!raw) throw new Error("set RECLAIM_LOCK to the 6.07 run lock directory ($S/run.lock)");
  return path.resolve(raw);
}

/** Takes the run lock (an atomic mkdir), retrying every 30 s while another stream holds it. */
export async function acquireLock(): Promise<void> {
  const dir = lockDir();
  for (;;) {
    try {
      mkdirSync(dir);
      writeFileSync(path.join(dir, "owner"), "reclaim\n");
      progress("run lock taken");
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    progress("run lock held by another stream; retrying in 30 s");
    await new Promise((resolve) => setTimeout(resolve, 30_000));
  }
}

/** Gives the run lock back, only when this stream is the one holding it. */
export function releaseLock(): void {
  const dir = lockDir();
  const owner = path.join(dir, "owner");
  if (existsSync(owner) && readFileSync(owner, "utf8").trim() === "reclaim") {
    rmSync(dir, { recursive: true, force: true });
    progress("run lock released");
  }
}
