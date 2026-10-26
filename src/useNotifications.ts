import { useCallback, useEffect, useRef, useState } from "react";
import { sessionKey } from "./events.ts";
import type { HarborEvent } from "./events.ts";
import {
  isAlertEvent, NOTIFICATION_SETTINGS_KEY, NotificationClaims,
  NotificationTracker, createDesktopAlert, parseNotificationSettings, tabPresentation,
} from "./notifications.ts";
import type { DesktopAlert, NotificationSettings } from "./notifications.ts";
import { deliverLiveSound } from "./notification-audio.ts";

type DesktopStatus = NotificationPermission | "insecure" | "unsupported";
type SoundStatus = "locked" | "ready" | "unavailable";

function storage() {
  try { return window.localStorage; } catch { return undefined; }
}
function readSettings() {
  try { return parseNotificationSettings(storage()?.getItem(NOTIFICATION_SETTINGS_KEY) ?? null); }
  catch { return parseNotificationSettings(null); }
}
function desktopStatus(): DesktopStatus {
  if (!window.isSecureContext) return "insecure";
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}
function foreground() { return document.visibilityState === "visible" && document.hasFocus(); }

export function useNotifications(openSession: (key: string) => void) {
  const [settings, setSettings] = useState(readSettings);
  const preferences = useRef(settings);
  const open = useRef(openSession);
  open.current = openSession;
  const tracker = useRef(new NotificationTracker());
  const claims = useRef<NotificationClaims | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const lastChime = useRef(-Infinity);
  const desktop = useRef(new Map<string, DesktopAlert>());
  const active = useRef(false);
  const [permission, setPermission] = useState(desktopStatus);
  const [soundStatus, setSoundStatus] = useState<SoundStatus>("locked");
  const [feedback, setFeedback] = useState("");
  const [soundDelivery, setSoundDelivery] = useState("No live sound event received in this tab yet.");
  const lastSoundEvent = useRef<string | null>(null);
  const [indicator, setIndicator] = useState({ count: 0, attention: false });

  const refreshIndicator = useCallback(() => {
    setIndicator(tracker.current.indicator(preferences.current));
  }, []);

  const update = useCallback((changes: Partial<NotificationSettings>) => {
    const next = { ...preferences.current, ...changes };
    preferences.current = next;
    setSettings(next);
    try { storage()?.setItem(NOTIFICATION_SETTINGS_KEY, JSON.stringify(next)); }
    catch { /* Preferences still work for this page visit. */ }
    refreshIndicator();
  }, [refreshIndicator]);

  async function armSound() {
    try {
      if (!window.AudioContext) throw new Error("Web Audio is unavailable");
      if (!audio.current || audio.current.state === "closed") {
        const context = new AudioContext();
        audio.current = context;
        context.addEventListener("statechange", () => {
          if (active.current && audio.current === context)
            setSoundStatus(context.state === "running" ? "ready" : "locked");
        });
      }
      const context = audio.current;
      // Called directly from the user's click, before yielding the gesture.
      await context.resume();
      const ready = audio.current === context && context.state === "running";
      if (active.current) setSoundStatus(ready ? "ready" : "locked");
      return ready;
    } catch {
      if (active.current) setSoundStatus(window.AudioContext ? "locked" : "unavailable");
      return false;
    }
  }

  function chime(type: HarborEvent["type"], volume: number, test = false) {
    const context = audio.current;
    if (!context || context.state !== "running" || volume <= 0) return false;
    // Coalesce a burst of sessions into one short chime.
    if (!test && context.currentTime - lastChime.current < 1.05) return true;
    lastChime.current = context.currentTime;
    const tones = type === "ready" ? [520, 650, 780] : [780, 660, 520];
    tones.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + index * 0.35;
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume / 100 * 0.75), start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(start);
      oscillator.stop(start + 0.2);
    });
    return true;
  }

  function showDesktop(event: HarborEvent) {
    try {
      const key = sessionKey(event);
      const notification = createDesktopAlert(event, (key) => {
        window.focus();
        open.current(key);
        tracker.current.acknowledge();
        refreshIndicator();
      }, () => {
        if (active.current) setFeedback("Desktop notification could not be displayed. Check browser and system notification settings.");
      });
      desktop.current.set(key, notification);
      notification.addEventListener("close", () => {
        if (desktop.current.get(key) === notification) desktop.current.delete(key);
      });
    } catch {
      setFeedback("This browser cannot show desktop notifications from this page. Try a desktop browser at localhost.");
    }
  }

  // The stream calls this only for new live events, never for snapshots.
  const receive = useRef<(event: HarborEvent) => void>(() => {});
  receive.current = (event) => {
    const key = sessionKey(event);
    desktop.current.get(key)?.close();
    desktop.current.delete(key);
    const alert = tracker.current.live(event, preferences.current, foreground());
    refreshIndicator();
    const soundEvent = event.type === "ready" || event.type === "waiting" || event.type === "error";
    if (soundEvent) {
      lastSoundEvent.current = event.id;
      if (!preferences.current.sound) setSoundDelivery("Live sound is switched off.");
      else if (!isAlertEvent(event, preferences.current)) setSoundDelivery("This event type is turned off in Alert for.");
      else if (preferences.current.backgroundOnly && foreground())
        setSoundDelivery("Live sound muted: Harbor is visible and background-only is on.");
      else if (!alert) setSoundDelivery("Repeated or already-seen status kept quiet.");
    }
    if (!alert) return;
    const stillRelevant = () => active.current && tracker.current.isCurrent(alert) &&
      isAlertEvent(alert, preferences.current) && !(preferences.current.backgroundOnly && foreground());
    if (preferences.current.sound) {
      if (preferences.current.volume <= 0) setSoundDelivery("Live sound muted: volume is zero.");
      else void deliverLiveSound({
        context: audio.current,
        allowed: () => stillRelevant() && preferences.current.sound && preferences.current.volume > 0,
        claim: () => claims.current?.claim(alert.id, "sound") ?? Promise.resolve(false),
        play: () => chime(alert.type, preferences.current.volume),
      }).then((result) => {
        if (!active.current || lastSoundEvent.current !== alert.id) return;
        if (result === "blocked") {
          setSoundStatus("locked");
          setSoundDelivery("Live sound blocked by the browser. Tap Enable sound in this tab. Phones may pause audio while Harbor is in the background.");
        } else if (result === "claimed") setSoundDelivery("Another Harbor tab claimed this sound.");
        else if (result === "stale") setSoundDelivery("Status or settings changed before sound delivery; kept quiet.");
        else setSoundDelivery("Live chime sent to the browser. Device sound and volume still apply.");
      }).catch(() => { if (active.current) setSoundDelivery("Could not coordinate sound between tabs. Try keeping one Harbor tab open."); });
    }
    if (preferences.current.desktop && desktopStatus() === "granted")
      void claims.current?.claim(alert.id, "desktop").then((claimed) => {
        if (claimed && stillRelevant() && preferences.current.desktop && desktopStatus() === "granted") showDesktop(alert);
      }).catch(() => { if (active.current) setFeedback("Could not coordinate desktop alerts between tabs. Try keeping one Harbor tab open."); });
  };
  const onEvent = useCallback((event: HarborEvent) => receive.current(event), []);
  const onSnapshot = useCallback((events: HarborEvent[]) => {
    const caughtUp = tracker.current.snapshot(events);
    if (caughtUp && preferences.current.sound) {
      lastSoundEvent.current = null;
      setSoundDelivery("Status caught up after reconnect. Catch-up history does not play sound.");
    }
    for (const [key, notification] of desktop.current) {
      const latest = [...events].reverse().find((event) => sessionKey(event) === key);
      if (!latest || !isAlertEvent(latest, preferences.current)) {
        notification.close();
        desktop.current.delete(key);
      }
    }
    refreshIndicator();
  }, [refreshIndicator]);

  useEffect(() => {
    active.current = true;
    setSoundStatus(audio.current?.state === "running" ? "ready" : "locked");
    const locks = navigator.locks;
    claims.current = new NotificationClaims(storage(), locks
      ? (action) => locks.request("harbor-notification-claims", action)
      : undefined);
    function resume() {
      setPermission(desktopStatus());
      if (foreground()) {
        tracker.current.acknowledge();
        refreshIndicator();
      }
      setSoundStatus(audio.current?.state === "running" ? "ready" : "locked");
    }
    function sync(event: StorageEvent) {
      if (event.key !== NOTIFICATION_SETTINGS_KEY && event.key !== null) return;
      const next = readSettings();
      preferences.current = next;
      setSettings(next);
      refreshIndicator();
    }
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("storage", sync);
    return () => {
      active.current = false;
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("storage", sync);
      for (const notification of desktop.current.values()) notification.close();
      desktop.current.clear();
      void audio.current?.close();
      audio.current = null;
    };
  }, [refreshIndicator]);

  useEffect(() => {
    const icon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    const original = icon?.getAttribute("href") ?? "/harbor.svg";
    const presentation = tabPresentation(indicator.count, indicator.attention);
    document.title = presentation.title;
    if (icon) icon.href = presentation.icon;
    return () => {
      document.title = "Agent Harbor";
      if (icon) icon.setAttribute("href", original);
    };
  }, [indicator.count, indicator.attention]);

  async function toggleSound(enabled: boolean) {
    update({ sound: enabled });
    setFeedback("");
    if (enabled && !await armSound()) setFeedback("Click Enable sound in this tab to allow playback.");
  }

  async function toggleDesktop(enabled: boolean) {
    setFeedback("");
    if (!enabled) {
      update({ desktop: false });
      for (const notification of desktop.current.values()) notification.close();
      desktop.current.clear();
      return;
    }
    const status = desktopStatus();
    if (status === "insecure" || status === "unsupported") { setPermission(status); return; }
    try {
      const result = status === "default" ? await Notification.requestPermission() : status;
      setPermission(result);
      update({ desktop: result === "granted" });
      if (result !== "granted") setFeedback(result === "denied"
        ? "Notifications are blocked. Allow them in this site's browser settings, then enable desktop alerts again."
        : "Permission was not granted. You can enable desktop alerts whenever you're ready.");
    } catch { setFeedback("The browser could not request notification permission."); }
  }

  async function testSound() {
    if (await armSound()) {
      chime("ready", preferences.current.volume, true);
      setFeedback(!preferences.current.volume ? "Volume is zero. Raise it to hear the test."
        : !preferences.current.sound ? "Test chime played. Enable Play a chime to hear live alerts."
        : preferences.current.backgroundOnly ? "Test chime played. Background-only is on, so live chimes are muted while Harbor is visible."
        : "Test chime played. Live chimes are enabled while Harbor is visible.");
    } else setFeedback("Sound is blocked or unavailable. Try enabling it again in this tab.");
  }

  function testDesktop() {
    if (desktopStatus() !== "granted") { setPermission(desktopStatus()); return; }
    try {
      const notification = new Notification("Agent Harbor · Test notification", {
        body: "Desktop alerts are enabled for this browser address.", tag: "harbor-test", icon: "/harbor.svg", silent: true,
      });
      notification.onclick = () => { window.focus(); notification.close(); };
      window.setTimeout(() => notification.close(), 5000);
      setFeedback("Test notification requested. Your system controls whether it appears.");
    } catch { setFeedback("This browser cannot show desktop notifications from this page."); }
  }

  return {
    settings, update, permission, soundStatus, feedback, soundDelivery, toggleSound, toggleDesktop,
    testSound, testDesktop, armSound, onEvent, onSnapshot,
    coordinated: !!navigator.locks,
  };
}
