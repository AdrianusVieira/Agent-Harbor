import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { Store as ClaudeStore } from "./collectors/claude/store.ts";
import { Store as CodexStore } from "./collectors/codex/store.ts";

export type TelemetryStores = { claude: ClaudeStore; codex: CodexStore };

export function privateDataDirectory(directory: string) {
  const root = resolve(directory);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  chmodSync(root, 0o700);
  return root;
}

export function openTelemetryStores(directory: string): TelemetryStores {
  const root = privateDataDirectory(directory);
  const claude = new ClaudeStore(join(root, "claude.sqlite3"));
  let codex: CodexStore | undefined;
  try {
    codex = new CodexStore(join(root, "codex.sqlite3"));
    for (const name of ["claude.sqlite3", "codex.sqlite3"])
      for (const suffix of ["", "-wal", "-shm"])
        if (existsSync(join(root, name + suffix)))
          chmodSync(join(root, name + suffix), 0o600);
    return { claude, codex };
  } catch (error) {
    claude.close();
    codex?.close();
    throw error;
  }
}
