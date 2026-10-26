import { claudeApprovalKey } from "./claude-approval-key.ts";

// Quietly settle tracked waits; never forward results or influence Claude.
try {
  let body = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    body += chunk;
    if (Buffer.byteLength(body) > 1_048_576)
      throw new Error("Input too large.");
  }
  const input: unknown = JSON.parse(body);
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Invalid hook payload.");
  const payload = input as Record<string, unknown>;
  if (
    (payload.hook_event_name === "PostToolUse" ||
      payload.hook_event_name === "PostToolUseFailure") &&
    payload.is_interrupt !== true
  ) {
    const approvalKey = claudeApprovalKey(payload);
    if (approvalKey) {
      const port = Number(process.env.HARBOR_PORT ?? "5173");
      if (!Number.isInteger(port) || port < 1 || port > 65535)
        throw new Error("Invalid local receiver port.");
      const response = await fetch(
        `http://127.0.0.1:${port}/api/claude-code/tool-returned`,
        {
          body: JSON.stringify({
            approvalKey,
            sessionId: (payload.session_id as string).trim(),
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(1500),
        },
      );
      await response.body?.cancel();
      if (!response.ok) throw new Error("Receiver rejected the observation.");
    }
  }
} catch {
  console.error(
    "Agent Harbor: Claude Code tool-return observation not delivered. Check the hook input and local dev server.",
  );
}
