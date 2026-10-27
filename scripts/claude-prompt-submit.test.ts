import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createReceiver } from "../server/receiver.ts";
import type { HarborEvent } from "../src/events.ts";
import { createClaudeHooks } from "./claude-hooks.ts";

const project = fileURLToPath(new URL("../", import.meta.url));
const settings = { hooks: createClaudeHooks() };

async function runHook(
  hook: "Stop" | "UserPromptSubmit",
  input: unknown,
  port: number,
) {
  const child = spawn("sh", ["-c", settings.hooks[hook][0].hooks[0].command], {
    cwd: project,
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: project,
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
  assert.equal(stdout, "", "Observer must not add context or block a prompt.");
  return stderr;
}

test(
  "a follow-up prompt replaces ready with activity without forwarding prompt text",
  { timeout: 20_000 },
  async (t) => {
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
      cwd: "/private-parent/HarborProject",
      hook_event_name: "UserPromptSubmit",
      prompt: "private-prompt-text",
      session_id: "prompt-test-session",
      session_title: "Harbor prompt check",
      transcript_path: "/private/prompt-transcript.jsonl",
    };
    const registration = settings.hooks.UserPromptSubmit[0];
    assert.equal(registration.hooks[0].async, true);
    assert.equal(Object.hasOwn(registration, "matcher"), false);

    // An initial response, a follow-up, and its response share one session.
    assert.equal(
      await runHook("Stop", { ...payload, hook_event_name: "Stop" }, port),
      "",
    );
    assert.equal(await runHook("UserPromptSubmit", payload, port), "");
    const controller = new AbortController();
    const stream = await fetch(`http://127.0.0.1:${port}/api/stream`, {
      signal: controller.signal,
    });
    const chunk = await stream.body!.getReader().read();
    const snapshot = new TextDecoder().decode(chunk.value);
    controller.abort();
    assert.doesNotMatch(
      snapshot,
      /private-|prompt:|session_title|transcript_path/,
    );
    const history = JSON.parse(
      snapshot.split("data: ")[1].trim(),
    ) as HarborEvent[];
    assert.deepEqual(
      history.map((event) => event.type),
      ["ready", "activity"],
    );
    assert.ok(
      history.every((event) => event.sessionId === "prompt-test-session"),
    );
    const { id, receivedAt, ...event } = history[1];
    assert.ok(id);
    assert.ok(Number.isFinite(Date.parse(receivedAt)));
    assert.deepEqual(event, {
      message: "Claude Code received a prompt.",
      projectName: "HarborProject",
      sessionId: "prompt-test-session",
      sessionName: "Harbor prompt check",
      source: "claude-code",
      type: "activity",
    });

    // Ignore unrelated events; reject malformed input without affecting Claude.
    assert.equal(
      await runHook(
        "UserPromptSubmit",
        { ...payload, hook_event_name: "Stop" },
        port,
      ),
      "",
    );
    for (const input of [
      "{",
      null,
      [],
      { ...payload, session_id: " " },
      { ...payload, session_id: 42 },
      { ...payload, session_id: "x".repeat(121) },
    ]) {
      assert.match(
        await runHook("UserPromptSubmit", input, port),
        /not delivered/,
      );
    }
    assert.equal(
      await runHook("Stop", { ...payload, hook_event_name: "Stop" }, port),
      "",
    );
    const replayController = new AbortController();
    const replay = await fetch(`http://127.0.0.1:${port}/api/stream`, {
      signal: replayController.signal,
    });
    const replayChunk = await replay.body!.getReader().read();
    const replaySnapshot = new TextDecoder().decode(replayChunk.value);
    replayController.abort();
    const replayHistory = JSON.parse(
      replaySnapshot.split("data: ")[1].trim(),
    ) as HarborEvent[];
    assert.deepEqual(
      replayHistory.map((item) => item.type),
      ["ready", "activity", "ready"],
    );

    assert.ok(
      replayHistory
        .slice(1)
        .every((item) => item.sessionName === "Harbor prompt check"),
    );

    rejectRequests = true;
    assert.match(
      await runHook("UserPromptSubmit", payload, port),
      /not delivered/,
    );
    const stalledServer = createServer(() => {});
    stalledServer.listen(0, "127.0.0.1");
    await once(stalledServer, "listening");
    t.after(() => {
      stalledServer.closeAllConnections();
      stalledServer.close();
    });
    const stalledAddress = stalledServer.address();
    assert.ok(stalledAddress && typeof stalledAddress === "object");
    assert.match(
      await runHook("UserPromptSubmit", payload, stalledAddress.port),
      /not delivered/,
    );

    receiver.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    assert.match(
      await runHook("UserPromptSubmit", payload, port),
      /not delivered/,
    );
  },
);
