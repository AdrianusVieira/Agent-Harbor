import { createHash } from "node:crypto";

// Match request/return metadata without sending tool arguments or turn IDs.
// PermissionRequest doesn't expose PostToolUse's tool_use_id. For shell/patch
// calls, command is shared; the request-only approval description isn't.
export function codexApprovalKey(input: Record<string, unknown>) {
  const { session_id, tool_input, tool_name, turn_id } = input;
  if (
    typeof session_id !== "string" ||
    !session_id.trim() ||
    session_id.length > 120 ||
    typeof tool_name !== "string" ||
    !tool_name.trim() ||
    tool_name.length > 120 ||
    typeof turn_id !== "string" ||
    !turn_id.trim() ||
    turn_id.length > 200 ||
    !tool_input ||
    typeof tool_input !== "object" ||
    Array.isArray(tool_input)
  )
    return;
  let argumentsToMatch: unknown = tool_input;
  if (tool_name.trim() === "Bash" || tool_name.trim() === "apply_patch") {
    const command = (tool_input as Record<string, unknown>).command;
    if (typeof command !== "string" || !command.trim()) return;
    argumentsToMatch = { command };
  }
  let remaining = 10_000;
  function canonical(value: unknown, depth = 0): string {
    if (--remaining < 0 || depth > 20) throw new Error("Input exceeds limit.");
    if (Array.isArray(value))
      return `[${value.map((item) => canonical(item, depth + 1)).join(",")}]`;
    if (value && typeof value === "object")
      return `{${Object.keys(value)
        .sort()
        .map(
          (key) =>
            `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key], depth + 1)}`,
        )
        .join(",")}}`;
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("Unsupported input.");
    return encoded;
  }
  try {
    const argumentsJson = canonical(argumentsToMatch);
    if (argumentsJson.length > 131_072) return;
    return createHash("sha256")
      .update(
        JSON.stringify([
          session_id.trim(),
          turn_id.trim(),
          tool_name.trim(),
          argumentsJson,
        ]),
      )
      .digest("hex");
  } catch {
    return;
  }
}
