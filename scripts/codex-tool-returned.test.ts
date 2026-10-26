import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createReceiver } from "../server/receiver.ts";
import type { HarborEvent } from "../src/events.ts";
import { codexApprovalKey } from "./codex-approval-key.ts";
import { createCodexHooks } from "./codex-hooks.ts";

const payload = {
  hook_event_name: "PostToolUse",
  session_id: "return-session",
  tool_input: { command: "private-command" },
  tool_name: "Bash",
  tool_response: { output: "private-output" },
  tool_use_id: "private-call-id",
  turn_id: "private-turn-id",
};

test("Codex approval fingerprints match shared metadata without disclosing it", () => {
  const key = codexApprovalKey(payload);
  assert.equal(
    key,
    "0c7108e290eba09b4d554c05f819ca00a639e9d1d806b71e579d3b6f0f92f64e",
    "Existing Codex fingerprints must remain compatible.",
  );
  assert.match(key!, /^[a-f0-9]{64}$/);
  assert.equal(
    key,
    codexApprovalKey({
      ...payload,
      session_id: " return-session ",
      tool_input: { command: "private-command", description: "private-reason" },
    }),
  );
  for (const change of [
    { session_id: "another-session" },
    { turn_id: "another-turn" },
    { tool_name: "apply_patch" },
    { tool_input: { command: "another-command" } },
  ])
    assert.notEqual(key, codexApprovalKey({ ...payload, ...change }));
  const mcp = { ...payload, tool_name: "mcp__example__read" };
  assert.equal(
    codexApprovalKey({ ...mcp, tool_input: { a: [1, true], b: { x: null } } }),
    codexApprovalKey({ ...mcp, tool_input: { b: { x: null }, a: [1, true] } }),
  );
  for (const change of [
    { session_id: " " },
    { session_id: "x".repeat(121) },
    { turn_id: undefined },
    { turn_id: 1 },
    { turn_id: " " },
    { tool_name: " " },
    { tool_name: 1 },
    { tool_input: null },
    { tool_input: [] },
    { tool_input: {} },
    { tool_input: { command: "x".repeat(131_073) } },
  ])
    assert.equal(codexApprovalKey({ ...payload, ...change }), undefined);
});

