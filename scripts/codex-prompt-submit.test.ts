import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createReceiver } from "../server/receiver.ts";
import type { HarborEvent } from "../src/events.ts";
import { createCodexHooks } from "./codex-hooks.ts";

const settings = { hooks: createCodexHooks() };

test(
  "Codex prompt submission replaces ready with activity without forwarding content or decisions",
  { timeout: 30_000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "harbor-codex-prompt-"));
    t.after(() => rm(directory, { force: true, recursive: true }));
    await writeFile(
      join(directory, "session_index.jsonl"),
      JSON.stringify({
        id: "codex-prompt-session",
        thread_name: "Harbor prompt check",
      }) + "\n",
    );

    async function runHook(
      hook: "Stop" | "UserPromptSubmit",
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
        "Observer must not return context or decisions.",
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
      cwd: "/private-parent/HarborProject",
      hook_event_name: "UserPromptSubmit",
      model: "private-model",
      permission_mode: "default",
      prompt: "private-user-prompt",
      session_id: " codex-prompt-session ",
      transcript_path: "/private-transcript.jsonl",
      turn_id: "private-turn-id",
    };
    const registration = settings.hooks.UserPromptSubmit[0];
    assert.equal(settings.hooks.UserPromptSubmit.length, 1);
    assert.equal(registration.hooks.length, 1);
    assert.equal(registration.hooks[0].async, true);
    assert.equal(registration.hooks[0].type, "command");
    assert.equal(Object.hasOwn(registration, "matcher"), false);

    async function history() {
      const controller = new AbortController();
      const stream = await fetch(`http://127.0.0.1:${port}/api/stream`, {
        signal: controller.signal,
      });
      const chunk = await stream.body!.getReader().read();
      const snapshot = new TextDecoder().decode(chunk.value);
      controller.abort();
      assert.doesNotMatch(snapshot, /private-|prompt:|transcript_path|turn_id/);
      return JSON.parse(snapshot.split("data: ")[1].trim()) as HarborEvent[];
    }

    assert.equal(
      await runHook("Stop", { ...payload, hook_event_name: "Stop" }, port),
      "",
    );
    assert.equal(await runHook("UserPromptSubmit", payload, port), "");
    const intermediate = await history();
    assert.deepEqual(
      intermediate.map((event) => event.type),
      ["ready", "activity"],
    );

    for (const hook_event_name of [
      "PostToolUse",
      "SessionStart",
      "Stop",
      "SubagentStop",
    ]) {
      assert.equal(
        await runHook(
          "UserPromptSubmit",
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
    ]) {
      assert.match(
        await runHook("UserPromptSubmit", input, port),
        /not delivered/,
      );
    }
    for (const invalidPort of ["invalid", "0", "65536", "1.5"]) {
      assert.match(
        await runHook("UserPromptSubmit", payload, invalidPort),
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
      ["ready", "activity", "ready"],
    );
    for (const [
      position,
      { id, receivedAt, ...event },
    ] of completed.entries()) {
      assert.ok(id);
      assert.ok(Number.isFinite(Date.parse(receivedAt)));
      assert.deepEqual(event, {
        message:
          position === 1
            ? "Codex received a prompt."
            : "Codex finished its response.",
        projectName: "HarborProject",
        sessionId: "codex-prompt-session",
        sessionName: "Harbor prompt check",
        source: "codex",
        type: position === 1 ? "activity" : "ready",
      });
    }

    await rm(join(directory, "session_index.jsonl"));
    assert.equal(
      await runHook(
        "UserPromptSubmit",
        { ...payload, session_id: "unnamed-session" },
        port,
      ),
      "",
    );
    const unnamed = (await history()).at(-1)!;
    assert.equal(unnamed.sessionId, "unnamed-session");
    assert.equal(unnamed.type, "activity");
    assert.equal(Object.hasOwn(unnamed, "sessionName"), false);

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
