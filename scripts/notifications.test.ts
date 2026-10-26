import assert from "node:assert/strict";
import { test } from "node:test";
import type { HarborEvent } from "../src/events.ts";
import {
  defaultNotificationSettings, NotificationClaims, NotificationTracker,
  NOTIFICATION_CLAIMS_KEY, createDesktopAlert, notificationText, parseNotificationSettings, tabPresentation,
} from "../src/notifications.ts";
import type { WithAlertLock } from "../src/notifications.ts";

const settings = { ...defaultNotificationSettings, sound: true, desktop: true };
function event(id: string, type: HarborEvent["type"] = "ready", sessionId = "session-a"): HarborEvent {
  return { id, type, sessionId, source: "codex", message: "Private event detail must not be in system alerts", receivedAt: "2026-10-26T18:00:00Z" };
}

test("notification settings validate stored values and fall back to quiet defaults", () => {
  for (const raw of [null, "invalid", "null", "[]", '"hello"'])
    assert.deepEqual(parseNotificationSettings(raw), defaultNotificationSettings);
  const parsed = parseNotificationSettings(JSON.stringify({
    attention: false, ready: false, sound: true, desktop: true, tab: false,
    backgroundOnly: false, volume: 500, unknown: "ignored",
  }));
  assert.deepEqual(parsed, { attention: false, ready: false, sound: true, desktop: true, tab: false, backgroundOnly: false, volume: 100 });
  assert.equal(parseNotificationSettings('{"volume":-10}').volume, 0);
  assert.equal(parseNotificationSettings('{"volume":"80","sound":"true"}').volume, 40);
  assert.equal(parseNotificationSettings('{"sound":"true"}').sound, false);
});

test("startup and reconnect snapshots never alert or create unread sessions", () => {
  const tracker = new NotificationTracker();
  assert.equal(tracker.live(event("before-baseline"), settings, false), null);
  tracker.snapshot([event("historical-wait", "waiting")]);
  assert.deepEqual(tracker.indicator(settings), { count: 0, attention: false });
  assert.equal(tracker.live(event("historical-wait", "waiting"), settings, false), null);
  const ready = event("new-ready");
  assert.equal(tracker.live(ready, settings, false)?.id, ready.id);
  tracker.snapshot([ready]);
  assert.equal(tracker.indicator(settings).count, 1);
  tracker.snapshot([ready, event("missed-working", "activity")]);
  assert.equal(tracker.indicator(settings).count, 0);
  assert.equal(tracker.live(ready, settings, false), null);
  tracker.snapshot([event("reconnect-history", "waiting", "new-session")]);
  assert.equal(tracker.indicator(settings).count, 0);
});

test("snapshot diagnostics distinguish startup, live delivery, and reconnect catch-up without sounding", () => {
  const tracker = new NotificationTracker();
  assert.equal(tracker.snapshot([event("old-ready")]), false);
  const received = event("live-working", "activity");
  tracker.live(received, settings, false);
  assert.equal(tracker.snapshot([received]), false);
  assert.equal(tracker.snapshot([received, event("missed-ready")]), true);
  assert.equal(tracker.indicator(settings).count, 0);
  assert.equal(tracker.snapshot([event("missed-ready")]), false);
});

test("new background transitions alert once per session status, preserve names, and resolve indicators", () => {
  const tracker = new NotificationTracker();
  tracker.snapshot([{ ...event("working", "activity"), sessionName: "Saved name" }]);
  const waiting = tracker.live(event("wait", "waiting"), settings, false);
  assert.equal(waiting?.sessionName, "Saved name");
  assert.deepEqual(tracker.indicator(settings), { count: 1, attention: true });
  assert.equal(tracker.live(event("wait", "waiting"), settings, false), null);
  assert.equal(tracker.live(event("same-phase", "waiting"), settings, false), null);
  assert.equal(tracker.indicator(settings).count, 1);
  assert.equal(tracker.isCurrent(waiting!), false);
  assert.equal(tracker.live(event("continued", "activity"), settings, false), null);
  assert.equal(tracker.indicator(settings).count, 0);
  assert.equal(tracker.live(event("reply"), settings, false)?.type, "ready");
  assert.deepEqual(tracker.indicator(settings), { count: 1, attention: false });
  assert.equal(tracker.live({ ...event("other-source", "waiting"), source: "claude-code" }, settings, false)?.source, "claude-code");
  assert.equal(tracker.indicator(settings).count, 2);
  tracker.acknowledge();
  assert.equal(tracker.indicator(settings).count, 0);
});

