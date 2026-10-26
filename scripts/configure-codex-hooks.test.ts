import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { codexApprovalKey } from "./codex-approval-key.ts";
import {
  createCodexHooks,
  harborRoot,
  updateCodexSettings,
} from "./codex-hooks.ts";
import { configureCodexHooks } from "./configure-codex-hooks.ts";

test("Codex setup preserves other hooks and metadata, is repeatable, and uninstalls only Harbor", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "harbor-codex-settings-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const path = join(directory, "hooks.json");
  const keep = { command: "echo keep-existing-hook", type: "command" };
  const before = {
    description: "Existing user hooks",
    hooks: {
      PostToolUse: [
        { custom: "preserve-tool-hook", hooks: [keep], matcher: "Bash" },
      ],
      Stop: [{ custom: "preserve", hooks: [keep], matcher: "" }],
    },
  };
  const original = JSON.stringify(before, null, 2) + "\n";
  await writeFile(path, original);
  assert.equal(
    (await configureCodexHooks(path, "install", true)).changed,
    true,
  );
  assert.equal(await readFile(path, "utf8"), original);
  assert.deepEqual(await readdir(directory), ["hooks.json"]);

  const installed = await configureCodexHooks(path, "install");
  assert.ok(installed.backup);
  assert.equal(await readFile(installed.backup, "utf8"), original);
  assert.equal((await stat(installed.backup)).mode & 0o777, 0o600);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  const settings: {
    hooks: Record<
      string,
      { custom?: string; hooks: { command: string; type: string }[] }[]
    >;
    [key: string]: unknown;
  } = JSON.parse(await readFile(path, "utf8"));
  assert.deepEqual(settings, updateCodexSettings(before, "install"));
  assert.deepEqual(settings.hooks.Stop[0], before.hooks.Stop[0]);
  assert.deepEqual(settings.hooks.PostToolUse[0], before.hooks.PostToolUse[0]);
  const legacy = structuredClone(settings);
  legacy.hooks.PostToolUse = structuredClone(before.hooks.PostToolUse);
  assert.deepEqual(
    updateCodexSettings(legacy, "install"),
    settings,
    "Upgrading three Harbor hooks adds the return observer while preserving unrelated tool hooks.",
  );
  const files = await readdir(directory);
  assert.equal((await configureCodexHooks(path, "install")).changed, false);
  assert.deepEqual(await readdir(directory), files);

  // Shared groups retain their unrelated handler and extra group properties.
  const mixed = structuredClone(settings);
  mixed.hooks.Stop[1].hooks.push(keep);
  mixed.hooks.Stop[1].custom = "mixed";
  mixed.hooks.Stop[1].hooks.push({
    command: "echo lookalike # agent-harbor suffix",
    type: "command",
  });
  const removed = updateCodexSettings(mixed, "uninstall") as typeof mixed;
  assert.equal(removed.hooks.Stop[1].custom, "mixed");
  assert.deepEqual(
    removed.hooks.Stop[1].hooks,
    mixed.hooks.Stop[1].hooks.slice(1),
  );
  assert.equal(mixed.hooks.Stop[1].hooks.length, 3, "Do not mutate input");

  await configureCodexHooks(path, "uninstall");
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), before);
  assert.equal((await configureCodexHooks(path, "uninstall")).changed, false);
});

test("Codex setup creates missing hooks and refuses malformed or symlinked files", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "harbor-codex-invalid-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const path = join(directory, "nested", "hooks.json");
  assert.equal((await configureCodexHooks(path, "uninstall")).changed, false);
  await configureCodexHooks(path, "install", true);
  assert.deepEqual(await readdir(directory), []);
  await configureCodexHooks(path, "install");
  assert.deepEqual(
    JSON.parse(await readFile(path, "utf8")).hooks,
    createCodexHooks(),
  );
  for (const contents of [
    "{",
    "[]",
    '{"hooks":[]}',
    '{"hooks":{"Stop":{}}}',
    '{"hooks":{"Stop":[{}]}}',
  ]) {
    await writeFile(path, contents);
    await assert.rejects(configureCodexHooks(path, "install"));
    assert.equal(await readFile(path, "utf8"), contents);
  }
  const target = join(directory, "target.json");
  const link = join(directory, "link.json");
  await writeFile(target, "{}");
  await symlink(target, link);
  await assert.rejects(configureCodexHooks(link, "install"), /symlink/);
  assert.equal(await readFile(target, "utf8"), "{}");
});

