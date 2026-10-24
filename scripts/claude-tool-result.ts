import type { EventInput } from "../src/events.ts";

// A tool result is evidence of progress after execution, not an approval event.
try {
  let body = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) body += chunk;

  const input: unknown = JSON.parse(body);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid hook payload.");
  }
  const { hook_event_name, is_interrupt, session_id, tool_name } =
    input as Record<string, unknown>;

  if (
    hook_event_name === "PostToolUse" ||
    hook_event_name === "PostToolUseFailure"
  ) {
    if (
      typeof session_id !== "string" ||
      !session_id.trim() ||
      session_id.length > 120
    ) {
      throw new Error("Invalid session ID.");
    }
    if (
      typeof tool_name !== "string" ||
      !tool_name.trim() ||
      tool_name.length > 120
    ) {
      throw new Error("Invalid tool name.");
    }

    const port = Number(process.env.HARBOR_PORT ?? "5173");
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("Invalid local receiver port.");
    }

    const succeeded = hook_event_name === "PostToolUse";
    const event: EventInput = {
      message: succeeded
        ? `Claude Code finished using ${tool_name.trim()}.`
        : is_interrupt === true
          ? `Claude Code was interrupted while using ${tool_name.trim()}.`
          : `Claude Code encountered an error while using ${tool_name.trim()}.`,
      sessionId: session_id.trim(),
      source: "claude-code",
      type: succeeded ? "activity" : "error",
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
  console.error(
    "Agent Harbor: tool-result event not delivered. Check the hook input and local dev server.",
  );
}
