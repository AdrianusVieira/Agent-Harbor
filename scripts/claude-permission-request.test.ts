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
const registration = settings.hooks.PermissionRequest[0];

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
  assert.equal(stdout, "", "Observer must never return an approval decision.");
  return stderr;
}

test(
  "permission hook reports waiting without forwarding tool arguments or making decisions",
  { timeout: 15_000 },
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
      cwd: "/private/example-project",
      hook_event_name: "PermissionRequest",
      permission_mode: "default",
      permission_suggestions: [{ behavior: "allow", type: "addRules" }],
      session_id: "permission-test-session",
      tool_input: {
        command: "echo private-command-argument",
        description: "private-description",
      },
      tool_name: "Bash",
      transcript_path: "/private/example-transcript.jsonl",
    };

    assert.equal(registration.matcher, "*");
    assert.equal(registration.hooks[0].async, true);
    assert.equal(await runHook(JSON.stringify(payload), port), "");
    assert.equal(
      await runHook(
        JSON.stringify({ ...payload, tool_name: "mcp__example__read" }),
        port,
      ),
      "",
    );

    // Only permission requests with valid identifiers should produce events.
    assert.equal(
      await runHook(
        JSON.stringify({ ...payload, hook_event_name: "PreToolUse" }),
        port,
      ),
      "",
    );
    assert.match(await runHook("{", port), /not delivered/);
    assert.match(
      await runHook(JSON.stringify({ ...payload, session_id: "" }), port),
      /not delivered/,
    );
    assert.match(
      await runHook(JSON.stringify({ ...payload, tool_name: 42 }), port),
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
    assert.equal(history.length, 2);
    assert.doesNotMatch(
      snapshot,
      /private-command-argument|private-description|example-project|example-transcript|permission_suggestions/,
    );
    assert.deepEqual(
      history.map(({ id, receivedAt, ...event }) => {
        assert.ok(id);
        assert.ok(Number.isFinite(Date.parse(receivedAt)));
        return event;
      }),
      [
        {
          message: "Claude Code requested permission to use Bash.",
          sessionId: "permission-test-session",
          source: "claude-code",
          type: "waiting",
        },
        {
          message:
            "Claude Code requested permission to use mcp__example__read.",
          sessionId: "permission-test-session",
          source: "claude-code",
          type: "waiting",
        },
      ],
    );

    // HTTP rejection must still exit normally without granting or denying anything.
    rejectRequests = true;
    assert.match(await runHook(JSON.stringify(payload), port), /not delivered/);

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

    receiver.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    assert.match(await runHook(JSON.stringify(payload), port), /not delivered/);
  },
);
