import { toolApprovalKey } from "./tool-approval-key.ts";

export function claudeApprovalKey(input: Record<string, unknown>) {
  let toolInput = input.tool_input;
  if (input.tool_name === "AskUserQuestion") {
    if (!toolInput || typeof toolInput !== "object" || Array.isArray(toolInput))
      return;
    const { questions } = toolInput as Record<string, unknown>;
    if (
      !Array.isArray(questions) ||
      !questions.length ||
      questions.length > 4 ||
      !questions.every(
        (question) =>
          question &&
          typeof question === "object" &&
          !Array.isArray(question) &&
          typeof question.question === "string" &&
          question.question.trim(),
      )
    )
      return;
    // The permission UI adds answers/annotations before execution. Match the
    // questions, never the user's answer or other response-only fields.
    toolInput = { questions };
  }
  return toolApprovalKey({
    scopeId: input.prompt_id,
    sessionId: input.session_id,
    toolInput,
    toolName: input.tool_name,
  });
}
