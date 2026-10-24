import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

test(
  "Codex permission requests report waiting and preserve privacy without approval decisions",
  { timeout: 45_000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "harbor-codex-permission-"));
    t.after(() => rm(directory, { force: true, recursive: true }));
    await writeFile(
      join(directory, "session_index.jsonl"),
      JSON.stringify({
        id: "codex-permission-session",
        thread_name: "Harbor permission check",
      }) + "\n",
    );

    async function runHook(
      hook: "PermissionRequest" | "Stop" | "UserPromptSubmit",
      input: unknown,
      port: number | string,
    ) {
      const child = spawn(
        "sh",
        ["-c", settings.hooks[hook][0].hooks[0].command],
        {
          cwd: fileURLToPath(new URL("./", import.meta.url)),
          env: {
            ...process.env,
            CODEX_HOME: directory,
            HARBOR_PORT: String(port),
          },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      let stderr = "";
      let stdout = "";
      child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
      child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
      child.stdin.end(
        typeof input === "string" ? input : JSON.stringify(input),
      );
      const [code] = await once(child, "close");
      assert.equal(code, 0, stderr);
      assert.equal(
        stdout,
        "",
        "Observer must never return approval decisions.",
      );
      assert.doesNotMatch(stderr, /private-/);
      return stderr;
    }

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
      cwd: "/private-project",
      hook_event_name: "PermissionRequest",
      model: "private-model",
      permission_mode: "default",
      permission_suggestions: [
        { behavior: "allow", type: "private-suggestion" },
      ],
      prompt: "private-prompt",
      session_id: " codex-permission-session ",
      tool_input: {
        command: "private-command",
        description: "private-approval-reason",
      },
      tool_name: " Bash ",
      transcript_path: "/private-transcript.jsonl",
      turn_id: "private-turn-id",
    };
    const registration = settings.hooks.PermissionRequest[0];
    assert.equal(settings.hooks.PermissionRequest.length, 1);
    assert.equal(registration.hooks.length, 1);
    assert.equal(registration.hooks[0].async, true);
    assert.equal(registration.hooks[0].type, "command");
    for (const tool of ["Bash", "apply_patch", "mcp__example__read"]) {
      assert.match(tool, new RegExp(registration.matcher));
    }

    async function history() {
      const controller = new AbortController();
      const stream = await fetch(`http://127.0.0.1:${port}/api/stream`, {
        signal: controller.signal,
      });
      const chunk = await stream.body!.getReader().read();
      const snapshot = new TextDecoder().decode(chunk.value);
      controller.abort();
      assert.doesNotMatch(
        snapshot,
        /private-|tool_input|permission_suggestions|transcript_path|turn_id/,
      );
      return JSON.parse(snapshot.split("data: ")[1].trim()) as HarborEvent[];
    }

    assert.equal(
      await runHook(
        "UserPromptSubmit",
        { ...payload, hook_event_name: "UserPromptSubmit" },
        port,
      ),
      "",
    );
    assert.equal(await runHook("PermissionRequest", payload, port), "");
    assert.deepEqual(
      (await history()).map((event) => event.type),
      ["activity", "waiting"],
    );

    for (const tool_name of ["apply_patch", "mcp__example__read"]) {
      assert.equal(
        await runHook("PermissionRequest", { ...payload, tool_name }, port),
        "",
      );
    }
    for (const hook_event_name of [
      "Interrupt",
      "PostToolUse",
      "PreToolUse",
      "Stop",
    ]) {
      assert.equal(
        await runHook(
          "PermissionRequest",
          { ...payload, hook_event_name },
          port,
        ),
        "",
      );
    }
    for (const input of [
      "{",
      null,
      [],
      { ...payload, session_id: " " },
      { ...payload, session_id: 1 },
      { ...payload, session_id: "x".repeat(121) },
      { ...payload, tool_name: " " },
      { ...payload, tool_name: 1 },
      { ...payload, tool_name: "x".repeat(121) },
    ]) {
      assert.match(
        await runHook("PermissionRequest", input, port),
        /not delivered/,
      );
    }
    for (const invalidPort of ["invalid", "0", "65536", "1.5"]) {
      assert.match(
        await runHook("PermissionRequest", payload, invalidPort),
        /not delivered/,
      );
    }
    assert.equal(
      await runHook("Stop", { ...payload, hook_event_name: "Stop" }, port),
      "",
    );
    const completed = await history();
    assert.deepEqual(
      completed.map((event) => event.type),
      ["activity", "waiting", "waiting", "waiting", "ready"],
    );
    const messages = [
      "Codex received a prompt.",
      "Codex requested permission to use Bash.",
      "Codex requested permission to use apply_patch.",
      "Codex requested permission to use mcp__example__read.",
      "Codex finished its response.",
    ];
    for (const [
      position,
      { id, receivedAt, ...event },
    ] of completed.entries()) {
      assert.ok(id);
      assert.ok(Number.isFinite(Date.parse(receivedAt)));
      assert.deepEqual(event, {
        message: messages[position],
        sessionId: "codex-permission-session",
        sessionName: "Harbor permission check",
        source: "codex",
        type:
          position === 0 ? "activity" : position === 4 ? "ready" : "waiting",
      });
    }

    await rm(join(directory, "session_index.jsonl"));
    assert.equal(
      await runHook(
        "PermissionRequest",
        { ...payload, session_id: "unnamed-session" },
        port,
      ),
      "",
    );
    const unnamed = (await history()).at(-1)!;
    assert.equal(unnamed.type, "waiting");
    assert.equal(Object.hasOwn(unnamed, "sessionName"), false);

    rejectRequests = true;
    assert.match(
      await runHook("PermissionRequest", payload, port),
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
      await runHook("PermissionRequest", payload, stalledAddress.port),
      /not delivered/,
    );

    receiver.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    assert.match(
      await runHook("PermissionRequest", payload, port),
      /not delivered/,
    );
  },
);
