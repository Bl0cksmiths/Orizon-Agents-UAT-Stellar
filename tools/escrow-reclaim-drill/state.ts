/**
 * Where the drill keeps what it learns as it runs — the hashes, the
 * authorization id, the times — so the evidence can be written from the run
 * itself. $RECLAIM_STATE, refused inside the repository: it sits beside the
 * buyer's key, and nothing in it belongs in git.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
