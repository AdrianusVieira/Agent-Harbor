import { toolApprovalKey } from "./tool-approval-key.ts";

export function codexApprovalKey(input: Record<string, unknown>) {
  return toolApprovalKey({
    scopeId: input.turn_id,
    sessionId: input.session_id,
    toolInput: input.tool_input,
    toolName: input.tool_name,
  });
}
