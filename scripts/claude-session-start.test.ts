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
const registration = settings.hooks.SessionStart[0];

// Exercise the actual configured shell command, including its project path.
async function runHook(input: string, port: number) {
  const child = spawn("sh", ["-c", registration.hooks[0].command], {
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
  child.stdin.end(input);
  const [code] = await once(child, "close");
  assert.equal(code, 0, stderr);
  assert.equal(stdout, "", "Hook must not inject context into Claude.");
  return stderr;
}

test(
  "Claude startup hook delivers only the intended event and tolerates failures",
  { timeout: 15_000 },
  async (t) => {
    const receiver = createReceiver();
    const server = createServer((req, res) => {
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
      hook_event_name: "SessionStart",
      session_id: "hook-test-session",
      session_title: "Harbor startup check",
      source: "startup",
      transcript_path: "/example/private-transcript.jsonl",
    };

    assert.equal(registration.matcher, "startup");
    assert.equal(registration.hooks[0].async, true);
    assert.equal(await runHook(JSON.stringify(payload), port), "");

    // Resumes and other lifecycle events must not be reported as new sessions.
    assert.equal(
      await runHook(JSON.stringify({ ...payload, source: "resume" }), port),
      "",
    );
    assert.equal(
      await runHook(
        JSON.stringify({ ...payload, hook_event_name: "Stop" }),
        port,
      ),
      "",
    );
    assert.match(await runHook("{", port), /not delivered/);
    assert.match(
      await runHook(JSON.stringify({ ...payload, session_id: "" }), port),
      /not delivered/,
    );

    const controller = new AbortController();
    const stream = await fetch(`http://127.0.0.1:${port}/api/stream`, {
      signal: controller.signal,
    });
    const chunk = await stream.body!.getReader().read();
    const snapshot = new TextDecoder().decode(chunk.value);
    controller.abort();
    const history = JSON.parse(
      snapshot.split("data: ")[1].trim(),
    ) as HarborEvent[];
    assert.equal(history.length, 1);
    const { id, receivedAt, ...event } = history[0];
    assert.ok(id);
    assert.ok(Number.isFinite(Date.parse(receivedAt)));
    assert.deepEqual(event, {
      message: "Claude Code session started.",
      projectName: "HarborProject",
      sessionId: "hook-test-session",
      sessionName: "Harbor startup check",
      source: "claude-code",
      type: "started",
    });

    // A stalled receiver must not keep the short-lived adapter running forever.
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
      await runHook(JSON.stringify(payload), stalledAddress.port),
      /not delivered/,
    );

    // Simulate Harbor being shut down, then invoke the same configured hook.
    receiver.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    assert.match(await runHook(JSON.stringify(payload), port), /not delivered/);
  },
);
