import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createReceiver } from "../server/receiver.ts";
import type { HarborEvent } from "../src/events.ts";
import { claudeApprovalKey } from "./claude-approval-key.ts";
import { createClaudeHooks } from "./claude-hooks.ts";

const payload = {
  hook_event_name: "PostToolUse",
  prompt_id: "private-prompt-id",
  session_id: "return-session",
  tool_input: {
    command: "private-command",
    description: "private-description",
  },
  tool_name: "Bash",
  tool_response: { stdout: "private-output" },
  tool_use_id: "private-call-id",
};

test("Claude permission fingerprints are prompt-scoped and tolerate request-only descriptions", () => {
  const key = claudeApprovalKey(payload);
  assert.match(key!, /^[a-f0-9]{64}$/);
  assert.equal(
    key,
    claudeApprovalKey({
      ...payload,
      tool_input: { command: "private-command" },
    }),
  );
  assert.notEqual(
    key,
    claudeApprovalKey({ ...payload, prompt_id: "other-prompt" }),
  );
  assert.notEqual(
    key,
    claudeApprovalKey({ ...payload, session_id: "other-session" }),
  );
  assert.notEqual(
    key,
    claudeApprovalKey({ ...payload, tool_input: { command: "other-command" } }),
  );
  assert.equal(
    claudeApprovalKey({ ...payload, prompt_id: undefined }),
    undefined,
  );
  assert.equal(claudeApprovalKey({ ...payload, prompt_id: " " }), undefined);
  const write = { ...payload, tool_name: "Write" };
  assert.equal(
    claudeApprovalKey({
      ...write,
      tool_input: { content: "private-content", file_path: "/private/file" },
    }),
    claudeApprovalKey({
      ...write,
      tool_input: { file_path: "/private/file", content: "private-content" },
    }),
  );
});

