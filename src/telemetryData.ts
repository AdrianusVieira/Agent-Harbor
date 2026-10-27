export type TelemetrySource = "claude" | "codex";
export type TelemetryPeriod =
  1 | 2 | 7 | 30 | 90 | "all" | { start: number; end: number };

export type TelemetrySummary = {
  source: TelemetrySource;
  period: TelemetryPeriod;
  updatedAt: string;
  conversations: number;
  signalOnlyIds: number;
  prompts: number;
  tokens: number | null;
  apiRequests: number;
  errors: number;
  toolResults: number | null;
  estimatedCostUsd: number | null;
  partialCost: boolean;
  activeSeconds: number | null;
  avgTokensPerRequest: number | null;
  avgTokensPerPrompt: number | null;
  linkedPrompts: number | null;
  timeline: { timestamp: number; total: number }[];
  timelineEvents: number;
};

export type ClaudeAccount = {
  email: string;
  sessions: number;
  projects: string[];
  prompts: number;
  apiRequests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  activeUserSeconds: number | null;
  activeCliSeconds: number | null;
  estimatedCostUsd: number | null;
  missingCostSlices: number;
  firstSeen: number;
  lastSeen: number;
};

export type AccountOverview = {
  period: TelemetryPeriod;
  updatedAt: string;
  accounts: ClaudeAccount[];
};

type BaseSession = {
  id: string;
  firstSeen: number | null;
  lastSeen: number | null;
  prompts: number;
  apiRequests: number;
  errors: number;
  models: string[];
  medianRequestMs: number | null;
  activityCount: number;
};

export type ClaudeSession = BaseSession & {
  title: string;
  project: string;
  emails: string[];
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  activeUserSeconds: number | null;
  activeCliSeconds: number | null;
  estimatedCostUsd: number | null;
  tokenTimeline: {
    timestamp: number;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    promptId: string;
  }[];
};

export type CodexSession = BaseSession & {
  toolCalls: number;
  approvals: number;
  completedResponses: number;
  observedTokens: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningOutputTokens: number | null;
  toolStats: {
    tool: string;
    count: number;
    failures: number;
    medianDurationMs: number | null;
  }[];
  tokenTimeline: {
    timestamp: number;
    total: number;
    input: number | null;
    output: number | null;
  }[];
};

export type SessionPrompt = {
  id: string;
  timestamp: number;
  text: string | null;
  requests?: number;
  tokens?: number;
  costUsd?: number | null;
};
export type SessionActivity = {
  name: string;
  timestamp: number;
  durationMs: number | null;
  toolName?: string;
  tool?: string | null;
  status?: string | null;
  success?: string | boolean | null;
};

export type SessionView = {
  source: TelemetrySource;
  period: TelemetryPeriod;
  updatedAt: string;
  session: (ClaudeSession | CodexSession) & {
    name?: string;
    projectName?: string | null;
  };
  prompts: SessionPrompt[];
  promptTotal: number;
  activity: SessionActivity[];
  activityTotal: number;
  privateDetails: boolean;
};

export type SessionSummary = {
  id: string;
  name: string;
  project: string | null;
  lastSeen: number;
  models: string[];
  prompts: number;
  apiRequests: number;
  medianRequestMs: number | null;
  tokens: number | null;
  estimatedCostUsd: number | null;
};