test("Codex setup CLI honors CODEX_HOME without modifying config or trust state", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "harbor-codex-cli-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const config =
    '# Existing permissions and hook trust must remain byte-for-byte unchanged\napproval_policy = "on-request"\n';
  await writeFile(join(directory, "config.toml"), config);
  const run = async (...args: string[]) => {
    const child = spawn(
      process.execPath,
      [
        join(harborRoot, "node_modules/tsx/dist/cli.mjs"),
        join(harborRoot, "scripts/configure-codex-hooks.ts"),
        ...args,
      ],
      {
        cwd: directory,
        env: { ...process.env, CODEX_HOME: directory },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.stdout.resume();
    assert.equal((await once(child, "close"))[0], 0, stderr);
  };
  await run("install", "--dry-run");
  assert.deepEqual(await readdir(directory), ["config.toml"]);
  await run("install");
  assert.deepEqual(
    JSON.parse(await readFile(join(directory, "hooks.json"), "utf8")).hooks,
    createCodexHooks(),
  );
  await run("uninstall");
  assert.deepEqual(
    JSON.parse(await readFile(join(directory, "hooks.json"), "utf8")),
    {},
  );
  assert.equal(await readFile(join(directory, "config.toml"), "utf8"), config);
});

test(
  "installed Codex commands deliver from a foreign folder without Git or node on PATH",
  { timeout: 20_000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "harbor-codex-foreign-"));
    t.after(() => rm(directory, { force: true, recursive: true }));
    const path = join(directory, "hooks.json");
    await configureCodexHooks(path, "install");
    await writeFile(
      join(directory, "session_index.jsonl"),
      JSON.stringify({ id: "foreign-session", thread_name: "Other project" }) +
        "\n",
    );
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
      const child = spawn("/bin/sh", ["-c", command], {
        cwd: directory,
        env: {
          ...process.env,
          CODEX_HOME: directory,
          HARBOR_PORT: String(address.port),
          PATH: directory,
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
          session_id: "foreign-session",
          tool_input: { command: "foreign-command" },
          tool_name: "Bash",
          turn_id: "foreign-turn",
        }),
      );
      assert.equal((await once(child, "close"))[0], 0, stderr);
      assert.equal(stderr, "");
      assert.equal(stdout, "");
    };
    for (const [event, groups] of Object.entries(settings.hooks)) {
      const handler = (
        groups as {
          hooks: { async: boolean; command: string; timeout: number }[];
        }[]
      )[0].hooks[0];
      assert.equal(handler.async, true);
      assert.equal(handler.timeout, 5);
      assert.ok(!handler.command.includes("git rev-parse"));
      await run(handler.command, event);
    }
    const approvalKey = codexApprovalKey({
      session_id: "foreign-session",
      tool_input: { command: "foreign-command" },
      tool_name: "Bash",
      turn_id: "foreign-turn",
    });
    assert.deepEqual(received, [
      {
        approvalKey,
        message: "Codex requested permission to use Bash.",
        sessionId: "foreign-session",
        sessionName: "Other project",
        source: "codex",
        type: "waiting",
      },
      { approvalKey, sessionId: "foreign-session" },
      {
        message: "Codex finished its response.",
        sessionId: "foreign-session",
        sessionName: "Other project",
        source: "codex",
        type: "ready",
      },
      {
        message: "Codex received a prompt.",
        sessionId: "foreign-session",
        sessionName: "Other project",
        source: "codex",
        type: "activity",
      },
    ]);
    const linkedRoot = join(directory, "Harbor's $HOME `literal` $(literal)");
    const linkedNode = join(directory, "Node's $HOME");
    await symlink(harborRoot, linkedRoot);
    await symlink(process.execPath, linkedNode);
    await run(
      createCodexHooks(linkedRoot, linkedNode).Stop[0].hooks[0].command,
      "Stop",
    );
    assert.equal(received.length, 5);
  },
);