test("event preferences, foreground suppression, and tab switches do not replay prior alerts", () => {
  const tracker = new NotificationTracker();
  tracker.snapshot([]);
  assert.equal(tracker.live(event("foreground-wait", "waiting"), settings, true), null);
  assert.equal(tracker.indicator(settings).count, 0);
  assert.equal(tracker.live(event("background-ready"), { ...settings, ready: false }, false), null);
  assert.equal(tracker.indicator(settings).count, 0);
  assert.equal(tracker.live(event("new-activity", "activity"), settings, false), null);
  assert.equal(tracker.live(event("foreground-ready"), { ...settings, backgroundOnly: false }, true)?.type, "ready");
  assert.equal(tracker.indicator(settings).count, 0);
  tracker.live(event("error", "error"), settings, false);
  assert.equal(tracker.indicator(settings).count, 1);
  assert.equal(tracker.indicator({ ...settings, attention: false }).count, 0);
  assert.equal(tracker.indicator({ ...settings, tab: false }).count, 0);
  tracker.live(event("ended", "ended"), settings, false);
  assert.equal(tracker.indicator(settings).count, 0);
});

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
function serialLock(): WithAlertLock {
  let pending = Promise.resolve();
  return (action) => {
    const result = pending.then(action);
    pending = result.then(() => {}, () => {});
    return result;
  };
}

test("same-origin tabs claim each alert channel once, including after reload", async () => {
  const storage = memoryStorage();
  const lock = serialLock();
  const tabs = [new NotificationClaims(storage, lock), new NotificationClaims(storage, lock)];
  const sound = await Promise.all(tabs.map((tab) => tab.claim("shared-event", "sound")));
  assert.deepEqual(sound.sort(), [false, true]);
  const desktop = await Promise.all(tabs.map((tab) => tab.claim("shared-event", "desktop")));
  assert.deepEqual(desktop.sort(), [false, true]);
  assert.equal(await new NotificationClaims(storage, lock).claim("shared-event", "desktop"), false);
  assert.equal(await tabs[0].claim("next-event", "desktop"), true);
  const saved = JSON.parse(storage.getItem(NOTIFICATION_CLAIMS_KEY)!);
  assert.deepEqual(saved, ["shared-event:sound", "shared-event:desktop", "next-event:desktop"]);
});

test("notification claims tolerate restricted/corrupt storage and keep a bounded ID-only history", async () => {
  const restricted = new NotificationClaims({ getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } });
  assert.equal(await restricted.claim("one", "sound"), true);
  assert.equal(await restricted.claim("one", "sound"), false);
  const storage = memoryStorage();
  storage.setItem(NOTIFICATION_CLAIMS_KEY, "invalid");
  const claims = new NotificationClaims(storage);
  for (let i = 0; i < 600; i++) assert.equal(await claims.claim(`event-${i}`, "sound"), true);
  const saved = JSON.parse(storage.getItem(NOTIFICATION_CLAIMS_KEY)!);
  assert.equal(saved.length, 500);
  assert.equal(saved[0], "event-100:sound");
  assert.equal(saved.at(-1), "event-599:sound");
});

test("desktop text excludes event details; tab presentation distinguishes attention and ready", () => {
  const ready = { ...event("private"), sessionName: "#10759" };
  assert.deepEqual(notificationText(ready), { title: "Agent Harbor · Reply ready", body: "Codex · #10759" });
  assert.equal(notificationText(event("wait", "waiting")).title, "Agent Harbor · Needs input");
  assert.equal(notificationText(event("error", "error")).title, "Agent Harbor · Error reported");
  assert.ok(!JSON.stringify(notificationText(ready)).includes(ready.message));
  assert.deepEqual(tabPresentation(0, false), { title: "Agent Harbor", icon: "/harbor.svg" });
  assert.equal(tabPresentation(2, true).title, "(2) Agent Harbor");
  assert.match(decodeURIComponent(tabPresentation(2, true).icon), /#e6a065/);
  assert.match(decodeURIComponent(tabPresentation(1, false).icon), /#7eb8ec/);
});

test("clicking a desktop alert opens the exact source/session and closes it; errors are reported", () => {
  class Alert extends EventTarget {
    closed = false;
    close() { this.closed = true; }
  }
  const notification = new Alert();
  const opened: string[] = [];
  let failures = 0;
  const source = { ...event("native-ready"), source: "claude-code", sessionName: "Shared name" };
  const handle = createDesktopAlert(source, (key) => opened.push(key), () => failures++, (title, options) => {
    assert.equal(title, "Agent Harbor · Reply ready");
    assert.equal(options.body, "Claude Code · Shared name");
    assert.equal(options.tag, 'harbor:["claude-code","session-a"]');
    assert.equal(options.silent, true);
    assert.ok(!JSON.stringify(options).includes(source.message));
    return notification;
  });
  assert.equal(handle, notification);
  notification.dispatchEvent(new Event("click"));
  assert.deepEqual(opened, ['["claude-code","session-a"]']);
  assert.equal(notification.closed, true);
  notification.dispatchEvent(new Event("error"));
  assert.equal(failures, 1);
});
