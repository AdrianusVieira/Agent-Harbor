import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const MAX_INDEX_BYTES = 1_048_576;

// Codex's local index contains saved names, not conversation messages.
export async function readCodexSessionName(
  sessionId: string,
  directory = process.env.CODEX_HOME || join(homedir(), ".codex"),
) {
  try {
    const index = await open(join(directory, "session_index.jsonl"), "r");
    try {
      const info = await index.stat();
      if (!info.isFile() || info.size > MAX_INDEX_BYTES) return;

      // Read only the size observed above, even if Codex appends more meanwhile.
      const buffer = Buffer.alloc(info.size);
      let bytes = 0;
      while (bytes < buffer.length) {
        const { bytesRead } = await index.read(
          buffer,
          bytes,
          buffer.length - bytes,
          bytes,
        );
        if (!bytesRead) break;
        bytes += bytesRead;
      }

      let name: string | undefined;
      for (const line of buffer
        .subarray(0, bytes)
        .toString("utf8")
        .split("\n")) {
        try {
          const entry: unknown = JSON.parse(line);
          if (!entry || typeof entry !== "object" || Array.isArray(entry))
            continue;
          const { id, thread_name } = entry as Record<string, unknown>;
          if (id !== sessionId) continue;

          // Renames are appended; the last matching record wins.
          name =
            typeof thread_name === "string" &&
            thread_name.trim() &&
            thread_name.length <= 200
              ? thread_name.trim()
              : undefined;
        } catch {
          // A partially written or malformed line must not lose the ready event.
        }
      }
      return name;
    } finally {
      await index.close();
    }
  } catch {
    // Naming is optional: missing metadata must not prevent event delivery.
    return;
  }
}
