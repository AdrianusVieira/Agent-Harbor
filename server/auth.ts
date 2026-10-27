import type { IncomingMessage, ServerResponse } from "node:http";
import { isIP } from "node:net";
import { AuthStore, SESSION_SECONDS, validCredentials } from "./authStore.ts";
import { isLoopback, sendJson } from "./telemetryReceiver.ts";

const COOKIE = "harbor_session";
const localHost = (host: string) =>
  /^(localhost|127\.0\.0\.1|\[::1\])$/.test(host);
export function allowedHost(req: IncomingMessage) {
  try {
    const host = new URL(`http://${req.headers.host}`).hostname;
    if (localHost(host)) return true;
    if (isIP(host) !== 4) return false;
    const [a, b] = host.split(".").map(Number);
    return (
      a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    );
  } catch {
    return false;
  }
}
export function localSetup(req: IncomingMessage) {
  try {
    return (
      isLoopback(req.socket.remoteAddress) &&
      localHost(new URL(`http://${req.headers.host}`).hostname)
    );
  } catch {
    return false;
  }
}
function origin(req: IncomingMessage) {
  return `${"encrypted" in req.socket && req.socket.encrypted ? "https" : "http"}://${req.headers.host}`;
}
function token(req: IncomingMessage) {
  return req.headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
}

export class BrowserAuth {
  private store: AuthStore;
  private closed = false;
  private busy = 0;
  private attempts = new Map<string, { count: number; until: number }>();
  private inFlight = new Set<Promise<unknown>>();
  private requests = new Set<IncomingMessage>();
  constructor(directory: string) {
    this.store = new AuthStore(directory);
  }
  authenticated(req: IncomingMessage) {
    return !this.closed && allowedHost(req) && !!this.store.session(token(req));
  }

  // Only the existing local command senders may bypass browser login, only on
  // their exact write endpoints. A GET, browser Origin, or LAN peer never can.
  localExporter(req: IncomingMessage) {
    return (
      req.method === "POST" &&
      localSetup(req) &&
      !req.headers.origin &&
      [
        "/api/events",
        "/api/codex/tool-returned",
        "/api/claude-code/tool-returned",
      ].includes(req.url?.split("?")[0] ?? "")
    );
  }

  async protect(req: IncomingMessage, res: ServerResponse) {
    if (await this.handle(req, res)) return true;
    const path = req.url?.split("?")[0] ?? "";
    if (!path.startsWith("/api/")) return false;
    if (
      [
        "/api/events",
        "/api/codex/tool-returned",
        "/api/claude-code/tool-returned",
      ].includes(path) &&
      req.method === "POST"
    ) {
      if (this.localExporter(req)) return false;
      sendJson(res, 403, {
        error: "Only local agent senders may submit events.",
      });
      return true;
    }
    if (
      !allowedHost(req) ||
      (req.headers.origin && req.headers.origin !== origin(req))
    ) {
      sendJson(res, 403, { error: "Cross-origin requests are not accepted." });
      return true;
    }
    if (!this.authenticated(req)) {
      sendJson(res, 401, {
        error: "Log in to Harbor.",
        code: "login_required",
      });
      return true;
    }
    return false;
  }

  private rateLimited(peer: string) {
    const now = Date.now();
    for (const [key, bucket] of this.attempts)
      if (bucket.until <= now) this.attempts.delete(key);
    const keys = [peer, "all"];
    if (
      this.attempts.size > 1000 ||
      keys.some(
        (key) =>
          (this.attempts.get(key)?.count ?? 0) >= (key === "all" ? 80 : 10),
      )
    )
      return true;
    for (const key of keys) {
      const bucket = this.attempts.get(key) ?? {
        count: 0,
        until: now + 10 * 60_000,
      };
      bucket.count++;
      this.attempts.set(key, bucket);
    }
    return false;
  }

