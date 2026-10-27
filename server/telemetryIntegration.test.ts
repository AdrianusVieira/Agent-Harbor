import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { createServer, request } from "node:http";
import { createServer as createSocketServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import { createServer as createViteServer } from "vite";
import { harborBackend } from "../scripts/telemetry-plugin.ts";
import type { HarborEvent } from "../src/events.ts";
import { createReceiver } from "./receiver.ts";
import { SignalStore } from "./signalStore.ts";
import { TelemetryQueries } from "./telemetryQueries.ts";
import { createTelemetryApi } from "./telemetryApi.ts";
import { mergeTelemetryHistory } from "./telemetryImport.ts";
import {
  closeTelemetryReceivers,
  startTelemetryReceivers,
} from "./telemetryReceiver.ts";
import { openTelemetryStores } from "./telemetryStore.ts";

const attribute = (key: string, value: string) => ({
  key,
  value: { stringValue: value },
});
const at = Date.now();
const metric = (id = "shared") => ({
  resourceMetrics: [
    {
      scopeMetrics: [
        {
          metrics: [
            {
              name: "claude_code.token.usage",
              sum: {
                aggregationTemporality: 1,
                dataPoints: [
                  {
                    timeUnixNano: String(BigInt(at) * 1_000_000n),
                    asInt: "12",
                    attributes: [
                      attribute("session.id", id),
                      attribute("type", "input"),
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  ],
});
const logs = (id = "shared") => ({
  resourceLogs: [
    {
      scopeLogs: [
        {
          logRecords: [
            {
              timeUnixNano: String(BigInt(at) * 1_000_000n),
              body: { stringValue: "claude_code.user_prompt" },
              attributes: [
                attribute("session.id", id),
                attribute("user.email", "owner@example.test"),
                attribute("prompt", "A private task description"),
              ],
            },
          ],
        },
      ],
    },
  ],
});
const codexLogs = {
  resourceLogs: [
    {
      scopeLogs: [
        {
          logRecords: [
            {
              timeUnixNano: "0",
              body: { stringValue: "codex.user_prompt" },
              attributes: [
                attribute("conversation.id", "shared"),
                attribute("event.timestamp", new Date(at).toISOString()),
                attribute("prompt", "Codex private task"),
              ],
            },
          ],
        },
      ],
    },
  ],
};
const address = (server: { address(): string | { port: number } | null }) => {
  const value = server.address();
  assert.ok(value && typeof value !== "string");
  return `http://127.0.0.1:${value.port}`;
};
const close = (server: ReturnType<typeof createServer>) =>
  new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
const post = (base: string, path: string, payload: unknown, headers = {}) =>
  fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(payload),
  });

test("OTLP collectors persist usage without creating lifecycle events; Wi-Fi never receives prompt text or emails", async () => {
  const directory = mkdtempSync(join(tmpdir(), "harbor-telemetry-api-"));
  const stores = openTelemetryStores(directory),
    signals = new SignalStore(directory);
  const queries = new TelemetryQueries(directory);
  await queries.ready;
  const receiver = createReceiver(() => [], signals),
    api = createTelemetryApi(queries, signals);
  let peer = "127.0.0.1";
  const server = createServer((req, res) => {
    Object.defineProperty(req.socket, "remoteAddress", {
      configurable: true,
      value: peer,
    });
    void api(req, res).then((handled) => {
      if (!handled) void receiver.handle(req, res);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const exporters = await startTelemetryReceivers(stores, {
    claude: 0,
    codex: 0,
  });
  try {
    const base = address(server);
    assert.equal(
      (await post(address(exporters[0]), "/v1/metrics", metric())).status,
      200,
    );
    assert.equal(
      (await post(address(exporters[0]), "/v1/logs", logs())).status,
      200,
    );
    assert.equal(
      (await post(address(exporters[0]), "/v1/logs", logs(), { Origin: base }))
        .status,
      403,
    );
    assert.equal(
      (await post(address(exporters[1]), "/v1/logs", codexLogs)).status,
      200,
    );
    assert.equal(
      (await post(address(exporters[1]), "/v1/metrics", metric())).status,
      404,
    );
    const foreignHost = await new Promise<number | undefined>(
      (resolve, reject) => {
        const req = request(
          address(exporters[0]) + "/v1/logs",
          {
            method: "POST",
            headers: {
              Host: "foreign.test",
              "Content-Type": "application/json",
            },
          },
          (res) => {
            res.resume();
            res.on("end", () => resolve(res.statusCode));
          },
        );
        req.on("error", reject);
        req.end("{}");
      },
    );
    assert.equal(foreignHost, 403);
    assert.equal(
      (
        await post(address(exporters[0]), "/v1/logs", {
          huge: "x".repeat(2_000_001),
        })
      ).status,
      413,
    );
    assert.equal(signals.recent().length, 0);
    const event = {
      source: "claude-code",
      sessionId: "shared",
      sessionName: "Explicit hook title",
      projectName: "Harbor",
      type: "waiting",
      message: "Needs input.",
    };
    assert.equal((await post(base, "/api/events", event)).status, 201);
    await post(base, "/api/events", {
      ...event,
      source: "codex",
      sessionName: "Separate Codex title",
      type: "ready",
    });
    const local = JSON.stringify(
      await (
        await fetch(`${base}/api/telemetry/claude/sessions/shared?days=all`)
      ).json(),
    );
    assert.ok(local.includes("A private task description"));
    assert.ok(local.includes("owner@example.test"));
    assert.ok(local.includes("Explicit hook title"));
    const rebindStatus = await new Promise<number | undefined>(
      (resolve, reject) => {
        const req = request(
          base + "/api/telemetry/claude/accounts",
          { headers: { Host: "foreign.test", Origin: "http://foreign.test" } },
          (res) => {
            res.resume();
            res.on("end", () => resolve(res.statusCode));
          },
        );
        req.on("error", reject);
        req.end();
      },
    );
    assert.equal(rebindStatus, 403);
    const codex = (await (
      await fetch(`${base}/api/telemetry/codex/sessions?days=all`)
    ).json()) as { sessions: { name: string }[] };
    assert.equal(codex.sessions[0].name, "Separate Codex title");
    for (const remote of [
      "192.168.1.25",
      "::ffff:192.168.1.25",
      "2001:db8::1",
    ]) {
      peer = remote;
      const response = await fetch(
        `${base}/api/telemetry/claude/sessions/shared?days=all`,
        { headers: { "X-Forwarded-For": "127.0.0.1" } },
      );
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.ok(
        !text.includes("A private task description") &&
          !text.includes("owner@example.test"),
      );
      assert.equal(
        (await fetch(`${base}/api/telemetry/claude/accounts`)).status,
        403,
      );
    }
    assert.equal(
      (await fetch(`${base}/api/telemetry/codex?days=nonsense`)).status,
      400,
    );
    assert.equal(
      (
        await fetch(`${base}/api/telemetry/codex`, {
          headers: { Origin: "https://foreign.test" },
        })
      ).status,
      403,
    );
    assert.equal((await fetch(`${base}/api/history?offset=-1`)).status, 400);
    assert.equal(
      signals.recent()[0].type,
      "waiting",
      "usage never clears a permission wait",
    );
    assert.equal(signals.recent().length, 2);
    assert.equal(statSync(directory).mode & 0o777, 0o700);
    assert.equal(
      statSync(join(directory, "claude.sqlite3")).mode & 0o777,
      0o600,
    );
  } finally {
    receiver.close();
    await close(server);
    await closeTelemetryReceivers(exporters);
    await queries.close();
    signals.close();
    stores.claude.close();
    stores.codex.close();
  }
  const reopened = openTelemetryStores(directory),
    history = new SignalStore(directory);
  try {
    assert.equal(reopened.claude.sessions(null).sessions[0].inputTokens, 12);
    assert.equal(history.recent().length, 2);
  } finally {
    history.close();
    reopened.claude.close();
    reopened.codex.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("history merging deduplicates overlapping Minecode/dashboard records, preserves newer titles and deletion markers", async () => {
  const directory = mkdtempSync(join(tmpdir(), "harbor-telemetry-import-"));
  const oldDir = join(directory, "old"),
    newDir = join(directory, "new");
  const old = openTelemetryStores(oldDir),
    target = openTelemetryStores(newDir);
  target.claude.close();
  target.codex.close();
  try {
    old.claude.ingestMetrics(metric());
    old.claude.ingestLogs(logs());
    old.claude.setTitle("shared", "Original", at);
    old.codex.ingestLogs(codexLogs);
    const sourcePath = join(oldDir, "claude.sqlite3"),
      targetPath = join(newDir, "claude.sqlite3");
    const first = await mergeTelemetryHistory("claude", sourcePath, targetPath);
    assert.equal(first.inserted, 2);
    assert.equal(
      (await mergeTelemetryHistory("claude", sourcePath, targetPath)).inserted,
      0,
    );
    old.claude.setTitle("shared", "Renamed", at + 1);
    await mergeTelemetryHistory("claude", sourcePath, targetPath);
    await mergeTelemetryHistory(
      "codex",
      join(oldDir, "codex.sqlite3"),
      join(newDir, "codex.sqlite3"),
    );
    const merged = openTelemetryStores(newDir);
    assert.equal(merged.claude.sessions(null).sessions[0].title, "Renamed");
    assert.equal(merged.claude.sessions(null).sessions[0].inputTokens, 12);
    assert.equal(merged.codex.sessions(null).sessions[0].prompts, 1);
    merged.claude.close();
    merged.codex.close();
    old.claude.deleteSession("shared");
    old.codex.deleteConversation("shared");
    await mergeTelemetryHistory("claude", sourcePath, targetPath);
    await mergeTelemetryHistory(
      "codex",
      join(oldDir, "codex.sqlite3"),
      join(newDir, "codex.sqlite3"),
    );
    const deleted = openTelemetryStores(newDir);
    deleted.claude.ingestMetrics(metric());
    deleted.codex.ingestLogs(codexLogs);
    assert.equal(deleted.claude.sessions(null).sessions.length, 0);
    assert.equal(deleted.codex.sessions(null).sessions.length, 0);
    deleted.claude.close();
    deleted.codex.close();
    assert.equal(
      old.claude.sessions(null).sessions.length,
      0,
      "source remains usable and unmodified by import",
    );
  } finally {
    old.claude.close();
    old.codex.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

async function unusedPort() {
  const server = createSocketServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const value = server.address();
  assert.ok(value && typeof value !== "string");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return value.port;
}

test("Vite restart/close releases telemetry listeners and stores; partial startup rolls back the first port", async () => {
  const directory = mkdtempSync(join(tmpdir(), "harbor-telemetry-lifecycle-"));
  const ports = { claude: await unusedPort(), codex: await unusedPort() };
  const backend = harborBackend({ directory, ports });
  const vite = await createViteServer({
    configFile: false,
    root: directory,
    logLevel: "silent",
    plugins: [backend],
    server: { host: "127.0.0.1", port: 0 },
    optimizeDeps: { noDiscovery: true },
  });
  try {
    await vite.listen();
    await backend.api.ready();
    const httpAddress = address(vite.httpServer!);
    const databaseResponse = await fetch(`${httpAddress}/claude.sqlite3`);
    assert.equal(
      databaseResponse.status,
      403,
      "Vite must never serve raw private databases",
    );
    assert.equal(
      (await post(`http://127.0.0.1:${ports.claude}`, "/v1/metrics", metric()))
        .status,
      200,
    );
    await vite.restart();
    await backend.api.ready();
    assert.equal(
      (await post(`http://127.0.0.1:${ports.claude}`, "/v1/metrics", metric()))
        .status,
      200,
    );
  } finally {
    await vite.close();
  }
  const stores = openTelemetryStores(directory);
  assert.equal(stores.claude.sessions(null).sessions[0].inputTokens, 12);
  const listeners = await startTelemetryReceivers(stores, ports);
  await closeTelemetryReceivers(listeners);
  const blocker = createServer();
  blocker.listen(ports.codex, "127.0.0.1");
  await once(blocker, "listening");
  try {
    await assert.rejects(
      startTelemetryReceivers(stores, ports),
      /Stop the old telemetry/,
    );
  } finally {
    await close(blocker);
  }
  const again = await startTelemetryReceivers(stores, ports);
  await closeTelemetryReceivers(again);
  stores.claude.close();
  stores.codex.close();
  const raw = new Database(join(directory, "claude.sqlite3"));
  raw.pragma("wal_checkpoint(TRUNCATE)");
  raw.close();
  rmSync(directory, { recursive: true, force: true });
});

test("signal history persists beyond the live window and restores names without sharing approval state", async () => {
  const directory = mkdtempSync(join(tmpdir(), "harbor-signal-history-"));
  let store = new SignalStore(directory);
  const make = (index: number): HarborEvent => ({
    id: String(index),
    source: "codex",
    sessionId: "one",
    sessionName: "Saved name",
    type: "ready",
    message: "Ready.",
    receivedAt: new Date(at + index).toISOString(),
  });
  for (let index = 0; index < 505; index++) store.append(make(index));
  store.append(make(0));
  store.close();
  store = new SignalStore(directory);
  try {
    assert.equal(store.recent().length, 500);
    assert.equal(store.history(null, null, 500).events.length, 5);
    assert.equal(store.history(null, null, 0).total, 505);
    assert.equal(store.metadata("codex", "one")?.sessionName, "Saved name");
    assert.equal(store.metadata("claude-code", "one"), undefined);
    const page = store.history(null, null, 0);
    store.append(make(505));
    const next = store.history(null, null, 0, page.events.at(-1)!.id);
    assert.equal(
      next.events[0].id,
      "454",
      "new arrivals do not shift older history pages",
    );
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("query worker refreshes cached usage after ingestion and closes with no pending requests", async () => {
  const directory = mkdtempSync(join(tmpdir(), "harbor-query-worker-"));
  const stores = openTelemetryStores(directory),
    queries = new TelemetryQueries(directory);
  try {
    await queries.ready;
    assert.equal((await queries.request("summary", "claude", "all")).tokens, 0);
    stores.claude.ingestMetrics(metric());
    queries.invalidate();
    assert.equal(
      (await queries.request("summary", "claude", "all")).tokens,
      12,
    );
    stores.claude.ingestMetrics(metric("other"));
    queries.invalidate();
    const [summary, sessions] = await Promise.all([
      queries.request("summary", "claude", "all"),
      queries.request("sessions", "claude", "all"),
    ]);
    assert.equal(summary.tokens, 24);
    assert.equal(sessions.length, 2);
    await queries.close();
    await assert.rejects(
      queries.request("summary", "claude", "all"),
      /busy or closed/,
    );
  } finally {
    await queries.close();
    stores.claude.close();
    stores.codex.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test(
  "backend startup failure closes its worker, dashboard and partially opened collectors",
  { timeout: 15_000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "harbor-startup-rollback-"));
    const ports = { claude: await unusedPort(), codex: await unusedPort() };
    const blocker = createServer();
    blocker.listen(ports.codex, "127.0.0.1");
    await once(blocker, "listening");
    const backend = harborBackend({ directory, ports });
    const vite = await createViteServer({
      configFile: false,
      root: directory,
      logLevel: "silent",
      plugins: [backend],
      server: { host: "127.0.0.1", port: 0 },
      optimizeDeps: { noDiscovery: true },
    });
    try {
      await vite.listen();
      await assert.rejects(backend.api.ready(), /Stop the old telemetry/);
      await vite.close();
      assert.equal(vite.httpServer!.listening, false);
      await close(blocker);
      const stores = openTelemetryStores(directory);
      try {
        const listeners = await startTelemetryReceivers(stores, ports);
        await closeTelemetryReceivers(listeners);
      } finally {
        stores.claude.close();
        stores.codex.close();
      }
    } finally {
      await vite.close();
      if (blocker.listening) await close(blocker);
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
