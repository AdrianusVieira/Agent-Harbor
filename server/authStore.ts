import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { chmodSync, existsSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { privateDataDirectory } from "./telemetryStore.ts";

export const SESSION_SECONDS = 12 * 60 * 60;
type Owner = {
  username: string;
  salt: string;
  password_hash: string;
  generation: string;
};
const digest = (value: string) => createHash("sha256").update(value).digest();
const passwordHash = (password: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password,
      Buffer.from(salt, "hex"),
      32,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });

export function validCredentials(
  username: unknown,
  password: unknown,
): username is string {
  return (
    typeof username === "string" &&
    /^[A-Za-z0-9._-]{3,80}$/.test(username) &&
    typeof password === "string" &&
    password.length >= 12 &&
    password.length <= 1024
  );
}

export class AuthStore {
  private db: Database.Database;
  constructor(directory: string) {
    const path = join(privateDataDirectory(directory), "auth.sqlite3");
    this.db = new Database(path);
    chmodSync(path, 0o600);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS owner (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1), username TEXT NOT NULL,
        salt TEXT NOT NULL, password_hash TEXT NOT NULL, generation TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS browser_sessions (
        token_hash TEXT PRIMARY KEY, generation TEXT NOT NULL,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
      );
    `);
    for (const suffix of ["", "-wal", "-shm"])
      if (existsSync(path + suffix)) chmodSync(path + suffix, 0o600);
    this.db
      .prepare("DELETE FROM browser_sessions WHERE expires_at <= ?")
      .run(Date.now());
  }
  configured() {
    return !!this.db.prepare("SELECT 1 FROM owner WHERE singleton = 1").get();
  }

  async createOwner(username: string, password: string) {
    if (!validCredentials(username, password))
      throw new Error("Invalid credentials.");
    const salt = randomBytes(16).toString("hex"),
      hash = await passwordHash(password, salt);
    return (
      this.db
        .prepare("INSERT OR IGNORE INTO owner VALUES (1, ?, ?, ?, ?)")
        .run(username, salt, hash.toString("hex"), randomUUID()).changes === 1
    );
  }

  async verify(username: string, password: string): Promise<string | null> {
    const owner = this.db
      .prepare("SELECT * FROM owner WHERE singleton = 1")
      .get() as Owner | undefined;
    if (!owner) return null;
    const candidate = await passwordHash(password, owner.salt);
    const correctPassword = timingSafeEqual(
      candidate,
      Buffer.from(owner.password_hash, "hex"),
    );
    const correctUsername = timingSafeEqual(
      digest(username),
      digest(owner.username),
    );
    return correctPassword && correctUsername ? owner.generation : null;
  }

  createSession(generation: string, now = Date.now()) {
    const token = randomBytes(32).toString("base64url"),
      hash = digest(token).toString("hex");
    const created = this.db.transaction(() => {
      this.db
        .prepare("DELETE FROM browser_sessions WHERE expires_at <= ?")
        .run(now);
      const inserted = this.db
        .prepare(
          "INSERT INTO browser_sessions SELECT ?, generation, ?, ? FROM owner WHERE singleton = 1 AND generation = ?",
        )
        .run(hash, now, now + SESSION_SECONDS * 1000, generation).changes;
      this.db
        .prepare(
          "DELETE FROM browser_sessions WHERE token_hash IN (SELECT token_hash FROM browser_sessions ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET 64)",
        )
        .run();
      return inserted;
    })();
    return created ? token : null;
  }

  session(token: string | undefined, now = Date.now()) {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    return (
      (this.db
        .prepare(
          `SELECT owner.username, browser_sessions.expires_at AS expiresAt
      FROM browser_sessions JOIN owner USING(generation) WHERE token_hash = ? AND expires_at > ?`,
        )
        .get(digest(token).toString("hex"), now) as
        { username: string; expiresAt: number } | undefined) ?? null
    );
  }
  logout(token: string | undefined) {
    if (token)
      this.db
        .prepare("DELETE FROM browser_sessions WHERE token_hash = ?")
        .run(digest(token).toString("hex"));
  }
  reset() {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM browser_sessions").run();
      this.db.prepare("DELETE FROM owner").run();
    })();
  }
  close() {
    this.db.close();
  }
}
