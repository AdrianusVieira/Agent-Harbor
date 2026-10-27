import { chmodSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { EVENT_LIMIT, type HarborEvent } from "../src/events.ts";
import { privateDataDirectory } from "./telemetryStore.ts";

// Pending approval fingerprints deliberately remain memory-only. A historical
// waiting event is the last observation, never evidence of a current permission.
export class SignalStore {
  private db: Database.Database;

  constructor(directory: string) {
    const path = join(privateDataDirectory(directory), "signals.sqlite3");
    this.db = new Database(path);
    chmodSync(path, 0o600);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS signals (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE, source TEXT NOT NULL, session_id TEXT NOT NULL,
        received_at TEXT NOT NULL, payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS signals_session ON signals(source, session_id, sequence);
    `);
  }

  append(event: HarborEvent) {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO signals(id, source, session_id, received_at, payload) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        event.id,
        event.source,
        event.sessionId,
        event.receivedAt,
        JSON.stringify(event),
      );
  }

  recent(limit = EVENT_LIMIT): HarborEvent[] {
    const rows = this.db
      .prepare("SELECT payload FROM signals ORDER BY sequence DESC LIMIT ?")
      .all(limit) as { payload: string }[];
    return rows.reverse().map((row) => JSON.parse(row.payload) as HarborEvent);
  }

  metadata(source: string, sessionId: string) {
    const row = this.db
      .prepare(
        "SELECT payload FROM signals WHERE source = ? AND session_id = ? ORDER BY sequence DESC LIMIT 1",
      )
      .get(source, sessionId) as { payload: string } | undefined;
    if (!row) return undefined;
    const event = JSON.parse(row.payload) as HarborEvent;
    return { projectName: event.projectName, sessionName: event.sessionName };
  }

  history(
    source: string | null,
    sessionId: string | null,
    offset: number,
    before?: string,
  ) {
    const filter =
      source && sessionId ? "WHERE source = ? AND session_id = ?" : "";
    const args = source && sessionId ? [source, sessionId] : [];
    const total = (
      this.db
        .prepare(`SELECT COUNT(*) AS total FROM signals ${filter}`)
        .get(...args) as { total: number }
    ).total;
    const where = before
      ? `${filter} ${filter ? "AND" : "WHERE"} sequence < (SELECT sequence FROM signals WHERE id = ?)`
      : filter;
    if (before) args.push(before);
    const rows = this.db
      .prepare(
        `SELECT payload FROM signals ${where} ORDER BY sequence DESC LIMIT 50 OFFSET ?`,
      )
      .all(...args, offset) as { payload: string }[];
    return {
      total,
      events: rows.map((row) => JSON.parse(row.payload) as HarborEvent),
    };
  }

  close() {
    this.db.close();
  }
}