test(
  "Claude success/failure returns clear only matched waits without tool-result rows",
  { timeout: 60_000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "harbor-claude-return-"));
    t.after(() => rm(directory, { force: true, recursive: true }));
    const hooks = createClaudeHooks();
    const receiver = createReceiver();
    let reject = false;
    const server = createServer((req, res) => {
      if (reject && req.method === "POST") {
        res.writeHead(503).end();
        return;
      }
      void receiver.handle(req, res).then((handled) => {
        if (!handled) res.writeHead(404).end();
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
    async function run(
      hook: keyof typeof hooks,
      input: unknown = payload,
      destination: number | string = port,
    ) {
      const child = spawn("/bin/sh", ["-c", hooks[hook][0].hooks[0].command], {
        cwd: directory,
        env: {
          ...process.env,
          CLAUDE_CONFIG_DIR: directory,
          HARBOR_PORT: String(destination),
          PATH: directory,
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stderr = "",
        stdout = "";
      child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
      child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
      child.stdin.end(
        typeof input === "string" ? input : JSON.stringify(input),
      );
      assert.equal((await once(child, "close"))[0], 0, stderr);
      assert.equal(
        stdout,
        "",
        "Observers cannot emit context or approval decisions.",
      );
      assert.doesNotMatch(stderr, /private-/);
      return stderr;
    }
    async function request(input: Record<string, unknown> = payload) {
      const { tool_use_id, tool_response, ...rest } = input;
      assert.equal(
        await run("PermissionRequest", {
          ...rest,
          hook_event_name: "PermissionRequest",
        }),
        "",
      );
    }
    async function stop() {
      assert.equal(
        await run("Stop", { ...payload, hook_event_name: "Stop" }),
        "",
      );
    }
    async function history() {
      const controller = new AbortController();
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/stream`, {
          signal: controller.signal,
        });
        const { value } = await response.body!.getReader().read();
        const text = new TextDecoder().decode(value);
        assert.doesNotMatch(
          text,
          /private-|approvalKey|prompt_id|tool_input|tool_response|tool_use_id/,
        );
        return JSON.parse(text.split("data: ")[1].trim()) as HarborEvent[];
      } finally {
        controller.abort();
      }
    }
    async function post(path: string, value: unknown) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        body: JSON.stringify(value),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const status = response.status;
      await response.body?.cancel();
      return status;
    }
    for (const hook of ["PostToolUse", "PostToolUseFailure"] as const) {
      assert.equal(hooks[hook][0].matcher, "*");
      assert.equal(hooks[hook][0].hooks[0].async, true);
    }
    await run("PostToolUse");
    assert.equal(
      (await history()).length,
      0,
      "Normal tools produce no log rows.",
    );
    await run("SessionStart", {
      ...payload,
      hook_event_name: "SessionStart",
      session_title: "Claude return check",
      source: "startup",
    });
    await request();
    for (const change of [
      { prompt_id: "other-prompt" },
      { session_id: "other-session" },
      {
        tool_input: {
          command: "other-command",
          description: "private-description",
        },
      },
    ])
      await run("PostToolUse", { ...payload, ...change });
    assert.equal((await history()).at(-1)?.type, "waiting");
    await run("PostToolUse");
    let events = await history();
    assert.deepEqual(
      events.slice(-2).map((event) => event.type),
      ["waiting", "activity"],
    );
    assert.equal(
      events.at(-1)?.message,
      "Claude Code continued after a permission request.",
    );
    assert.equal(events.at(-1)?.sessionName, "Claude return check");
    const count = events.length;
    await run("PostToolUse");
    assert.equal((await history()).length, count);

    const another = {
      ...payload,
      tool_input: {
        command: "private-second-command",
        description: "private-description",
      },
    };
    await request();
    await request(another);
    await run("PostToolUse");
    assert.equal(
      (await history()).at(-1)?.type,
      "waiting",
      "Keep the other pending permission visible.",
    );
    await run("PostToolUseFailure", {
      ...another,
      hook_event_name: "PostToolUseFailure",
      error: "private-error",
      is_interrupt: false,
    });
    assert.equal((await history()).at(-1)?.type, "activity");
    assert.equal(
      (await history()).filter((event) => event.type === "error").length,
      0,
    );

    for (const tool of [
      {
        tool_name: "Write",
        tool_input: { file_path: "/private/file", content: "private-content" },
      },
      {
        tool_name: "mcp__example__read",
        tool_input: { resource: "private-resource" },
      },
    ]) {
      const input = { ...payload, ...tool };
      await request(input);
      await run("PostToolUse", input);
      assert.equal((await history()).at(-1)?.type, "activity");
    }
    await request();
    await run("PostToolUseFailure", {
      ...payload,
      hook_event_name: "PostToolUseFailure",
      is_interrupt: true,
      error: "private-abort",
    });
    assert.equal(
      (await history()).at(-1)?.type,
      "waiting",
      "An interruption does not prove work resumed.",
    );
    await stop();
    await run("PostToolUse");
    assert.equal((await history()).at(-1)?.type, "ready");
    await request();
    await request();
    await run("PostToolUse");
    assert.equal(
      (await history()).at(-1)?.type,
      "waiting",
      "Identical overlapping calls stay conservative.",
    );
    await stop();
    await run("PermissionRequest", {
      ...payload,
      prompt_id: undefined,
      hook_event_name: "PermissionRequest",
    });
    await run("PostToolUse");
    assert.equal((await history()).at(-1)?.type, "waiting");
    await stop();

    const key = claudeApprovalKey(payload)!;
    await post("/api/events", {
      source: "codex",
      sessionId: payload.session_id,
      type: "waiting",
      message: "Codex requested permission to use Bash.",
      approvalKey: key,
    });
    await request();
    await run("PostToolUse");
    events = await history();
    assert.equal(
      events.filter((event) => event.source === "codex").at(-1)?.type,
      "waiting",
      "Sources must not share pending state even with identical keys and IDs.",
    );
    assert.equal(
      events.filter((event) => event.source === "claude-code").at(-1)?.type,
      "activity",
    );
    await post("/api/codex/tool-returned", {
      sessionId: payload.session_id,
      approvalKey: key,
    });
    assert.equal((await history()).at(-1)?.source, "codex");

    const beforeInvalid = (await history()).length;
    for (const input of [
      "{",
      null,
      [],
      { ...payload, hook_event_name: "PermissionRequest" },
      { ...payload, prompt_id: undefined },
    ])
      await run("PostToolUse", input);
    assert.equal((await history()).length, beforeInvalid);
    for (const invalidPort of ["bad", "0", "65536", "1.5"])
      assert.match(
        await run("PostToolUse", payload, invalidPort),
        /not delivered/,
      );
    assert.equal(await post("/api/claude-code/tool-returned", {}), 400);
    reject = true;
    assert.match(await run("PostToolUse"), /not delivered/);
    const stalled = createServer(() => {});
    stalled.listen(0, "127.0.0.1");
    await once(stalled, "listening");
    t.after(() => {
      stalled.closeAllConnections();
      stalled.close();
    });
    const stalledAddress = stalled.address();
    assert.ok(stalledAddress && typeof stalledAddress === "object");
    assert.match(
      await run("PostToolUse", payload, stalledAddress.port),
      /not delivered/,
    );
    receiver.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    assert.match(await run("PostToolUse", payload), /not delivered/);
  },
);
