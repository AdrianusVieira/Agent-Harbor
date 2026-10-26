import { EVENT_LIMIT, platformNames, sessionKey } from "./events.ts";
import type { HarborEvent } from "./events.ts";

export const NOTIFICATION_SETTINGS_KEY = "harbor.notification-settings";
export const NOTIFICATION_CLAIMS_KEY = "harbor.notification-claims";
export const defaultNotificationSettings = {
  attention: true,
  ready: true,
  sound: false,
  desktop: false,
  tab: true,
  backgroundOnly: true,
  volume: 40,
};
export type NotificationSettings = typeof defaultNotificationSettings;

export function parseNotificationSettings(raw: string | null): NotificationSettings {
  const result = { ...defaultNotificationSettings };
  try {
    const input: unknown = JSON.parse(raw ?? "null");
    if (!input || typeof input !== "object" || Array.isArray(input)) return result;
    const values = input as Record<string, unknown>;
    for (const key of ["attention", "ready", "sound", "desktop", "tab", "backgroundOnly"] as const)
      if (typeof values[key] === "boolean") result[key] = values[key];
    if (typeof values.volume === "number" && Number.isFinite(values.volume))
      result.volume = Math.max(0, Math.min(100, values.volume));
  } catch { /* Invalid or unavailable storage uses quiet defaults. */ }
  return result;
}

export function isAlertEvent(event: HarborEvent, settings: NotificationSettings) {
  return ((event.type === "waiting" || event.type === "error") && settings.attention) ||
    (event.type === "ready" && settings.ready);
}

// Track received identities, never infer completion or waiting from silence.
export class NotificationTracker {
  private baselined = false;
  private seen = new Set<string>();
  private latest = new Map<string, HarborEvent>();
  private unread = new Map<string, HarborEvent>();

  snapshot(events: HarborEvent[]) {
    const caughtUp = this.baselined && events.some((event) => !this.seen.has(event.id) &&
      (event.type === "waiting" || event.type === "error" || event.type === "ready"));
    this.baselined = true;
    this.latest.clear();
    for (const event of events) {
      this.remember(event.id);
      this.updateLatest(event);
    }
    // A reconnect can resolve an existing indicator, but never creates alerts.
    for (const [key, event] of this.unread)
      if (this.latest.get(key)?.id !== event.id) this.unread.delete(key);
    return caughtUp;
  }

  live(event: HarborEvent, settings: NotificationSettings, foreground: boolean) {
    if (this.seen.has(event.id)) return null;
    const key = sessionKey(event);
    const previous = this.latest.get(key);
    this.remember(event.id);
    const named = this.updateLatest(event);
    const repeated = previous?.type === event.type;
    if (!this.baselined || !isAlertEvent(named, settings)) {
      this.unread.delete(key);
      return null;
    }
    if (foreground) this.unread.clear();
    else if (!repeated || this.unread.has(key)) this.unread.set(key, named);
    if (repeated || (settings.backgroundOnly && foreground)) return null;
    return named;
  }

  acknowledge() { this.unread.clear(); }

  isCurrent(event: HarborEvent) { return this.latest.get(sessionKey(event))?.id === event.id; }

  indicator(settings: NotificationSettings) {
    const unread = [...this.unread.values()].filter((event) => isAlertEvent(event, settings));
    return {
      count: settings.tab ? unread.length : 0,
      attention: unread.some((event) => event.type === "waiting" || event.type === "error"),
    };
  }

  private updateLatest(event: HarborEvent) {
    const key = sessionKey(event);
    const named = { ...event, sessionName: event.sessionName ?? this.latest.get(key)?.sessionName };
    this.latest.delete(key);
    this.latest.set(key, named);
    if (this.latest.size > EVENT_LIMIT) {
      const oldest = this.latest.keys().next().value!;
      this.latest.delete(oldest);
      this.unread.delete(oldest);
    }
    return named;
  }

  private remember(id: string) {
    this.seen.add(id);
    if (this.seen.size > EVENT_LIMIT) this.seen.delete(this.seen.values().next().value!);
  }
}

type ClaimStorage = Pick<Storage, "getItem" | "setItem">;
export type WithAlertLock = <T>(action: () => T) => Promise<T>;

// Shared claims contain only bounded event IDs and channel names, no session content.
// Web Locks serialize claims across tabs where available; other browsers are best effort.
export class NotificationClaims {
  private memory = new Set<string>();
  constructor(private storage?: ClaimStorage, private withLock?: WithAlertLock) {}

  async claim(id: string, channel: "sound" | "desktop") {
    const key = `${id}:${channel}`;
    const claim = () => {
      if (this.memory.has(key)) return false;
      let saved: string[] = [];
      try {
        const parsed: unknown = JSON.parse(this.storage?.getItem(NOTIFICATION_CLAIMS_KEY) ?? "[]");
        if (Array.isArray(parsed)) saved = parsed.filter((item): item is string => typeof item === "string" && item.length <= 160).slice(-EVENT_LIMIT);
      } catch { /* Keep this page usable with restricted storage. */ }
      this.memory.add(key);
      if (this.memory.size > EVENT_LIMIT) this.memory.delete(this.memory.values().next().value!);
      if (saved.includes(key)) return false;
      try { this.storage?.setItem(NOTIFICATION_CLAIMS_KEY, JSON.stringify([...saved, key].slice(-EVENT_LIMIT))); }
      catch { /* Per-page memory still prevents repeats. */ }
      return true;
    };
    return this.withLock ? this.withLock(claim) : claim();
  }
}

export function notificationText(event: HarborEvent) {
  const status = event.type === "ready" ? "Reply ready" : event.type === "error" ? "Error reported" : "Needs input";
  return {
    title: `Agent Harbor · ${status}`,
    body: `${platformNames[event.source] ?? event.source} · ${event.sessionName ?? event.sessionId.slice(0, 8)}`,
  };
}

export type DesktopAlert = Pick<EventTarget, "addEventListener"> & { close: () => void };

export function createDesktopAlert(
  event: HarborEvent,
  open: (key: string) => void,
  failed: () => void,
  create: (title: string, options: NotificationOptions) => DesktopAlert = (title, options) => new Notification(title, options),
) {
  const text = notificationText(event);
  const notification = create(text.title, {
    body: text.body, tag: `harbor:${sessionKey(event)}`, icon: "/harbor.svg", silent: true,
  });
  notification.addEventListener("click", () => {
    open(sessionKey(event));
    notification.close();
  });
  notification.addEventListener("error", failed);
  return notification;
}

export function tabPresentation(count: number, attention: boolean) {
  const title = count ? `(${count}) Agent Harbor` : "Agent Harbor";
  if (!count) return { title, icon: "/harbor.svg" };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#10151b"/><path d="M12 48h38M22 43V22l10-8 10 8v21M29 24h6v19M10 54q5-5 10 0t10 0t10 0t10 0" fill="none" stroke="#edf1f5" stroke-width="3"/><circle cx="49" cy="15" r="14" fill="${attention ? "#e6a065" : "#7eb8ec"}"/><text x="49" y="20" font-family="sans-serif" font-weight="bold" font-size="15" text-anchor="middle" fill="#090c10">${count > 9 ? "9+" : count}</text></svg>`;
  return { title, icon: `data:image/svg+xml,${encodeURIComponent(svg)}` };
}