test(
  "Codex tool returns quietly resolve matching waits and preserve other pending requests",
  { timeout: 45_000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "harbor-codex-return-"));
    t.after(() => rm(directory, { force: true, recursive: true }));
    await writeFile(
      join(directory, "session_index.jsonl"),
      JSON.stringify({ id: payload.session_id, thread_name: "Return check" }) +
        "\n",
    );
    const hooks = createCodexHooks();
    const receiver = createReceiver();
    let reject = false;
    const bodies: unknown[] = [];
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
      input: unknown,
      destination: number | string = port,
    ) {
      const child = spawn("/bin/sh", ["-c", hooks[hook][0].hooks[0].command], {
        cwd: directory,
        env: {
          ...process.env,
          CODEX_HOME: directory,
          HARBOR_PORT: String(destination),
          PATH: directory,
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stderr = "";
      let stdout = "";
      child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
      child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
      child.stdin.end(
        typeof input === "string" ? input : JSON.stringify(input),
      );
      assert.equal((await once(child, "close"))[0], 0, stderr);
      assert.equal(stdout, "", "Observers cannot return context or decisions.");
      assert.doesNotMatch(stderr, /private-/);
      return stderr;
    }
    async function history() {
      const controller = new AbortController();
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/stream`, {
          signal: controller.signal,
        });
        const { value } = await response.body!.getReader().read();
        const snapshot = new TextDecoder().decode(value);
        assert.doesNotMatch(
          snapshot,
          /private-|approvalKey|tool_input|tool_response|turn_id/,
        );
        return JSON.parse(snapshot.split("data: ")[1].trim()) as HarborEvent[];
      } finally {
        controller.abort();
      }
    }
    async function post(path: string, value: unknown) {
      return fetch(`http://127.0.0.1:${port}${path}`, {
        body: JSON.stringify(value),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
    }
    async function request(input = payload) {
      assert.equal(
        await run("PermissionRequest", {
          ...input,
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

    assert.match("Bash", new RegExp(hooks.PostToolUse[0].matcher!));
    assert.equal(hooks.PostToolUse[0].hooks[0].async, true);
    assert.equal(await run("PostToolUse", payload), "");
    assert.equal(
      (await history()).length,
      0,
      "Ordinary tools produce no event.",
    );
    await request();
    assert.equal((await history()).at(-1)?.type, "waiting");
    for (const change of [
      { session_id: "other-session" },
      { turn_id: "other-turn" },
      { tool_input: { command: "other-command" } },
      { tool_name: "apply_patch" },
    ])
      assert.equal(await run("PostToolUse", { ...payload, ...change }), "");
    assert.equal(
      (await history()).length,
      1,
      "Unrelated returns cannot resolve a wait.",
    );
    assert.equal(await run("PostToolUse", payload), "");
    let events = await history();
    assert.deepEqual(
      events.map((event) => event.type),
      ["waiting", "activity"],
    );
    assert.equal(
      events.at(-1)?.message,
      "Codex continued after a permission request.",
    );
    assert.equal(events.at(-1)?.sessionName, "Return check");
    assert.equal(await run("PostToolUse", payload), "");
    assert.equal(
      (await history()).length,
      2,
      "Repeated/ordinary returns stay quiet.",
    );

    const another = {
      ...payload,
      tool_input: { command: "private-second-command" },
    };
    await request();
    await request(another);
    await run("PostToolUse", payload);
    assert.equal(
      (await history()).at(-1)?.type,
      "waiting",
      "Another pending request stays orange.",
    );
    await run("PostToolUse", another);
    assert.equal((await history()).at(-1)?.type, "activity");

    for (const tool_name of ["apply_patch", "mcp__example__read"]) {
      const tool = { ...payload, tool_name };
      await request(tool);
      await run("PostToolUse", {
        ...tool,
        tool_response: { output: "private-error-output", exit_code: 1 },
      });
      assert.equal(
        (await history()).at(-1)?.type,
        "activity",
        "Returned error output is still a return, not a new tool-error event.",
      );
    }
    await request();
    await stop();
    await run("PostToolUse", payload);
    assert.equal(
      (await history()).at(-1)?.type,
      "ready",
      "Late returns never downgrade ready.",
    );

    await request();
    await request();
    await run("PostToolUse", payload);
    assert.equal(
      (await history()).at(-1)?.type,
      "waiting",
      "Identical concurrent calls are ambiguous; do not guess.",
    );
    await stop();
    const untracked = { ...payload, turn_id: undefined };
    await run("PermissionRequest", {
      ...untracked,
      hook_event_name: "PermissionRequest",
    });
    await request();
    await run("PostToolUse", payload);
    assert.equal(
      (await history()).at(-1)?.type,
      "waiting",
      "Untrackable pending requests must remain visible.",
    );
    await stop();

    await request();
    await run("UserPromptSubmit", {
      ...payload,
      hook_event_name: "UserPromptSubmit",
    });
    const count = (await history()).length;
    await run("PostToolUse", payload);
    assert.equal(
      (await history()).length,
      count,
      "A new prompt clears old pending metadata.",
    );
    for (const input of [
      "{",
      null,
      [],
      { ...payload, hook_event_name: "PermissionRequest" },
      untracked,
    ])
      await run("PostToolUse", input);
    assert.equal((await history()).length, count);
    for (const invalidPort of ["bad", "0", "65536", "1.5"])
      assert.match(
        await run("PostToolUse", payload, invalidPort),
        /not delivered/,
      );
    for (const invalid of [
      null,
      [],
      {},
      { approvalKey: "bad", sessionId: "session" },
    ]) {
      const response = await post("/api/codex/tool-returned", invalid);
      assert.equal(response.status, 400);
      await response.body?.cancel();
    }
    const crossOrigin = await fetch(
      `http://127.0.0.1:${port}/api/codex/tool-returned`,
      {
        body: "{}",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://example.com",
        },
        method: "POST",
      },
    );
    assert.equal(crossOrigin.status, 403);
    await crossOrigin.body?.cancel();

    const capture = createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      bodies.push(JSON.parse(body));
      assert.equal(req.url, "/api/codex/tool-returned");
      res.writeHead(204).end();
    });
    capture.listen(0, "127.0.0.1");
    await once(capture, "listening");
    t.after(() => {
      capture.closeAllConnections();
      capture.close();
    });
    const captureAddress = capture.address();
    assert.ok(captureAddress && typeof captureAddress === "object");
    await run("PostToolUse", payload, captureAddress.port);
    assert.deepEqual(bodies, [
      { approvalKey: codexApprovalKey(payload), sessionId: payload.session_id },
    ]);

    reject = true;
    assert.match(await run("PostToolUse", payload), /not delivered/);
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
