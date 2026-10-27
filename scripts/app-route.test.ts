import assert from "node:assert/strict";
import { test } from "node:test";
import {
  appRouteHash,
  parseAppRoute,
  type AppRoute,
} from "../src/app-route.ts";

test("page bookmarks preserve exact source/session identity and tolerate malformed URLs", () => {
  const routes: AppRoute[] = [
    { page: "harbor" },
    { page: "telemetry" },
    { page: "telemetry", telemetryPage: "dashboard" },
    { page: "telemetry", telemetryPage: "sessions" },
    { page: "telemetry", telemetryPage: "accounts" },
    { page: "telemetry", telemetryPage: "dashboard", telemetrySource: "codex" },
    { page: "telemetry", telemetryPage: "sessions", telemetrySource: "claude" },
    {
      page: "telemetry",
      telemetryPage: "sessions",
      usageTarget: { source: "codex", id: "same / ? # session" },
    },
    { page: "settings" },
    { page: "history" },
    { page: "harbor", sessionKey: "*" },
    {
      page: "harbor",
      sessionKey: JSON.stringify(["claude-code", "same / ? # session"]),
    },
    {
      page: "harbor",
      sessionKey: JSON.stringify(["codex", "same / ? # session"]),
    },
    {
      page: "telemetry",
      usageTarget: { source: "codex", id: "same / ? # session" },
    },
    { page: "telemetry", telemetrySource: "codex" },
  ];
  for (const route of routes)
    assert.deepEqual(parseAppRoute(appRouteHash(route)), route);
  for (const hash of [
    "",
    "#/not-a-page",
    "#/telemetry/unknown/id",
    "#/harbor/session/codex",
    "#/telemetry/codex/%ZZ",
    "#/telemetry/sessions/unknown/id",
    "#/telemetry/accounts/codex",
    "#/telemetry/dashboard/claude/session-id",
  ])
    assert.deepEqual(parseAppRoute(hash), { page: "harbor" });
});

test("old bookmarks still resolve to their matching section and page", () => {
  assert.deepEqual(parseAppRoute("#/signals"), { page: "history" });
  assert.deepEqual(parseAppRoute("#/settings"), { page: "settings" });
  assert.deepEqual(parseAppRoute("#/telemetry/codex/session-id"), {
    page: "telemetry",
    usageTarget: { source: "codex", id: "session-id" },
  });
});
