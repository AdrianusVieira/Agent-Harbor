export const eventTypes = [
  "started",
  "activity",
  "waiting",
  "ready",
  "error",
  "ended",
] as const;
export type EventType = (typeof eventTypes)[number];

export interface EventInput {
  message: string;
  projectName?: string;
  sessionId: string;
  sessionName?: string;
  source: string;
  type: EventType;
}

export interface HarborEvent extends EventInput {
  id: string;
  receivedAt: string;
}

export const eventLabels: Record<EventType, string> = {
  started: "started",
  activity: "working",
  waiting: "needs input",
  ready: "reply ready",
  error: "error",
  ended: "ended",
};

export const eventSymbols: Record<EventType, string> = {
  started: "↗",
  activity: "·",
  waiting: "?",
  ready: "✓",
  error: "!",
  ended: "—",
};

export const EVENT_LIMIT = 500;

export const platformNames: Record<string, string> = {
  "claude-code": "Claude Code",
  "claude-desktop": "Claude Desktop",
  codex: "Codex",
};

export function sessionKey(event: Pick<HarborEvent, "source" | "sessionId">) {
  return JSON.stringify([event.source, event.sessionId]);
}
