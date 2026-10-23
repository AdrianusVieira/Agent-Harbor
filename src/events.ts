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
  source: string;
  sessionId: string;
  type: EventType;
  message: string;
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
