import type { IncomingMessage, ServerResponse } from "node:http";
import { periodFrom } from "./telemetryRange.ts";
import { isLoopback, sendJson } from "./telemetryReceiver.ts";
import type { TelemetryQueries } from "./telemetryQueries.ts";
import type { SignalStore } from "./signalStore.ts";

export function createTelemetryApi(
  queries: TelemetryQueries,
  signals: SignalStore,
  authenticated?: (request: IncomingMessage) => boolean,
) {
  return async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<boolean> => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (
      !url.pathname.startsWith("/api/telemetry") &&
      url.pathname !== "/api/history"
    )
      return false;
    const reply = (status: number, data: unknown) => {
      sendJson(response, status, data);
      return true;
    };
    if (
      request.headers.origin &&
      request.headers.origin !== `http://${request.headers.host}`
    )
      return reply(403, { error: "Cross-origin requests are not accepted." });
    if (request.method !== "GET")
      return reply(405, { error: "Read-only endpoint." });
    const offset = Number(url.searchParams.get("offset") ?? "0");
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10_000_000)
      return reply(400, { error: "Invalid history offset." });
    // A foreign Host must never unlock private data through DNS rebinding.
    const privateDetails = authenticated
      ? authenticated(request)
      : isLoopback(request.socket.remoteAddress) &&
        /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(
          request.headers.host ?? "",
        );
    try {
      if (url.pathname === "/api/history") {
        const source = url.searchParams.get("source"),
          id = url.searchParams.get("sessionId");
        if (Boolean(source) !== Boolean(id))
          return reply(400, { error: "Specify both source and sessionId." });
        return reply(
          200,
          signals.history(
            source,
            id,
            offset,
            url.searchParams.get("before") ?? undefined,
          ),
        );
      }
      const period = periodFrom(url);
      if (period === null) return reply(400, { error: "Invalid time range." });
      if (url.pathname === "/api/telemetry/claude/accounts") {
        if (!privateDetails)
          return reply(403, {
            error: "Log in to view account details.",
          });
        return reply(200, await queries.request("accounts", "claude", period));
      }
      const match =
        /^\/api\/telemetry\/(claude|codex)(?:\/sessions(?:\/([^/]+)(\/(?:events|prompts))?)?)?$/.exec(
          url.pathname,
        );
      if (!match) return reply(404, { error: "Unknown telemetry endpoint." });
      const source = match[1] as "claude" | "codex";
      const hookSource = source === "claude" ? "claude-code" : source;
      if (!url.pathname.endsWith("/sessions") && !match[2])
        return reply(200, await queries.request("summary", source, period));
      if (!match[2]) {
        const rows = await queries.request("sessions", source, period);
        const sessions = rows.map((row) => {
          const meta = signals.metadata(hookSource, row.id);
          // Return an explicit summary: no account emails, prompt IDs or text.
          const claude = "inputTokens" in row && "title" in row ? row : null;
          return {
            id: row.id,
            name: meta?.sessionName ?? (claude?.title || row.id.slice(0, 8)),
            project: meta?.projectName ?? claude?.project ?? null,
            lastSeen: row.lastSeen,
            models: row.models,
            prompts: row.prompts,
            apiRequests: row.apiRequests,
            medianRequestMs: row.medianRequestMs,
            tokens: claude
              ? claude.inputTokens +
                claude.outputTokens +
                claude.cacheReadTokens +
                claude.cacheCreationTokens
              : "observedTokens" in row
                ? row.observedTokens
                : null,
            estimatedCostUsd: claude?.estimatedCostUsd ?? null,
          };
        });
        return reply(200, { sessions, privateDetails });
      }
      const id = decodeURIComponent(match[2]);
      if (!id || id.length > 200)
        return reply(400, { error: "Invalid session ID." });
      if (match[3] === "/prompts") {
        const page = await queries.request(
          "prompts",
          source,
          period,
          id,
          offset,
        );
        return reply(200, {
          total: page.total,
          prompts: page.prompts.map((prompt) => ({
            ...prompt,
            text: privateDetails ? prompt.text : null,
          })),
        });
      }
      if (match[3] === "/events") {
        const history = await queries.request(
          "events",
          source,
          period,
          id,
          offset,
        );
        return reply(
          history ? 200 : 404,
          history ?? { error: "Session not found." },
        );
      }
      const view = await queries.request("view", source, period, id);
      if (!view)
        return reply(404, { error: "Session not found in this period." });
      const meta = signals.metadata(hookSource, id);
      const session = {
        ...view.session,
        name:
          meta?.sessionName ??
          ("title" in view.session ? view.session.title : id.slice(0, 8)),
        projectName:
          meta?.projectName ??
          ("project" in view.session ? view.session.project : null),
      };
      if (!privateDetails && "emails" in session) {
        session.emails = [];
        if ("email" in session) session.email = "";
      }
      return reply(200, {
        ...view,
        session,
        privateDetails,
        prompts: view.prompts.map((prompt) => ({
          ...prompt,
          text: privateDetails ? prompt.text : null,
        })),
      });
    } catch (error) {
      return reply(error instanceof URIError ? 400 : 500, {
        error: "Could not read local telemetry.",
      });
    }
  };
}
