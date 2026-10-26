import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createClaudeHooks,
  harborRoot,
  updateClaudeSettings,
} from "./claude-hooks.ts";
import { configureClaudeHooks } from "./configure-claude-hooks.ts";

test("setup preserves unrelated settings and hooks, is repeatable, and uninstalls only Harbor", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "harbor-settings-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "settings.json");
  const before = {
    enabledPlugins: { "example@market": true },
    env: { OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318" },
    hooks: {
      Stop: [
        {
          hooks: [{ command: "echo keep-existing-hook", type: "command" }],
          matcher: "",
          custom: "preserve",
        },
      ],
    },
    model: "opus",
    permissions: { allow: ["Read"] },
  };
  const original = JSON.stringify(before, null, 2) + "\n";
  await writeFile(path, original);
  assert.equal(
    (await configureClaudeHooks(path, "install", true)).changed,
    true,
  );
  assert.equal(await readFile(path, "utf8"), original);
  assert.deepEqual(await readdir(directory), ["settings.json"]);

  const installed = await configureClaudeHooks(path, "install");
  assert.ok(installed.backup);
  assert.equal(await readFile(installed.backup, "utf8"), original);
  const settings: {
    hooks: Record<
      string,
      {
        hooks: { command: string; type: string }[];
        matcher?: string;
        custom?: string;
      }[]
    >;
    [key: string]: unknown;
  } = JSON.parse(await readFile(path, "utf8"));
  assert.deepEqual(settings, updateClaudeSettings(before, "install"));
  assert.deepEqual(settings.env, before.env);
  assert.deepEqual(settings.hooks.Stop[0], before.hooks.Stop[0]);
  assert.equal(settings.hooks.Stop.length, 2);
  const files = await readdir(directory);
  assert.equal((await configureClaudeHooks(path, "install")).changed, false);
  assert.deepEqual(await readdir(directory), files);

  // A handler sharing a matcher group with Harbor must also survive removal.
  const mixed = structuredClone(settings);
  mixed.hooks.Stop[1].hooks.push({
    command: "echo keep-mixed-hook",
    type: "command",
  });
  const removed = updateClaudeSettings(mixed, "uninstall") as typeof mixed;
  assert.equal(removed.hooks.Stop[1].hooks[0].command, "echo keep-mixed-hook");
  assert.equal(removed.hooks.Stop[1].hooks.length, 1);

  await configureClaudeHooks(path, "uninstall");
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), before);
  assert.equal((await configureClaudeHooks(path, "uninstall")).changed, false);
});

test("reinstallation replaces obsolete result hooks with quiet return observers and preserves unrelated handlers", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "harbor-hook-migration-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "settings.json");
  const unrelated = { command: "echo keep-tool-hook", type: "command" };
  const legacy = {
    async: true,
    command: "node old/claude-tool-result.ts # agent-harbor",
    type: "command",
  };
  await writeFile(
    path,
    JSON.stringify({
      hooks: {
        ...createClaudeHooks(),
        PostToolUse: [{ hooks: [legacy], matcher: "*" }],
        PostToolUseFailure: [{ hooks: [legacy, unrelated], matcher: "*" }],
      },
    }),
  );
  const result = await configureClaudeHooks(path, "install");
  assert.equal(result.changed, true);
  assert.ok(result.backup);
  const { hooks } = JSON.parse(await readFile(path, "utf8"));
  for (const [event, groups] of Object.entries(createClaudeHooks())) {
    assert.deepEqual(
      hooks[event],
      event === "PostToolUseFailure"
        ? [{ hooks: [unrelated], matcher: "*" }, ...groups]
        : groups,
    );
  }
  assert.ok(!JSON.stringify(hooks).includes("old/claude-tool-result.ts"));
  assert.equal((await configureClaudeHooks(path, "install")).changed, false);
});

test("setup creates missing settings and refuses malformed settings without overwriting them", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "harbor-invalid-settings-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "nested", "settings.json");
  assert.equal((await configureClaudeHooks(path, "uninstall")).changed, false);
  assert.equal(
    (await configureClaudeHooks(path, "install", true)).changed,
    true,
  );
  assert.deepEqual(await readdir(directory), []);
  await configureClaudeHooks(path, "install");
  assert.deepEqual(
    Object.keys(JSON.parse(await readFile(path, "utf8")).hooks).sort(),
    [
      "PermissionRequest",
      "PostToolUse",
      "PostToolUseFailure",
      "SessionStart",
      "Stop",
      "UserPromptSubmit",
    ],
  );
  for (const contents of [
    "{",
    "[]",
    '{"hooks":[]}',
    '{"hooks":{"Stop":{}}}',
    '{"hooks":{"Stop":[{}]}}',
  ]) {
    await writeFile(path, contents);
    await assert.rejects(configureClaudeHooks(path, "install"));
    assert.equal(await readFile(path, "utf8"), contents);
  }
});

test(
  "installed hook commands run from another project and quote special characters literally",
  { timeout: 20_000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "harbor-other-project-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const path = join(directory, "settings.json");
    await configureClaudeHooks(path, "install");
    const settings = JSON.parse(await readFile(path, "utf8"));
    const received: unknown[] = [];
    const server = createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      received.push(JSON.parse(body));
      res.writeHead(201);
      res.end("{}");
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(() => {
      server.closeAllConnections();
      server.close();
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const run = async (command: string, event: string) => {
      const child = spawn("sh", ["-c", command], {
        cwd: directory,
        env: {
          ...process.env,
          CLAUDE_PROJECT_DIR: directory,
          HARBOR_PORT: String(address.port),
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stderr = "";
      let stdout = "";
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stdin.end(
        JSON.stringify({
          hook_event_name: event,
          prompt_id: "foreign-prompt",
          session_id: "other-project",
          session_title: "Other project",
          source: "startup",
          tool_name: "Bash",
          tool_input: { command: "foreign-command" },
        }),
      );
      assert.equal((await once(child, "close"))[0], 0, stderr);
      assert.equal(stderr, "");
      assert.equal(stdout, "");
    };
    for (const [event, groups] of Object.entries(settings.hooks)) {
      const registration = (groups as { hooks: { command: string }[] }[])[0];
      assert.ok(!registration.hooks[0].command.includes("CLAUDE_PROJECT_DIR"));
      await run(registration.hooks[0].command, event);
    }
    assert.equal(received.length, 6);
    assert.ok(
      received.every(
        (event) =>
          (event as { sessionId: string }).sessionId === "other-project",
      ),
    );

    const linkedRoot = join(directory, "Harbor's $HOME `literal` $(literal)");
    await symlink(harborRoot, linkedRoot);
    const linkedNode = join(directory, "Node's $HOME");
    await symlink(process.execPath, linkedNode);
    await run(
      createClaudeHooks(linkedRoot, linkedNode).UserPromptSubmit[0].hooks[0]
        .command,
      "UserPromptSubmit",
    );
    assert.equal(received.length, 7);
  },
);
