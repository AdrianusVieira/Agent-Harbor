import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readCodexSessionName } from "./codex-session-name.ts";

test("Codex names use exact IDs and the last saved rename", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "harbor-codex-name-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  await writeFile(
    join(directory, "session_index.jsonl"),
    [
      JSON.stringify({ id: "session-1", thread_name: "Old name" }),
      "{malformed-line",
      "null",
      "[]",
      JSON.stringify({ id: "session-2", thread_name: "Same name" }),
      JSON.stringify({ id: "session-1", thread_name: "  Corrigir login ⚓  " }),
      JSON.stringify({ id: "session-3", thread_name: "Same name" }),
      "{partial-last-line",
    ].join("\n"),
  );
  assert.equal(
    await readCodexSessionName("session-1", directory),
    "Corrigir login ⚓",
  );
  assert.equal(await readCodexSessionName("session-2", directory), "Same name");
  assert.equal(await readCodexSessionName("session-3", directory), "Same name");
  assert.equal(await readCodexSessionName("session", directory), undefined);
  assert.equal(await readCodexSessionName("unknown", directory), undefined);
});

test("unavailable or invalid Codex name metadata stays optional", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "harbor-codex-name-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const path = join(directory, "session_index.jsonl");
  assert.equal(await readCodexSessionName("session-1", directory), undefined);
  await mkdir(path);
  assert.equal(await readCodexSessionName("session-1", directory), undefined);
  await rm(path, { recursive: true });

  for (const thread_name of [null, 1, "", "  ", "x".repeat(201)]) {
    await writeFile(
      path,
      [
        { id: "session-1", thread_name: "Old name" },
        { id: "session-1", thread_name },
      ]
        .map((entry) => JSON.stringify(entry))
        .join("\n"),
    );
    assert.equal(await readCodexSessionName("session-1", directory), undefined);
  }

  await writeFile(
    path,
    JSON.stringify({ id: "session-1", thread_name: "x".repeat(200) }),
  );
  assert.equal(
    await readCodexSessionName("session-1", directory),
    "x".repeat(200),
  );
  await writeFile(
    path,
    JSON.stringify({
      id: "session-1",
      thread_name: "Do not scan oversized files",
    }) + " ".repeat(1_048_576),
  );
  assert.equal(await readCodexSessionName("session-1", directory), undefined);
});
