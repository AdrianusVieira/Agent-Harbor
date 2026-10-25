import { randomUUID } from "node:crypto";
import {
  access,
  lstat,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createCodexHooks,
  harborRoot,
  updateCodexSettings,
} from "./codex-hooks.ts";

async function readSettings(path: string) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function configureCodexHooks(
  path: string,
  mode: "install" | "uninstall",
  dryRun = false,
) {
  const original = await readSettings(path);
  const before: unknown = original === null ? {} : JSON.parse(original);
  const after = updateCodexSettings(before, mode);
  if (JSON.stringify(before) === JSON.stringify(after))
    return { changed: false };
  if (mode === "install") {
    for (const file of [
      "node_modules/tsx/dist/cli.mjs",
      ...[
        "codex-permission-request.ts",
        "codex-prompt-submit.ts",
        "codex-reply-ready.ts",
      ].map((name) => `scripts/${name}`),
    ])
      await access(join(harborRoot, file));
  }
  if (dryRun) return { changed: true };
  if (original !== null && (await lstat(path)).isSymbolicLink()) {
    throw new Error("Settings is a symlink; refusing to replace it.");
  }
  await mkdir(dirname(path), { recursive: true });
  const backup =
    original === null ? undefined : `${path}.agent-harbor-${randomUUID()}.bak`;
  if (backup) await writeFile(backup, original!, { flag: "wx", mode: 0o600 });
  const temporary = `${path}.agent-harbor-${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(after, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    if ((await readSettings(path)) !== original)
      throw new Error(
        "Settings changed during setup; retry to preserve the latest edits.",
      );
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  return { backup, changed: true };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const [mode, ...flags] = process.argv.slice(2);
    if (
      (mode !== "install" && mode !== "uninstall") ||
      flags.some((flag) => flag !== "--dry-run")
    ) {
      throw new Error(
        "Usage: configure-codex-hooks.ts install|uninstall [--dry-run]",
      );
    }
    const path = join(
      process.env.CODEX_HOME || join(homedir(), ".codex"),
      "hooks.json",
    );
    const dryRun = flags.includes("--dry-run");
    const result = await configureCodexHooks(path, mode, dryRun);
    console.log(
      `${dryRun ? "Preview" : mode === "install" ? "Install" : "Uninstall"}: ${path}`,
    );
    console.log(
      result.changed
        ? `${dryRun ? "Would update" : "Updated"} only Agent Harbor hook registrations.`
        : "Already configured; no changes.",
    );
    if (result.backup) console.log(`Backup: ${result.backup}`);
    if (dryRun && mode === "install")
      console.log(JSON.stringify(createCodexHooks(), null, 2));
  } catch (error) {
    // Do not print settings contents, including malformed JSON or credentials.
    console.error(
      error instanceof SyntaxError
        ? "Settings contains invalid JSON; nothing changed."
        : (error as Error).message,
    );
    process.exitCode = 1;
  }
}
