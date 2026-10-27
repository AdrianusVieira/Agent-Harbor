import { join } from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { Store as ClaudeStore } from "./collectors/claude/store.ts";
import { Store as CodexStore } from "./collectors/codex/store.ts";
import { getTelemetrySummary } from "./telemetrySummary.ts";
import {
  getClaudeAccounts,
  getSessionEvents,
  getSessionView,
} from "./telemetryViews.ts";
import type { TelemetryQuery } from "./telemetryQueries.ts";

const stores = {
  claude: new ClaudeStore(join(workerData.directory, "claude.sqlite3"), true),
  codex: new CodexStore(join(workerData.directory, "codex.sqlite3"), true),
};
const caches: Map<string, { at: number; value: unknown }>[] = [];
function cached<Argument, Result>(
  read: (argument: Argument) => Result,
): (argument: Argument) => Result {
  const cache = new Map<string, { at: number; value: unknown }>();
  caches.push(cache);
  return (argument) => {
    const key = JSON.stringify(argument),
      previous = cache.get(key);
    if (previous && Date.now() - previous.at < 15_000)
      return previous.value as Result;
    const value = read(argument);
    cache.set(key, { at: Date.now(), value });
    if (cache.size > 8) cache.delete(cache.keys().next().value!);
    return value;
  };
}
stores.claude.sessions = cached(stores.claude.sessions.bind(stores.claude));
stores.codex.sessions = cached(stores.codex.sessions.bind(stores.codex));

parentPort!.on(
  "message",
  (query: TelemetryQuery | { kind: "invalidate" } | { kind: "close" }) => {
    if (query.kind === "close") {
      stores.claude.close();
      stores.codex.close();
      parentPort!.close();
      return;
    }
    if (query.kind === "invalidate") {
      for (const cache of caches) cache.clear();
      return;
    }
    const { id, kind, source, period, sessionId, offset } = query;
    try {
      const window = period === "all" ? null : period;
      let result: unknown;
      switch (kind) {
        case "summary":
          result = getTelemetrySummary(source, period, stores);
          break;
        case "sessions":
          result =
            source === "claude"
              ? stores.claude.sessions(window).sessions
              : stores.codex.sessions(window).sessions;
          break;
        case "accounts":
          result = getClaudeAccounts(period, stores);
          break;
        case "view":
          result = getSessionView(source, sessionId!, period, stores);
          break;
        case "events":
          result = getSessionEvents(
            source,
            sessionId!,
            period,
            offset ?? 0,
            stores,
          );
          break;
        case "prompts": {
          const prompts =
            source === "claude"
              ? stores.claude.sessionPrompts(sessionId!, window)
              : stores.codex.sessionPrompts(sessionId!, window);
          result = {
            total: prompts.length,
            prompts: prompts.slice(offset ?? 0, (offset ?? 0) + 100),
          };
          break;
        }
      }
      parentPort!.postMessage({ id, result });
    } catch {
      parentPort!.postMessage({
        id,
        error: "Could not query local telemetry.",
      });
    }
  },
);
parentPort!.postMessage({ ready: true });
