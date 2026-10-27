import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { EVENT_LIMIT, eventTypes } from "../src/events.ts";
import type { EventInput, HarborEvent } from "../src/events.ts";
import type { SignalStore } from "./signalStore.ts";

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
  for (const field of ["projectName", "sessionName"] as const) {
    if (
      input[field] !== undefined &&
      (typeof input[field] !== "string" ||
        !input[field].trim() ||
        input[field].length > 200 ||
        (field === "projectName" && /[\u0000-\u001f\u007f]/.test(input[field])))
    ) {
      throw new Error(
        `${field} must be a non-empty string of at most 200 characters${field === "projectName" ? " without control characters" : ""}.`,
      );
    }
  }
  return {
    ...(typeof input.projectName === "string"
      ? { projectName: input.projectName.trim() }
      : {}),
    source: (input.source as string).trim(),
    sessionId: (input.sessionId as string).trim(),
    ...(typeof input.sessionName === "string"
      ? { sessionName: input.sessionName.trim() }
      : {}),
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
export function createReceiver(
  networkUrls: () => string[] = () => [],
  store?: SignalStore,
  authorize?: (req: IncomingMessage) => boolean,
) {
  const clients = new Map<ServerResponse, () => boolean>();
  const events: HarborEvent[] = store?.recent() ?? [];
  const pendingApprovals = new Map<
    string,
    { keys: Set<string>; untracked: boolean }
  >();

  function appendEvent(input: EventInput) {
    const previous = [...events]
      .reverse()
      .filter(
        (event) =>
          event.source === input.source && event.sessionId === input.sessionId,
      );
    const saved = store?.metadata(input.source, input.sessionId);
    const projectName =
      input.projectName ??
      previous.find((event) => event.projectName)?.projectName ??
      saved?.projectName;
    const sessionName =
      input.sessionName ??
      previous.find((event) => event.sessionName)?.sessionName ??
      saved?.sessionName;
    const event: HarborEvent = {
      ...input,
      id: randomUUID(),
      ...(projectName ? { projectName } : {}),
      receivedAt: new Date().toISOString(),
      ...(sessionName ? { sessionName } : {}),
    };
    store?.append(event);
    events.push(event);
    if (events.length > EVENT_LIMIT) events.shift();
    for (const [client, authorized] of clients) {
      if (!authorized()) {
        client.end();
        continue;
      }
      client.write(`event: event\ndata: ${JSON.stringify(event)}\n\n`);
    }
    return event;
  }

  function approvalKey(value: unknown): value is string {
    return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const path = req.url?.split("?")[0];
    const returnSource =
      path === "/api/codex/tool-returned"
        ? "codex"
        : path === "/api/claude-code/tool-returned"
          ? "claude-code"
          : undefined;
    if (
      path !== "/api/events" &&
      path !== "/api/network" &&
      path !== "/api/stream" &&
      returnSource === undefined
    )
      return false;

    // Keep browser requests same-origin; command-line senders have no Origin header.
    if (
      req.headers.origin &&
      req.headers.origin !== `http://${req.headers.host}`
    ) {
      json(res, 403, { error: "Cross-origin requests are not accepted." });
      return true;
    }

    if (path === "/api/network") {
      if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        json(res, 405, { error: "Use GET to read network addresses." });
      } else {
        json(res, 200, { urls: networkUrls() });
      }
      return true;
    }

    if (path === "/api/stream" && req.method === "GET") {
      if (authorize && !authorize(req)) {
        json(res, 401, { error: "Log in to Harbor." });
        return true;
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write(`event: snapshot\ndata: ${JSON.stringify(events)}\n\n`);
      const authorized = () => !authorize || authorize(req);
      clients.set(res, authorized);
      const heartbeat = setInterval(() => {
        if (authorized()) res.write(": heartbeat\n\n");
        else res.end();
      }, 15_000);
      res.on("close", () => {
        clearInterval(heartbeat);
        clients.delete(res);
      });
      return true;
    }

    if (path !== "/api/stream" && req.method === "POST") {
      // Wi-Fi clients may view events; only local observers may submit them.
      const address = req.socket.remoteAddress;
      if (
        address !== "127.0.0.1" &&
        address !== "::1" &&
        address !== "::ffff:127.0.0.1"
      ) {
        json(res, 403, {
          error: "Event submissions require a loopback connection.",
        });
        return true;
      }
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
        const value: unknown = JSON.parse(
          Buffer.concat(chunks).toString("utf8"),
        );
        if (returnSource) {
          if (!value || typeof value !== "object" || Array.isArray(value))
            throw new Error("Expected a JSON object.");
          const { approvalKey: key, sessionId } = value as Record<
            string,
            unknown
          >;
          if (
            !approvalKey(key) ||
            typeof sessionId !== "string" ||
            !sessionId.trim() ||
            sessionId.length > 120
          )
            throw new Error("Invalid tool-return metadata.");
          const id = sessionId.trim();
          const identity = JSON.stringify([returnSource, id]);
          const pending = pendingApprovals.get(identity);
          // Unrelated or late tool returns never overwrite ready/new activity.
          if (
            pending?.keys.delete(key) &&
            !pending.keys.size &&
            !pending.untracked
          ) {
            pendingApprovals.delete(identity);
            appendEvent({
              message:
                returnSource === "codex"
                  ? "Codex continued after a permission request."
                  : "Claude Code continued after a permission request.",
              sessionId: id,
              source: returnSource,
              type: "activity",
            });
          }
          res.writeHead(204);
          res.end();
        } else {
          const input = parseEvent(value);
          if (input.source === "codex" || input.source === "claude-code") {
            const identity = JSON.stringify([input.source, input.sessionId]);
            if (input.type === "waiting") {
              const pending = pendingApprovals.get(identity) ?? {
                keys: new Set<string>(),
                untracked: false,
              };
              const key = (value as Record<string, unknown>).approvalKey;
              if (
                !approvalKey(key) ||
                pending.keys.has(key) ||
                pending.keys.size >= EVENT_LIMIT
              ) {
                // Missing metadata or identical concurrent calls are ambiguous.
                // Keep waiting until the next lifecycle signal in that case.
                pending.untracked = true;
              } else pending.keys.add(key);
              pendingApprovals.set(identity, pending);
              if (pendingApprovals.size > EVENT_LIMIT)
                pendingApprovals.delete(pendingApprovals.keys().next().value!);
            } else pendingApprovals.delete(identity);
          }
          json(res, 201, appendEvent(input));
        }
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
    for (const client of clients.keys()) client.end();
    clients.clear();
    pendingApprovals.clear();
  }
  return { handle, close };
}
