type SessionEvidence = Record<string, unknown>;

const positive = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

/** A startup or completion signal alone does not establish a worked-on Codex conversation. */
export function hasCodexWork(session: SessionEvidence): boolean {
  // Keep older callers without this field compatible; the local store always supplies it.
  if (typeof session.hasUserPrompt !== "boolean") return true;
  return (
    positive(session.prompts) ||
    positive(session.apiRequests) ||
    positive(session.toolCalls) ||
    (session.hasUserPrompt && positive(session.completedResponses))
  );
}
