import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createReceiver } from "../server/receiver.ts";
import type { HarborEvent } from "../src/events.ts";

const settings = JSON.parse(
  await readFile(new URL("../.codex/hooks.json", import.meta.url), "utf8"),
);

async function runConfiguredHook(
  input: unknown,
  port: number | string,
  codexHome: string,
) {
  const child = spawn("sh", ["-c", settings.hooks.Stop[0].hooks[0].command], {
    // Exercise the actual registration from a repository subdirectory.
    cwd: fileURLToPath(new URL("./", import.meta.url)),
    env: {
      ...process.env,
      CODEX_HOME: codexHome,
      HARBOR_PORT: String(port),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  let stdout = "";
  child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
  child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
  child.stdin.end(typeof input === "string" ? input : JSON.stringify(input));
  const [code] = await once(child, "close");
  assert.equal(code, 0, stderr);
  assert.equal(stdout, "", "Observer must not return context or decisions.");
  assert.doesNotMatch(stderr, /private-/);
  return stderr;
}

test(
  "Codex Stop delivers only a main response event and fails without blocking",
  { timeout: 30_000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "harbor-codex-ready-"));
    t.after(() => rm(directory, { force: true, recursive: true }));
    const indexPath = join(directory, "session_index.jsonl");
    const runHook = (input: unknown, port: number | string) =>
      runConfiguredHook(input, port, directory);
    let rejectRequests = false;
    const receiver = createReceiver();
    const server = createServer((req, res) => {
      if (rejectRequests && req.method === "POST") {
        res.writeHead(503);
        res.end();
        return;
      }
      void receiver.handle(req, res).then((handled) => {
        if (!handled) {
          res.writeHead(404);
          res.end();
        }
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(() => {
      receiver.close();
      server.closeAllConnections();
      server.close();
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const port = address.port;
    const payload = {
      cwd: "/private-codex-project",
      hook_event_name: "Stop",
      last_assistant_message: "private-assistant-response",
      model: "private-model",
      permission_mode: "default",
      session_id: " codex-reply-test-session ",
      stop_hook_active: false,
      transcript_path: "/private-transcript.jsonl",
      turn_id: "private-turn-id",
    };

    assert.deepEqual(Object.keys(settings.hooks), [
      "PermissionRequest",
      "Stop",
      "UserPromptSubmit",
    ]);
    assert.equal(settings.hooks.Stop.length, 1);
    assert.equal(settings.hooks.Stop[0].hooks.length, 1);
    assert.equal(settings.hooks.Stop[0].hooks[0].async, true);
    assert.equal(settings.hooks.Stop[0].hooks[0].type, "command");
    assert.equal(Object.hasOwn(settings.hooks.Stop[0], "matcher"), false);
    assert.equal(await runHook(payload, port), "");
    await writeFile(indexPath, "{partially-written-metadata");
    assert.equal(
      await runHook({ ...payload, stop_hook_active: true }, port),
      "",
    );
    for (const hook_event_name of [
      "Interrupt",
      "PostToolUse",
      "SessionEnd",
      "StopFailure",
      "SubagentStop",
    ]) {
      assert.equal(await runHook({ ...payload, hook_event_name }, port), "");
    }
    for (const input of [
      "{",
      null,
      [],
      { ...payload, session_id: "" },
      { ...payload, session_id: 1 },
      { ...payload, session_id: "x".repeat(121) },
    ]) {
      assert.match(await runHook(input, port), /not delivered/);
    }
    for (const invalidPort of ["invalid", "0", "65536", "1.5"]) {
      assert.match(await runHook(payload, invalidPort), /not delivered/);
    }

    await writeFile(
      indexPath,
      [
        { id: "another-session", thread_name: "private-other-session-name" },
        { id: "codex-reply-test-session", thread_name: "Harbor name check" },
      ]
        .map((entry) => JSON.stringify(entry))
        .join("\n") + "\n",
    );
    assert.equal(await runHook(payload, port), "");
    await appendFile(
      indexPath,
      JSON.stringify({
        id: "codex-reply-test-session",
        thread_name: "Harbor renamed",
      }) + "\n",
    );
    assert.equal(await runHook(payload, port), "");

    const controller = new AbortController();
    const stream = await fetch(`http://127.0.0.1:${port}/api/stream`, {
      signal: controller.signal,
    });
    const chunk = await stream.body!.getReader().read();
    const snapshot = new TextDecoder().decode(chunk.value);
    controller.abort();
    assert.doesNotMatch(
      snapshot,
      /private-|last_assistant_message|transcript_path/,
    );
    const history = JSON.parse(
      snapshot.split("data: ")[1].trim(),
    ) as HarborEvent[];
    assert.equal(history.length, 4);
    for (const [position, { id, receivedAt, ...event }] of history.entries()) {
      assert.ok(id);
      assert.ok(Number.isFinite(Date.parse(receivedAt)));
      assert.deepEqual(event, {
        message: "Codex finished its response.",
        sessionId: "codex-reply-test-session",
        ...(position === 2
          ? { sessionName: "Harbor name check" }
          : position === 3
            ? { sessionName: "Harbor renamed" }
            : {}),
        source: "codex",
        type: "ready",
      });
    }

    rejectRequests = true;
    assert.match(await runHook(payload, port), /not delivered/);
    const stalledServer = createServer(() => {});
    stalledServer.listen(0, "127.0.0.1");
    await once(stalledServer, "listening");
    t.after(() => {
      stalledServer.closeAllConnections();
      stalledServer.close();
    });
    const stalledAddress = stalledServer.address();
    assert.ok(stalledAddress && typeof stalledAddress === "object");
    assert.match(await runHook(payload, stalledAddress.port), /not delivered/);

    receiver.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    assert.match(await runHook(payload, port), /not delivered/);
  },
);
