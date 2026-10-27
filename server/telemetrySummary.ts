import type {
  TelemetryPeriod,
  TelemetrySource,
  TelemetrySummary,
} from "../src/telemetryData.ts";
import type { TelemetryStores } from "./telemetryStore.ts";
import { hasCodexWork } from "./codexSessionEvidence.ts";

type Raw = Record<string, unknown>;
const object = (value: unknown): Raw =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Raw)
    : {};
const count = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
const optional = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;

function timeline(
  rows: Raw[],
  source: TelemetrySource,
): {
  points: TelemetrySummary["timeline"];
  events: number;
  linkedPrompts: number | null;
  promptAverage: number | null;
  requestAverage: number | null;
} {
  const points: { timestamp: number; tokens: number }[] = [];
  const groups = new Map<string, number>();
  for (const row of rows) {
    const id = typeof row.id === "string" ? row.id : "";
    const entries = Array.isArray(row.tokenTimeline) ? row.tokenTimeline : [];
    for (const entry of entries) {
      const point = object(entry);
      const timestamp = count(point.timestamp);
      const tokens =
        source === "claude"
          ? count(point.input) +
            count(point.output) +
            count(point.cacheRead) +
            count(point.cacheWrite)
          : count(point.total);
      if (!timestamp || !tokens) continue;
      points.push({ timestamp, tokens });
      if (
        source === "claude" &&
        typeof point.promptId === "string" &&
        point.promptId
      ) {
        const key = `${id}:${point.promptId}`;
        groups.set(key, (groups.get(key) || 0) + tokens);
      }
    }
  }
  points.sort((a, b) => a.timestamp - b.timestamp);
  const events = points.length;
  // Keep the cumulative shape while bounding the response size for long histories.
  const bucketSize = Math.max(1, Math.ceil(events / 160));
  let total = 0;
  const chart: TelemetrySummary["timeline"] = [];
  for (let index = 0; index < events; index++) {
    total += points[index].tokens;
    if ((index + 1) % bucketSize === 0 || index === events - 1)
      chart.push({ timestamp: points[index].timestamp, total });
  }
  return {
    points: chart,
    events,
    linkedPrompts: source === "claude" ? groups.size : null,
    promptAverage:
      source === "claude" && groups.size
        ? [...groups.values()].reduce((sum, value) => sum + value, 0) /
          groups.size
        : null,
    requestAverage: events ? total / events : null,
  };
}

export function summarizeTelemetry(
  source: TelemetrySource,
  period: TelemetryPeriod,
  payload: unknown,
): TelemetrySummary {
  const sessions = object(payload).sessions;
  if (!Array.isArray(sessions))
    throw new Error("Telemetry response has no sessions array");
  const rows = sessions.map(object);
  const conversationRows =
    source === "codex" ? rows.filter(hasCodexWork) : rows;
  const sum = (key: string) =>
    rows.reduce((total, row) => total + count(row[key]), 0);
  const chart = timeline(rows, source);
  const costs = rows
    .map((row) => optional(row.estimatedCostUsd))
    .filter((value): value is number => value !== null);
  const active = rows
    .flatMap((row) => [
      optional(row.activeUserSeconds),
      optional(row.activeCliSeconds),
    ])
    .filter((value): value is number => value !== null);
  return {
    source,
    period,
    updatedAt: new Date().toISOString(),
    conversations: conversationRows.length,
    signalOnlyIds: rows.length - conversationRows.length,
    prompts: sum("prompts"),
    tokens:
      source === "claude"
        ? sum("inputTokens") +
          sum("outputTokens") +
          sum("cacheReadTokens") +
          sum("cacheCreationTokens")
        : rows.some((row) => optional(row.observedTokens) !== null)
          ? sum("observedTokens")
          : null,
    apiRequests: sum("apiRequests"),
    errors: sum("errors"),
    toolResults: source === "codex" ? sum("toolCalls") : null,
    estimatedCostUsd:
      source === "claude" && costs.length
        ? costs.reduce((a, b) => a + b, 0)
        : null,
    partialCost:
      source === "claude" && costs.length > 0 && costs.length < rows.length,
    activeSeconds:
      source === "claude" && active.length
        ? active.reduce((a, b) => a + b, 0)
        : null,
    avgTokensPerRequest: source === "claude" ? chart.requestAverage : null,
    avgTokensPerPrompt: source === "claude" ? chart.promptAverage : null,
    linkedPrompts: chart.linkedPrompts,
    timeline: chart.points,
    timelineEvents: chart.events,
  };
}

export function getTelemetrySummary(
  source: TelemetrySource,
  period: TelemetryPeriod,
  stores: TelemetryStores,
): TelemetrySummary {
  const window = period === "all" ? null : period;
  return summarizeTelemetry(
    source,
    period,
    source === "claude"
      ? stores.claude.sessions(window)
      : stores.codex.sessions(window),
  );
}
