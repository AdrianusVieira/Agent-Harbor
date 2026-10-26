import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { readDesktopSnapshot } from "./claude-desktop-cache.ts";

export function createDesktopWatcher(
  directory: string,
  port: number,
  now = Date.now,
) {
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid local receiver port.");
  let lastSequence: bigint | undefined;
  let observedAfter = now();
  const seen = new Map<string, "ready" | "waiting">();

  // Call serially: a slow receiver must not cause overlapping cache scans.
  return async function poll() {
    const snapshot = await readDesktopSnapshot(directory);
    const baseline =
      lastSequence === undefined ||
      snapshot.lastSequence < lastSequence ||
      (snapshot.firstSequence !== undefined &&
        snapshot.firstSequence > lastSequence + 1n);
    const previous = lastSequence;
    lastSequence = snapshot.lastSequence;
    if (baseline) observedAfter = Math.max(observedAfter, now());
    let delivered = 0;
    let failed = 0;

    for (const item of snapshot.observations) {
      const key = `${item.event.sessionId}:${item.messageId}`;
      const previousType = seen.get(key);
      // A later cache write may add a question to the same response. Waiting
      // takes precedence and cannot turn back into ready for that message ID.
      if (previousType === "waiting" || previousType === item.event.type)
        continue;
      seen.set(key, item.event.type);
      if (seen.size > 10_000) seen.delete(seen.keys().next().value!);
      // Late loading/renaming of an old response is not a new completion.
      if (
        baseline ||
        item.sequence <= previous! ||
        item.messageAt <= observedAfter
      )
        continue;
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/events`, {
          body: JSON.stringify(item.event),
          headers: { "Content-Type": "application/json" },
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(1500),
        });
        await response.body?.cancel();
        if (!response.ok) throw new Error("Receiver rejected the event.");
        delivered++;
      } catch {
        // Best effort, no retry queue or duplicate submission on the next scan.
        failed++;
      }
    }
    return {
      baseline,
      delivered,
      failed,
      observed: snapshot.observations.length,
      reset: baseline && previous !== undefined,
      skipped: snapshot.skipped,
    };
  };
}

async function main() {
  if (process.argv.slice(2).some((arg) => arg !== "--once"))
    throw new Error("Unsupported watcher argument.");
  const directory =
    process.env.CLAUDE_DESKTOP_CACHE_DIR ||
    join(
      homedir(),
      "Library",
      "Application Support",
      "Claude",
      "IndexedDB",
      "https_claude.ai_0.indexeddb.leveldb",
    );
  const poll = createDesktopWatcher(
    directory,
    Number(process.env.HARBOR_PORT ?? "5173"),
  );
  const once = process.argv.includes("--once");
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  console.log(
    "Agent Harbor: experimental Claude Desktop watcher. Existing history is ignored.",
  );
  let unavailable = false;
  let skipped = false;
  try {
    do {
      try {
        const result = await poll();
        if (result.baseline)
          console.log(
            `Agent Harbor: baseline loaded (${result.observed} cached response observations). Waiting for new responses.`,
          );
        if (result.reset)
          console.error(
            "Agent Harbor: cache sequence changed; established a new baseline without replaying history.",
          );
        if (result.skipped && !skipped)
          console.error(
            "Agent Harbor: unsupported cache records skipped. Coverage is incomplete.",
          );
        if (result.failed)
          console.error(
            "Agent Harbor: Desktop event delivery failed. Check the local dev server. Events are not retried.",
          );
        if (result.delivered)
          console.log(
            `Agent Harbor: delivered ${result.delivered} Desktop event(s).`,
          );
        if (unavailable) console.log("Agent Harbor: cache reading resumed.");
        skipped = result.skipped > 0;
        unavailable = false;
      } catch {
        if (once) throw new Error("Cache read failed.");
        if (!unavailable)
          console.error(
            "Agent Harbor: cache unavailable, corrupt, or unsupported. Monitoring paused; retrying.",
          );
        unavailable = true;
      }
      if (!once)
        await setTimeout(1000, undefined, { signal: controller.signal });
    } while (!once && !controller.signal.aborted);
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch(() => {
    console.error(
      "Agent Harbor: watcher could not start. Check the cache directory, arguments, and HARBOR_PORT.",
    );
    process.exitCode = 1;
  });
}
