import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppShell } from "../src/AppShell.tsx";
import { parseAppRoute } from "../src/app-route.ts";

test("sidebar renders the two requested groups and selects one page, including session detail bookmarks", () => {
  for (const [hash, active] of [
    ["#/harbor/dashboard", "Dashboard"],
    ["#/harbor/signals", "Signal History"],
    ["#/harbor/notifications", "Notification Settings"],
    ["#/telemetry/dashboard", "Dashboard"],
    ["#/telemetry/sessions", "Sessions"],
    ["#/telemetry/accounts", "Accounts"],
    ["#/telemetry/sessions/codex/exact-id", "Sessions"],
    ["#/telemetry/codex/exact-id", "Sessions"],
  ]) {
    const markup = renderToStaticMarkup(
      createElement(AppShell, {
        children: createElement("main"),
        connection: "connected",
        mark: null,
        onNavigate: () => {},
        route: parseAppRoute(hash),
      }),
    );
    const selected = [
      ...markup.matchAll(/<a\b[^>]*aria-current="page"[^>]*>([^<]*)<\/a>/g),
    ].map((match) => match[1]);
    assert.deepEqual(selected, [active], hash);
    for (const [group, labels] of [
      ["Harbor", ["Dashboard", "Signal History", "Notification Settings"]],
      ["Telemetry", ["Dashboard", "Sessions", "Accounts"]],
    ] as const) {
      const section = markup.match(
        new RegExp(
          `<section[^>]*aria-label="${group}"[^>]*>([\\s\\S]*?)<\\/section>`,
        ),
      );
      assert.ok(section, group);
      assert.deepEqual(
        [...section[1].matchAll(/<a\b[^>]*>([^<]*)<\/a>/g)].map(
          (match) => match[1],
        ),
        labels,
      );
    }
  }
});
