import { appendFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

/**
 * Throwaway operator endpoint for story 6.05 — the external agent that the
 * deployed Orizon backend dispatches to during the end-to-end testnet run.
 *
 * It records every request exactly as received (headers and raw body bytes)
 * before doing anything else with it, because the raw dispatch is the
 * evidence: a body that was parsed and re-serialized can no longer be used to
 * verify the signature.
 *
 *   PORT=8787 CAPTURE_FILE=captures.jsonl node tools/operator-endpoint/server.ts
 *
 * Exposed publicly over HTTPS by a tunnel for the duration of the run only.
 */

const PORT = Number(process.env.PORT ?? 8787);
const CAPTURE_FILE = process.env.CAPTURE_FILE ?? "captures.jsonl";

function readRawBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function capture(req: IncomingMessage, rawBody: Buffer): void {
  const record = {
    received_at: new Date().toISOString(),
    method: req.method,
    url: req.url,
    headers: req.headers,
    raw_body_base64: rawBody.toString("base64"),
  };
  appendFileSync(CAPTURE_FILE, JSON.stringify(record) + "\n");
}

function validResult(): string {
  return JSON.stringify({
    summary: "6.05 reference operator: dispatch received and answered",
    artifact: {
      title: "6.05 operator result",
      files: [{ path: "RESULT.md", content: "# 6.05\n\nReturned by the UAT operator endpoint.\n" }],
    },
    critic_violations: [],
  });
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const rawBody = await readRawBody(req);
  capture(req, rawBody);
  res.writeHead(200, { "content-type": "application/json" });
  res.end(validResult());
}

createServer((req, res) => {
  handle(req, res).catch((error: unknown) => {
    process.stderr.write(`operator endpoint: ${String(error)}\n`);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
}).listen(PORT, () => process.stdout.write(`operator endpoint listening on ${PORT}\n`));
