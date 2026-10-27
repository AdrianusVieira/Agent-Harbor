import { chmodSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";

type Source = "claude" | "codex";

// IDs are the collectors' existing record fingerprints. Merging these IDs,
// rather than copying whole files, avoids counting Minecode's imported history twice.
export async function mergeTelemetryHistory(
  source: Source,
  input: string,
  destination: string,
) {
  if (!existsSync(input) || resolve(input) === resolve(destination))
    return { inserted: 0, skipped: true };
  const temporary = mkdtempSync(join(tmpdir(), "harbor-import-"));
  chmodSync(temporary, 0o700);
  let reader: Database.Database | undefined;
  let snapshot: Database.Database | undefined;
  let target: Database.Database | undefined;
  try {
    reader = new Database(input, { readonly: true, fileMustExist: true });
    const copy = join(temporary, "snapshot.sqlite3");
    await reader.backup(copy);
    reader.close();
    reader = undefined;
    snapshot = new Database(copy, { readonly: true, fileMustExist: true });
    target = new Database(destination, { fileMustExist: true });
    const db = target,
      original = snapshot;
    let inserted = 0;
    db.transaction(() => {
      const tables =
        source === "claude"
          ? ["deleted_sessions", "metric_points", "events", "titles"]
          : ["deleted_conversations", "events"];
      for (const table of tables) {
        if (
          !original
            .prepare(
              "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
            )
            .get(table)
        )
          continue;
        const oldColumns = new Set(
          (original.pragma(`table_info(${table})`) as { name: string }[]).map(
            (column) => column.name,
          ),
        );
        const columns = (
          db.pragma(`table_info(${table})`) as { name: string }[]
        )
          .map((column) => column.name)
          .filter((column) => oldColumns.has(column));
        if (!columns.length) continue;
        const names = columns.map((column) => `"${column}"`).join(", ");
        const conflict =
          table === "titles"
            ? " ON CONFLICT(session_id) DO UPDATE SET title=excluded.title, source=excluded.source, updated_ms=excluded.updated_ms WHERE excluded.updated_ms > titles.updated_ms"
            : "";
        const insert = db.prepare(
          `INSERT ${table === "titles" ? "" : "OR IGNORE"} INTO ${table} (${names}) VALUES (${columns.map(() => "?").join(", ")})${conflict}`,
        );
        for (const row of original
          .prepare(`SELECT ${names} FROM ${table}`)
          .iterate() as Iterable<Record<string, unknown>>) {
          const result = insert.run(...columns.map((column) => row[column]));
          if (table === "metric_points" || table === "events")
            inserted += result.changes;
        }
      }
      if (source === "claude") {
        for (const table of ["metric_points", "events", "titles"])
          db.prepare(
            `DELETE FROM ${table} WHERE session_id IN (SELECT session_id FROM deleted_sessions)`,
          ).run();
        db.prepare(
          "DELETE FROM metric_points WHERE name = 'claude_code.session.count'",
        ).run();
      } else
        db.prepare(
          "DELETE FROM events WHERE conversation_id IN (SELECT id FROM deleted_conversations)",
        ).run();
    })();
    return { inserted, skipped: false };
  } finally {
    reader?.close();
    snapshot?.close();
    target?.close();
    rmSync(temporary, { recursive: true, force: true });
  }
}
