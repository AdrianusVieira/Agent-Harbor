import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { EVENT_LIMIT, eventTypes } from "../src/events.ts";
import type { EventInput, HarborEvent } from "../src/events.ts";

const MAX_BODY_BYTES = 16_384;

export function parseEvent(value: unknown): EventInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected a JSON object.");
  }
  const input = value as Record<string, unknown>;
  for (const [field, max] of [
    ["source", 60],
    ["sessionId", 120],
    ["message", 4000],
  ] as const) {
    if (
      typeof input[field] !== "string" ||
      !input[field].trim() ||
      input[field].length > max
    ) {
      throw new Error(
        `${field} must be a non-empty string of at most ${max} characters.`,
      );
    }
  }
  if (!eventTypes.includes(input.type as EventInput["type"])) {
    throw new Error(`type must be one of: ${eventTypes.join(", ")}.`);
  }
  return {
    source: (input.source as string).trim(),
    sessionId: (input.sessionId as string).trim(),
    message: (input.message as string).trim(),
    type: input.type as EventInput["type"],
  };
}

function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
}

// Development-only receiver. The browser reconnects with a full bounded snapshot.
export function createReceiver() {
  const events: HarborEvent[] = [];
  const clients = new Set<ServerResponse>();

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const path = req.url?.split("?")[0];
    if (path !== "/api/events" && path !== "/api/stream") return false;

    // Keep browser requests same-origin; command-line senders have no Origin header.
    if (
      req.headers.origin &&
      req.headers.origin !== `http://${req.headers.host}`
    ) {
      json(res, 403, { error: "Cross-origin requests are not accepted." });
      return true;
    }

    if (path === "/api/stream" && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write(`event: snapshot\ndata: ${JSON.stringify(events)}\n\n`);
      clients.add(res);
      const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15_000);
      res.on("close", () => {
        clearInterval(heartbeat);
        clients.delete(res);
      });
      return true;
    }

    if (path === "/api/events" && req.method === "POST") {
      if (
        req.headers["content-type"]?.split(";")[0].trim() !== "application/json"
      ) {
        json(res, 415, { error: "Use Content-Type: application/json." });
        return true;
      }
      try {
        const chunks: Buffer[] = [];
        let bytes = 0;
        for await (const chunk of req) {
          bytes += Buffer.byteLength(chunk);
          if (bytes > MAX_BODY_BYTES) {
            json(res, 413, { error: "Event exceeds 16 KiB." });
            return true;
          }
          chunks.push(Buffer.from(chunk));
        }
        const input = parseEvent(
          JSON.parse(Buffer.concat(chunks).toString("utf8")),
        );
        const event: HarborEvent = {
          ...input,
          id: randomUUID(),
          receivedAt: new Date().toISOString(),
        };
        events.push(event);
        if (events.length > EVENT_LIMIT) events.shift();
        for (const client of clients)
          client.write(`event: event\ndata: ${JSON.stringify(event)}\n\n`);
        json(res, 201, event);
      } catch (error) {
        json(res, 400, {
          error:
            error instanceof SyntaxError
              ? "Invalid JSON."
              : (error as Error).message,
        });
      }
      return true;
    }

    res.setHeader("Allow", path === "/api/stream" ? "GET" : "POST");
    json(res, 405, { error: "Method not allowed." });
    return true;
  }

  function close() {
    for (const client of clients) client.end();
    clients.clear();
  }
  return { handle, close };
}
