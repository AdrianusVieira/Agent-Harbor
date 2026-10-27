import type { TelemetryPeriod, TelemetrySource } from "../src/telemetryData.ts";
import type { TelemetryStores } from "./telemetryStore.ts";

const windowFor = (period: TelemetryPeriod) =>
  period === "all" ? null : period;

export function getClaudeAccounts(
  period: TelemetryPeriod,
  stores: TelemetryStores,
) {
  return {
    period,
    updatedAt: new Date().toISOString(),
    accounts: stores.claude.accounts(windowFor(period)).accounts,
  };
}

export function getSessionView(
  source: TelemetrySource,
  id: string,
  period: TelemetryPeriod,
  stores: TelemetryStores,
) {
  const window = windowFor(period);
  if (!id || id.length > 200) return null;
  const session =
    source === "claude"
      ? stores.claude.sessions(window).sessions.find((item) => item.id === id)
      : stores.codex.sessions(window).sessions.find((item) => item.id === id);
  if (!session) return null;
  const prompts =
    source === "claude"
      ? stores.claude.sessionPrompts(id, window)
      : stores.codex.sessionPrompts(id, window);
  const activity =
    source === "claude"
      ? stores.claude.sessionEvents(id, window, 0, 50)
      : stores.codex.sessionEvents(id, window, 0, 50);
  return {
    source,
    period,
    updatedAt: new Date().toISOString(),
    session,
    prompts: prompts.slice(0, 100),
    promptTotal: prompts.length,
    activity: activity.events,
    activityTotal: activity.total,
  };
}

export function getSessionEvents(
  source: TelemetrySource,
  id: string,
  period: TelemetryPeriod,
  offset: number,
  stores: TelemetryStores,
) {
  if (!id || id.length > 200) return null;
  const window = windowFor(period);
  const exists =
    source === "claude"
      ? stores.claude.sessions(window).sessions.some((item) => item.id === id)
      : stores.codex.sessions(window).sessions.some((item) => item.id === id);
  if (!exists) return null;
  return source === "claude"
    ? stores.claude.sessionEvents(id, window, offset, 50)
    : stores.codex.sessionEvents(id, window, offset, 50);
}
