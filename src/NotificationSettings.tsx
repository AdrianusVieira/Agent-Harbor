import type { useNotifications } from "./useNotifications.ts";

export function NotificationSettings({ alerts }: { alerts: ReturnType<typeof useNotifications> }) {
  const { settings, update, permission, soundStatus, feedback } = alerts;
  const desktopUnavailable = permission === "insecure" || permission === "unsupported";
  const localAddress = `http://127.0.0.1:${window.location.port || "5173"}/`;
  return (
    <details className="notification-settings">
      <summary>
        <span>Notification settings</span>
        <span className="notification-summary">
          Sound {settings.sound ? soundStatus === "ready" ? "on" : "needs a click" : "off"} · Desktop {settings.desktop && permission === "granted" ? "on" : "off"}
        </span>
      </summary>
      <div className="notification-body">
        <p className="notification-intro">Choose how Harbor gets your attention. Settings are saved for this browser address.</p>
        <div className="notification-grid">
          <fieldset>
            <legend>Alert for</legend>
            <label className="notification-check">
              <input type="checkbox" checked={settings.attention} onChange={(event) => update({ attention: event.target.checked })} />
              <span>Needs input / error</span>
            </label>
            <label className="notification-check">
              <input type="checkbox" checked={settings.ready} onChange={(event) => update({ ready: event.target.checked })} />
              <span>Reply ready</span>
            </label>
            <p className="notification-help">Uses observed events. Permission requests may be handled automatically.</p>
          </fieldset>
          <fieldset>
            <legend>Sound</legend>
            <label className="notification-check">
              <input type="checkbox" checked={settings.sound} onChange={(event) => void alerts.toggleSound(event.target.checked)} />
              <span>Play a chime</span>
            </label>
            <label className="notification-volume">
              <span>Volume <output>{settings.volume}%</output></span>
              <input aria-label="Notification volume" type="range" min="0" max="100" step="5" value={settings.volume} onChange={(event) => update({ volume: Number(event.target.value) })} />
            </label>
            <div className="notification-buttons">
              {settings.sound && soundStatus === "locked" && <button onClick={() => void alerts.armSound()}>Enable sound in this tab</button>}
              <button onClick={() => void alerts.testSound()}>Test sound</button>
            </div>
            <p className="notification-help">{soundStatus === "unavailable" ? "Sound is unavailable in this browser." : settings.sound && soundStatus !== "ready" ? "Playback needs a click in this tab after opening or reloading Harbor." : settings.backgroundOnly ? "Live chimes are muted while you're viewing Harbor. Turn off ‘Sound and desktop only in background’ below to hear them here. Test sound plays a preview regardless of this setting." : "Three spaced notes; reply-ready and attention alerts sound different. Live chimes can play while you're viewing Harbor."}</p>
            <p className="notification-help"><a href="#notification-background-only">Find the background-only setting ↓</a></p>
            <p className="notification-help" role="status"><strong>Last live sound:</strong> {alerts.soundDelivery}</p>
          </fieldset>
          <fieldset>
            <legend>Desktop</legend>
            <label className="notification-check">
              <input type="checkbox" checked={settings.desktop} disabled={desktopUnavailable && !settings.desktop} onChange={(event) => void alerts.toggleDesktop(event.target.checked)} />
              <span>Desktop notifications</span>
            </label>
            <div className="notification-buttons">
              <button disabled={permission !== "granted"} onClick={alerts.testDesktop}>Test desktop notification</button>
            </div>
            <p className="notification-help">
              {permission === "insecure" ? <>Desktop alerts need localhost or HTTPS. On the host computer, open <a href={localAddress}>127.0.0.1:{window.location.port || "5173"}</a>. The phone's HTTP Wi-Fi address supports sound and tab indicators.</>
                : permission === "unsupported" ? "Desktop notifications are unavailable in this browser."
                : permission === "denied" ? "Blocked by the browser. Allow notifications in this site's settings, then enable them here."
                : permission === "granted" ? "Browser permission granted. System notification settings and Focus still apply."
                : "Enable to request browser permission. Clicking an alert opens its session."}
            </p>
          </fieldset>
          <fieldset>
            <legend>Behavior</legend>
            <label className="notification-check">
              <input type="checkbox" checked={settings.tab} onChange={(event) => update({ tab: event.target.checked })} />
              <span>Tab title and icon indicator</span>
            </label>
            <label className="notification-check">
              <input id="notification-background-only" type="checkbox" checked={settings.backgroundOnly} onChange={(event) => update({ backgroundOnly: event.target.checked })} />
              <span>Sound and desktop only in background</span>
            </label>
            <p className="notification-help">The tab counts newly observed alert sessions while you're away. Returning to Harbor clears the count. Old history never triggers alerts.</p>
          </fieldset>
        </div>
        {!alerts.coordinated && <p className="notification-help">This browser cannot fully coordinate alerts across tabs. Keep one Harbor tab open to avoid repeated sounds.</p>}
        <p className="notification-help">Keep Harbor open and connected for alerts. Closing or suspending the page can stop delivery; phone push notifications are not enabled.</p>
        <p className="notification-feedback" role="status">{feedback}</p>
      </div>
    </details>
  );
}