  async handle(req: IncomingMessage, res: ServerResponse) {
    const path = req.url?.split("?")[0];
    if (!path?.startsWith("/api/auth/")) return false;
    const reply = (status: number, body: unknown) => {
      sendJson(res, status, body);
      return true;
    };
    if (this.closed) return reply(503, { error: "Harbor is closing." });
    if (
      !allowedHost(req) ||
      (req.headers.origin && req.headers.origin !== origin(req))
    )
      return reply(403, { error: "Use Harbor's local or Wi-Fi address." });
    if (path === "/api/auth/session" && req.method === "GET") {
      const session = this.store.session(token(req));
      return reply(200, {
        configured: this.store.configured(),
        canSetup: localSetup(req),
        authenticated: !!session,
        username: session?.username,
        expiresAt: session?.expiresAt,
      });
    }
    if (
      !["/api/auth/setup", "/api/auth/login", "/api/auth/logout"].includes(path)
    )
      return reply(404, { error: "Unknown login endpoint." });
    if (req.method !== "POST") return reply(405, { error: "Use POST." });
    if (req.headers.origin !== origin(req))
      return reply(403, { error: "Same-origin browser request required." });
    const secure =
      "encrypted" in req.socket && req.socket.encrypted ? "; Secure" : "";
    if (path === "/api/auth/logout") {
      this.store.logout(token(req));
      res.setHeader(
        "Set-Cookie",
        `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`,
      );
      return reply(200, { authenticated: false });
    }
    if (path === "/api/auth/setup" && !localSetup(req))
      return reply(403, {
        error: "Create the first login from localhost on the Harbor computer.",
      });
    if (path === "/api/auth/setup" && this.store.configured())
      return reply(409, { error: "A login is already configured." });
    if (
      req.headers["content-type"]?.split(";")[0].trim() !== "application/json"
    )
      return reply(415, { error: "Use JSON." });
    if (
      this.busy >= 2 ||
      this.rateLimited(req.socket.remoteAddress ?? "unknown")
    ) {
      res.setHeader("Retry-After", "600");
      return reply(429, { error: "Too many login attempts. Try again later." });
    }
    this.busy++;
    this.requests.add(req);
    const deadline = setTimeout(() => req.destroy(), 10_000);
    deadline.unref();
    const operation = (async () => {
      try {
        let bytes = 0;
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          bytes += Buffer.byteLength(chunk);
          if (bytes > 8192)
            return reply(413, { error: "Login request is too large." });
          chunks.push(Buffer.from(chunk));
        }
        const data = JSON.parse(
          Buffer.concat(chunks).toString("utf8"),
        ) as Record<string, unknown>;
        if (!data || !validCredentials(data.username, data.password))
          return reply(400, {
            error:
              "Use a 3–80 character username (letters, numbers, dot, dash, underscore) and a password of 12–1024 characters.",
          });
        const username = data.username as string,
          password = data.password as string;
        if (
          path === "/api/auth/setup" &&
          !(await this.store.createOwner(username, password))
        )
          return reply(409, { error: "A login is already configured." });
        const generation = await this.store.verify(username, password);
        const session = generation && this.store.createSession(generation);
        if (!session)
          return reply(401, { error: "Incorrect username or password." });
        this.attempts.delete(req.socket.remoteAddress ?? "unknown");
        res.setHeader(
          "Set-Cookie",
          `${COOKIE}=${session}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${secure}`,
        );
        return reply(200, { authenticated: true, username });
      } catch (error) {
        if (res.destroyed) return true;
        return reply(error instanceof SyntaxError ? 400 : 500, {
          error: "Could not complete login.",
        });
      } finally {
        this.busy--;
        clearTimeout(deadline);
        this.requests.delete(req);
      }
    })();
    this.inFlight.add(operation);
    try {
      return await operation;
    } finally {
      this.inFlight.delete(operation);
    }
  }

  async close() {
    this.closed = true;
    for (const req of this.requests) if (!req.complete) req.destroy();
    await Promise.allSettled(this.inFlight);
    this.attempts.clear();
    this.store.close();
  }
}
