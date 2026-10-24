import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createReceiver } from "../server/receiver.ts";
import type { HarborEvent } from "../src/events.ts";

const project = fileURLToPath(new URL("../", import.meta.url));
const settings = JSON.parse(
  readFileSync(new URL("../.claude/settings.json", import.meta.url), "utf8"),
);

async function runHook(
  hook: "PostToolUse" | "Stop",
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
  assert.equal(
    stdout,
    "",
    "Stop observer must not return context or ask Claude to continue.",
  );
  return stderr;
}

test(
  "Stop reports a ready response without forwarding content or continuing Claude",
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
      background_tasks: [
        { command: "private-background-command", status: "running" },
      ],
      cwd: "/private/reply-project",
      hook_event_name: "Stop",
      last_assistant_message: "private-assistant-response",
      session_crons: [{ prompt: "private-scheduled-prompt" }],
      session_id: "reply-test-session",
      stop_hook_active: false,
      transcript_path: "/private/reply-transcript.jsonl",
    };

    assert.equal(settings.hooks.Stop[0].hooks[0].async, true);
    assert.equal(Object.hasOwn(settings.hooks.Stop[0], "matcher"), false);
    assert.equal(
      await runHook(
        "PostToolUse",
        { ...payload, hook_event_name: "PostToolUse", tool_name: "Bash" },
        port,
      ),
      "",
    );
    assert.equal(await runHook("Stop", payload, port), "");
    // Observation does not block, even when another Stop hook continued a prior turn.
    assert.equal(
      await runHook("Stop", { ...payload, stop_hook_active: true }, port),
      "",
    );

    for (const hook_event_name of [
      "SessionEnd",
      "StopFailure",
      "SubagentStop",
    ]) {
      assert.equal(
        await runHook("Stop", { ...payload, hook_event_name }, port),
        "",
      );
    }
    assert.match(await runHook("Stop", "{", port), /not delivered/);
    assert.match(
      await runHook("Stop", { ...payload, session_id: "" }, port),
      /not delivered/,
    );

    const controller = new AbortController();
    const stream = await fetch(`http://127.0.0.1:${port}/api/stream`, {
      signal: controller.signal,
    });
    const chunk = await stream.body!.getReader().read();
    const snapshot = new TextDecoder().decode(chunk.value);
    controller.abort();
    assert.doesNotMatch(
      snapshot,
      /private-|background_tasks|session_crons|last_assistant_message|transcript_path/,
    );
    const history = JSON.parse(
      snapshot.split("data: ")[1].trim(),
    ) as HarborEvent[];
    assert.deepEqual(
      history.map((event) => event.type),
      ["activity", "ready", "ready"],
    );
    assert.ok(
      history.every(
        (event) =>
          event.sessionId === "reply-test-session" &&
          event.source === "claude-code",
      ),
    );
    for (const { id, receivedAt, ...event } of history.slice(1)) {
      assert.ok(id);
      assert.ok(Number.isFinite(Date.parse(receivedAt)));
      assert.deepEqual(event, {
        message: "Claude Code finished its response.",
        sessionId: "reply-test-session",
        source: "claude-code",
        type: "ready",
      });
    }

    rejectRequests = true;
    assert.match(await runHook("Stop", payload, port), /not delivered/);
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
      await runHook("Stop", payload, stalledAddress.port),
      /not delivered/,
    );

    receiver.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    assert.match(await runHook("Stop", payload, port), /not delivered/);
  },
);
