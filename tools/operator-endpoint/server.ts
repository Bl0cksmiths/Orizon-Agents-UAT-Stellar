import { appendFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { verifyDispatch } from "./verify-dispatch.ts";

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
// Both pinned from configuration, per the operator guide: the signer from
// GET /api/stellar/network fetched once, the URL as it was bound.
const PINNED_SIGNER = process.env.PINNED_SIGNER ?? "";
const BOUND_ENDPOINT_URL = process.env.BOUND_ENDPOINT_URL ?? "";

function signatureCheck(req: IncomingMessage, rawBody: Buffer): boolean | null {
  const signature = req.headers["x-orizon-signature"];
  if (typeof signature !== "string" || !PINNED_SIGNER || !BOUND_ENDPOINT_URL) return null;
  return verifyDispatch({
    rawBody,
    signatureBase64: signature,
    pinnedSigner: PINNED_SIGNER,
    boundEndpointUrl: BOUND_ENDPOINT_URL,
  });
}

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
    signature_verified: signatureCheck(req, rawBody),
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

type Mode = "ok" | "timeout" | "oversize" | "malformed";
const MODES: readonly Mode[] = ["ok", "timeout", "oversize", "malformed"];
let mode: Mode = "ok";

// Past the backend's 1 MiB response cap, so the body is cut off unread.
const OVERSIZE_BYTES = 2 * 1024 * 1024;

function deadlineMs(rawBody: Buffer): number {
  try {
    const value = (JSON.parse(rawBody.toString("utf8")) as { deadline_ms?: unknown }).deadline_ms;
    return typeof value === "number" ? value : 120_000;
  } catch {
    return 120_000;
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const rawBody = await readRawBody(req);
  capture(req, rawBody);
  if (mode === "timeout") {
    await new Promise((resolve) => setTimeout(resolve, deadlineMs(rawBody) + 15_000));
  }
  res.writeHead(200, { "content-type": "application/json" });
  if (mode === "oversize") {
    res.end(JSON.stringify({ summary: "x".repeat(OVERSIZE_BYTES) }));
  } else if (mode === "malformed") {
    res.end('{"summary": "unterminated');
  } else {
    res.end(validResult());
  }
}

createServer((req, res) => {
  handle(req, res).catch((error: unknown) => {
    process.stderr.write(`operator endpoint: ${String(error)}\n`);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
}).listen(PORT, () => process.stdout.write(`operator endpoint listening on ${PORT}\n`));

// Failure-mode switch. Loopback only and on its own port, so the tunnel —
// which forwards PORT alone — never exposes it: POST /mode/<mode>.
createServer((req, res) => {
  const requested = req.method === "POST" ? req.url?.replace(/^\/mode\//, "") : undefined;
  const next = MODES.find((candidate) => candidate === requested);
  if (next) mode = next;
  res.writeHead(next ? 200 : 400, { "content-type": "text/plain" });
  res.end(`mode=${mode}\n`);
}).listen(Number(process.env.CONTROL_PORT ?? PORT + 1), "127.0.0.1");
