import { createHash } from "node:crypto";

// Canonical request/return metadata stays in memory; only a digest is sent.
export function toolApprovalKey(input: Record<string, unknown>) {
  const { scopeId, sessionId, toolInput, toolName } = input;
  if (
    typeof sessionId !== "string" ||
    !sessionId.trim() ||
    sessionId.length > 120 ||
    typeof toolName !== "string" ||
    !toolName.trim() ||
    toolName.length > 120 ||
    typeof scopeId !== "string" ||
    !scopeId.trim() ||
    scopeId.length > 200 ||
    !toolInput ||
    typeof toolInput !== "object" ||
    Array.isArray(toolInput)
  )
    return;
  let argumentsToMatch: unknown = toolInput;
  if (toolName.trim() === "Bash" || toolName.trim() === "apply_patch") {
    const command = (toolInput as Record<string, unknown>).command;
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
          sessionId.trim(),
          scopeId.trim(),
          toolName.trim(),
          argumentsJson,
        ]),
      )
      .digest("hex");
  } catch {
    return;
  }
}
