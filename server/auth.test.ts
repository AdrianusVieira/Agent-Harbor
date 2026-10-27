import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import { BrowserAuth } from "./auth.ts";
import { AuthStore, SESSION_SECONDS } from "./authStore.ts";
import { createReceiver } from "./receiver.ts";
import { SignalStore } from "./signalStore.ts";
import { createTelemetryApi } from "./telemetryApi.ts";
import { TelemetryQueries } from "./telemetryQueries.ts";
import { openTelemetryStores } from "./telemetryStore.ts";

const username = "harbor-test",
  password = "synthetic password for tests only";

test("local credentials are salted hashes; session tokens are hashed, expire, survive restart and revoke on reset", async () => {
  const directory = mkdtempSync(join(tmpdir(), "harbor-auth-store-"));
  let store = new AuthStore(directory);
  try {
    assert.equal(store.configured(), false);
    await assert.rejects(
      store.createOwner("x", "short"),
      /Invalid credentials/,
    );
    assert.equal(await store.createOwner(username, password), true);
    assert.equal(
      await store.createOwner("another-user", "another long password"),
      false,
    );
    assert.equal(await store.verify("wrong-user", password), null);
    assert.equal(await store.verify(username, "wrong long password"), null);
    const generation = await store.verify(username, password);
    assert.ok(generation);
    const token = store.createSession(generation)!;
    assert.ok(token);
    assert.equal(store.session(token)?.username, username);
    store.close();
    store = new AuthStore(directory);
    assert.equal(store.session(token)?.username, username);
    assert.equal(
      store.session(token, Date.now() + SESSION_SECONDS * 1000 + 1000),
      null,
    );
    const db = new Database(join(directory, "auth.sqlite3"), {
      readonly: true,
    });
    const owner = db.prepare("SELECT * FROM owner").get() as Record<
      string,
      string
    >;
    const session = db
      .prepare("SELECT * FROM browser_sessions")
      .get() as Record<string, string>;
    assert.equal(owner.salt.length, 32);
    assert.equal(owner.password_hash.length, 64);
    assert.ok(!JSON.stringify(owner).includes(password));
    assert.ok(!JSON.stringify(session).includes(token));
    db.close();
    assert.equal(statSync(join(directory, "auth.sqlite3")).mode & 0o777, 0o600);
    store.logout(token);
    assert.equal(store.session(token), null);
    const nextToken = store.createSession(generation)!;
    store.reset();
    assert.equal(store.session(nextToken), null);
    assert.equal(store.configured(), false);
    await store.createOwner(username, "replacement password for tests");
    assert.equal(
      store.createSession(generation),
      null,
      "an in-flight old login cannot recreate a session after reset",
    );
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test(
  "login gates browser data, grants Wi-Fi accounts, preserves local hooks, and blocks revoked SSE delivery",
  { timeout: 20_000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "harbor-auth-api-"));
    const stores = openTelemetryStores(directory),
      signals = new SignalStore(directory),
      auth = new BrowserAuth(directory),
      queries = new TelemetryQueries(directory);
    await queries.ready;
    stores.claude.ingestLogs({
      resourceLogs: [
        {
          scopeLogs: [
            {
              logRecords: [
                {
                  timeUnixNano: String(BigInt(Date.now()) * 1_000_000n),
                  body: { stringValue: "claude_code.user_prompt" },
                  attributes: Object.entries({
                    "session.id": "private-fixture",
                    "user.email": "owner@example.test",
                    prompt: "Synthetic private prompt",
                  }).map(([key, value]) => ({
                    key,
                    value: { stringValue: value },
                  })),
                },
              ],
            },
          ],
        },
      ],
    });
    const receiver = createReceiver(
      () => [],
      signals,
      (req) => auth.authenticated(req),
    );
    const telemetry = createTelemetryApi(queries, signals, (req) =>
      auth.authenticated(req),
    );
    let peer = "127.0.0.1";
    const server = createServer((req, res) => {
      Object.defineProperty(req.socket, "remoteAddress", {
        configurable: true,
        value: peer,
      });
      void auth.protect(req, res).then(async (handled) => {
        if (
          handled ||
          (await telemetry(req, res)) ||
          (await receiver.handle(req, res))
        )
          return;
        res.writeHead(404);
        res.end();
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const call = (
      path: string,
      options: {
        method?: string;
        body?: unknown;
        headers?: Record<string, string>;
      } = {},
    ) =>
      new Promise<{ status: number; body: string; cookie?: string }>(
        (resolve, reject) => {
          const req = request(
            base + path,
            {
              method: options.method ?? "GET",
              headers: {
                ...(options.body ? { "Content-Type": "application/json" } : {}),
                ...options.headers,
              },
            },
            (res) => {
              let body = "";
              res.setEncoding("utf8");
              res.on("data", (chunk) => (body += chunk));
              res.on("end", () =>
                resolve({
                  status: res.statusCode!,
                  body,
                  cookie: res.headers["set-cookie"]?.[0],
                }),
              );
            },
          );
          req.on("error", reject);
          req.end(options.body ? JSON.stringify(options.body) : undefined);
        },
      );
    const login = (path = "login", headers: Record<string, string> = {}) =>
      call(`/api/auth/${path}`, {
        method: "POST",
        headers: { Origin: base, ...headers },
        body: { username, password },
      });
    const event = {
      source: "codex",
      sessionId: "auth-fixture",
      type: "ready",
      message: "Ready.",
    };
    const controller = new AbortController();
    try {
      const initial = await call("/api/auth/session");
      assert.equal(initial.status, 200);
      assert.deepEqual(JSON.parse(initial.body), {
        configured: false,
        canSetup: true,
        authenticated: false,
      });
      for (const path of [
        "/api/stream",
        "/api/network",
        "/api/history",
        "/api/telemetry/claude/accounts",
        "/api/events",
      ])
        assert.equal((await call(path)).status, 401, path);
      assert.equal(
        (await call("/api/events", { method: "POST", body: event })).status,
        201,
        "local hook continues before setup",
      );
      assert.equal(
        (
          await call("/api/events", {
            method: "POST",
            body: event,
            headers: { Origin: base },
          })
        ).status,
        403,
      );
      peer = "192.168.1.80";
      assert.equal((await login("setup")).status, 403);
      assert.equal(
        JSON.parse((await call("/api/auth/session")).body).canSetup,
        false,
      );
      peer = "127.0.0.1";
      assert.equal(
        (await login("setup", { Origin: "http://foreign.test" })).status,
        403,
      );
      assert.equal(
        (
          await login("setup", {
            Host: "foreign.test",
            Origin: "http://foreign.test",
          })
        ).status,
        403,
      );
      const setup = await login("setup");
      assert.equal(setup.status, 200);
      assert.match(setup.cookie!, /HttpOnly/);
      assert.match(setup.cookie!, /SameSite=Strict/);
      assert.match(setup.cookie!, /Max-Age=43200/);
      const cookie = setup.cookie!.split(";")[0];
      assert.equal((await login("setup")).status, 409);
      assert.equal(
        (
          await call("/api/auth/login", {
            method: "POST",
            body: { username, password },
          })
        ).status,
        403,
        "login requires the browser origin",
      );
      const otherLogin = await login();
      assert.equal(otherLogin.status, 200);
      assert.notEqual(otherLogin.cookie, setup.cookie);
      assert.equal(
        (
          await call("/api/history", {
            headers: { Cookie: cookie, Origin: "http://foreign.test" },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await call("/api/history", {
            headers: { Cookie: cookie, Host: "foreign.test" },
          })
        ).status,
        403,
      );
      peer = "192.168.1.80";
      const accounts = await call("/api/telemetry/claude/accounts", {
        headers: { Cookie: cookie, Host: `192.168.1.20:${address.port}` },
      });
      assert.equal(
        accounts.status,
        200,
        "a valid Wi-Fi session can read accounts",
      );
      assert.ok(accounts.body.includes("owner@example.test"));
      const privateView = await call(
        "/api/telemetry/claude/sessions/private-fixture?days=all",
        {
          headers: { Cookie: cookie, Host: `192.168.1.20:${address.port}` },
        },
      );
      assert.equal(privateView.status, 200);
      assert.ok(privateView.body.includes("Synthetic private prompt"));
      assert.equal(
        (
          await call("/api/events", {
            method: "POST",
            body: event,
            headers: { Cookie: cookie },
          })
        ).status,
        403,
        "login cannot grant LAN event submission",
      );
      const stream = await fetch(base + "/api/stream", {
        headers: { Cookie: cookie },
        signal: controller.signal,
      });
      assert.equal(stream.status, 200);
      const reader = stream.body!.getReader();
      const first = await reader.read();
      assert.ok(new TextDecoder().decode(first.value).includes("snapshot"));
      assert.equal(
        (
          await call("/api/auth/logout", {
            method: "POST",
            headers: { Origin: base, Cookie: cookie },
          })
        ).status,
        200,
      );
      assert.equal(
        (await call("/api/history", { headers: { Cookie: cookie } })).status,
        401,
      );
      peer = "127.0.0.1";
      await call("/api/events", { method: "POST", body: event });
      assert.equal(
        (await reader.read()).done,
        true,
        "a revoked stream gets no new event",
      );
      const store = new AuthStore(directory);
      store.reset();
      store.close();
      assert.equal(
        (
          await call("/api/history", {
            headers: { Cookie: otherLogin.cookie!.split(";")[0] },
          })
        ).status,
        401,
      );
      assert.equal(
        signals.history(null, null, 0).total,
        2,
        "reset preserved signal history",
      );
    } finally {
      controller.abort();
      receiver.close();
      await auth.close();
      await queries.close();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      signals.close();
      stores.claude.close();
      stores.codex.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test("login attempts are bounded by actual socket peer, ignoring forwarded addresses", async () => {
  const directory = mkdtempSync(join(tmpdir(), "harbor-auth-limit-")),
    auth = new BrowserAuth(directory);
  const server = createServer((req, res) => {
    void auth.handle(req, res);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    for (let index = 0; index < 10; index++) {
      const response = await fetch(base + "/api/auth/login", {
        method: "POST",
        headers: {
          Origin: base,
          "Content-Type": "application/json",
          "X-Forwarded-For": `10.0.0.${index}`,
        },
        body: JSON.stringify({ username, password }),
      });
      assert.equal(response.status, 401);
    }
    const limited = await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: {
        Origin: base,
        "Content-Type": "application/json",
        "X-Forwarded-For": "10.0.0.99",
      },
      body: JSON.stringify({ username, password }),
    });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("Retry-After"), "600");
  } finally {
    await auth.close();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    rmSync(directory, { recursive: true, force: true });
  }
});
