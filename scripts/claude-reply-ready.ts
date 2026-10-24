import type { EventInput } from "../src/events.ts";

// Observe a finished response without returning feedback that could continue it.
try {
  let body = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) body += chunk;

  const input: unknown = JSON.parse(body);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid hook payload.");
  }
  const { hook_event_name, session_id } = input as Record<string, unknown>;

  if (hook_event_name === "Stop") {
    if (
      typeof session_id !== "string" ||
      !session_id.trim() ||
      session_id.length > 120
    ) {
      throw new Error("Invalid session ID.");
    }

    const port = Number(process.env.HARBOR_PORT ?? "5173");
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("Invalid local receiver port.");
    }

    const event: EventInput = {
      message: "Claude Code finished its response.",
      sessionId: session_id.trim(),
      source: "claude-code",
      type: "ready",
    };
    const response = await fetch(`http://127.0.0.1:${port}/api/events`, {
      body: JSON.stringify(event),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(1500),
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error("Receiver rejected the event.");
  }
} catch {
  // Always exit normally; this monitor must never ask Claude to keep working.
  console.error(
    "Agent Harbor: reply-ready event not delivered. Check the hook input and local dev server.",
  );
}
