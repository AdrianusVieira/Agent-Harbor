import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { TelemetryStores } from "./telemetryStore.ts";

export function isLoopback(address: string | undefined) {
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}

export function sendJson(
  response: ServerResponse,
  status: number,
  data: unknown,
) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(data));
}

export function createTelemetryReceiver(
  source: "claude" | "codex",
  stores: TelemetryStores,
  changed: () => void = () => {},
): Server {
  return createServer(async (request: IncomingMessage, response) => {
    if (
      !isLoopback(request.socket.remoteAddress) ||
      request.headers.origin ||
      !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(request.headers.host ?? "")
    ) {
      sendJson(response, 403, { error: "Local exporters only." });
      return;
    }
    const path = request.url;
    if (
      request.method !== "POST" ||
      (path !== "/v1/logs" && !(source === "claude" && path === "/v1/metrics"))
    ) {
      sendJson(response, 404, { error: "Unknown OTLP endpoint." });
      return;
    }
    if (
      request.headers["content-type"]?.split(";")[0].trim() !==
      "application/json"
    ) {
      sendJson(response, 415, { error: "Use OTLP HTTP/JSON." });
      return;
    }
    try {
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of request) {
        bytes += Buffer.byteLength(chunk);
        if (bytes > 2_000_000) {
          sendJson(response, 413, { error: "OTLP request is too large." });
          return;
        }
        chunks.push(Buffer.from(chunk));
      }
      const payload: unknown = JSON.parse(
        Buffer.concat(chunks).toString("utf8"),
      );
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        sendJson(response, 400, { error: "Expected an OTLP JSON object." });
        return;
      }
      if (source === "claude") {
        if (path === "/v1/metrics") stores.claude.ingestMetrics(payload);
        else stores.claude.ingestLogs(payload);
      } else stores.codex.ingestLogs(payload);
      changed();
      sendJson(response, 200, {});
    } catch (error) {
      // Never log exporter payloads or database values.
      sendJson(response, error instanceof SyntaxError ? 400 : 500, {
        error: "Could not ingest telemetry.",
      });
    }
  });
}

export async function startTelemetryReceivers(
  stores: TelemetryStores,
  ports = { claude: 4318, codex: 18766 },
  changed: () => void = () => {},
) {
  const servers = [
    createTelemetryReceiver("claude", stores, changed),
    createTelemetryReceiver("codex", stores, changed),
  ];
  try {
    for (const [index, port] of [ports.claude, ports.codex].entries()) {
      if (!Number.isInteger(port) || port < 0 || port > 65535)
        throw new Error("Invalid telemetry port.");
      await new Promise<void>((resolve, reject) => {
        servers[index].once("error", reject);
        servers[index].listen(port, "127.0.0.1", () => {
          servers[index].removeListener("error", reject);
          resolve();
        });
      });
    }
    return servers;
  } catch (error) {
    await closeTelemetryReceivers(servers);
    throw new Error(
      "Harbor could not open its telemetry ports. Stop the old telemetry dashboard or Minecode collector first.",
      { cause: error },
    );
  }
}

export async function closeTelemetryReceivers(servers: Server[]) {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        }),
    ),
  );
}
