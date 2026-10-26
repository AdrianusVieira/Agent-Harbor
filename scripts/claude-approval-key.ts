import { toolApprovalKey } from "./tool-approval-key.ts";

export function claudeApprovalKey(input: Record<string, unknown>) {
  return toolApprovalKey({
    scopeId: input.prompt_id,
    sessionId: input.session_id,
    toolInput: input.tool_input,
    toolName: input.tool_name,
  });
}
