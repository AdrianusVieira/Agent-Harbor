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
type HookName = "PermissionRequest" | "PostToolUse" | "PostToolUseFailure";

async function runHook(hook: HookName, input: unknown, port: number) {
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
  child.stdin.end(JSON.stringify(input));
  const [code] = await once(child, "close");
  assert.equal(code, 0, stderr);
  assert.equal(
    stdout,
    "",
    "Tool observer must not return decisions or context.",
  );
  return stderr;
}

test(
  "waiting is followed by observed tool success or failure for the same session",
  { timeout: 20_000 },
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
      cwd: "/private/tool-result-project",
      hook_event_name: "PermissionRequest",
      session_id: "result-test-session",
      tool_input: { command: "echo private-tool-argument" },
      tool_name: "Bash",
      transcript_path: "/private/tool-result-transcript.jsonl",
    };

    for (const hook of ["PostToolUse", "PostToolUseFailure"] as const) {
      assert.equal(settings.hooks[hook][0].matcher, "*");
      assert.equal(settings.hooks[hook][0].hooks[0].async, true);
    }

    // A pre-execution event must not turn a pending approval into "working".
    assert.equal(await runHook("PermissionRequest", payload, port), "");
    assert.equal(
      await runHook(
        "PostToolUse",
        { ...payload, hook_event_name: "PreToolUse" },
        port,
      ),
      "",
    );
    assert.equal(
      await runHook(
        "PostToolUse",
        {
          ...payload,
          hook_event_name: "PostToolUse",
          tool_response: { output: "private-tool-output" },
          tool_use_id: "private-tool-use-id",
        },
        port,
      ),
      "",
    );

    assert.equal(await runHook("PermissionRequest", payload, port), "");
    assert.equal(
      await runHook(
        "PostToolUseFailure",
        {
          ...payload,
          error: "private-tool-error",
          hook_event_name: "PostToolUseFailure",
          is_interrupt: false,
        },
        port,
      ),
      "",
    );
    assert.equal(await runHook("PermissionRequest", payload, port), "");
    assert.equal(
      await runHook(
        "PostToolUseFailure",
        {
          ...payload,
          error: "private-interruption-detail",
          hook_event_name: "PostToolUseFailure",
          is_interrupt: true,
        },
        port,
      ),
      "",
    );

    // Other events, including denials, must not be reported as successful execution.
    assert.equal(
      await runHook(
        "PostToolUse",
        { ...payload, hook_event_name: "PermissionDenied" },
        port,
      ),
      "",
    );
    assert.match(
      await runHook(
        "PostToolUse",
        { ...payload, hook_event_name: "PostToolUse", tool_name: "" },
        port,
      ),
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
      /private-tool-|private-interruption-detail|tool_response|tool_use_id/,
    );
    const history = JSON.parse(
      snapshot.split("data: ")[1].trim(),
    ) as HarborEvent[];
    assert.deepEqual(
      history.map((event) => event.type),
      ["waiting", "activity", "waiting", "error", "waiting", "error"],
    );
    assert.ok(
      history.every(
        (event) =>
          event.sessionId === "result-test-session" &&
          event.source === "claude-code",
      ),
    );
    assert.equal(history[1].message, "Claude Code finished using Bash.");
    assert.equal(
      history[3].message,
      "Claude Code encountered an error while using Bash.",
    );
    assert.equal(
      history[5].message,
      "Claude Code was interrupted while using Bash.",
    );

    // The result adapter must also tolerate Harbor being offline without blocking Claude.
    receiver.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    assert.match(
      await runHook(
        "PostToolUse",
        { ...payload, hook_event_name: "PostToolUse" },
        port,
      ),
      /not delivered/,
    );
  },
);
