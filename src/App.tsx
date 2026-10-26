import { useEffect, useRef, useState } from "react";
import { EVENT_LIMIT, eventLabels, eventSymbols } from "./events.ts";
import type { HarborEvent } from "./events.ts";
import { WifiAccess } from "./WifiAccess.tsx";

type Connection = "connecting" | "connected" | "disconnected";

const platformNames: Record<string, string> = {
  "claude-code": "Claude Code",
  "claude-desktop": "Claude Desktop",
  codex: "Codex",
};

function sessionKey(event: HarborEvent) {
  return JSON.stringify([event.source, event.sessionId]);
}

function readDismissedSessions(): Map<string, string> {
  try {
    const entries: unknown = JSON.parse(
      localStorage.getItem("harbor.dismissed-boats") ?? "[]",
    );
    if (Array.isArray(entries))
      return new Map(
        entries
          .filter(
            (entry): entry is [string, string] =>
              Array.isArray(entry) &&
              entry.length === 2 &&
              entry.every((value) => typeof value === "string"),
          )
          .slice(-EVENT_LIMIT),
      );
  } catch {
    // Storage can be unavailable; clearing still works for this page visit.
  }
  return new Map();
}

function BoatIcon() {
  return (
    <svg
      className="boat-icon"
      viewBox="0 0 120 104"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <g className="boat-vessel">
        <path className="boat-sail" d="M56 16 27 62h29V16Zm8 12v34h23L64 28Z" />
        <path d="M60 12v61m0-61 11 3-11 4M21 73h79L88 87H35L21 73Z" />
        <path d="M29 78h61M60 66l-8 7m12-7 8 7" />
      </g>
      <path
        className="boat-water"
        d="M17 94c5-4 9 4 14 0s9 4 14 0 9 4 14 0 9 4 14 0 9 4 14 0 9 4 14 0"
      />
    </svg>
  );
}

function HarborMark({ large = false }: { large?: boolean }) {
  return (
    <svg
      className={large ? "harbor-mark large" : "harbor-mark"}
      viewBox="0 0 40 40"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 26V15l6-5 6 5v11M11 26h18M17 18h6M20 10v16M9 31c3-3 5 3 8 0s5 3 8 0 4 0 6 0" />
    </svg>
  );
}

export function App() {
  const [connection, setConnection] = useState<Connection>("connecting");
  const [dismissedSessions, setDismissedSessions] = useState(
    readDismissedSessions,
  );
  const [events, setEvents] = useState<HarborEvent[]>([]);
  const [filter, setFilter] = useState<"all" | "attention">("all");
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [pausedEvents, setPausedEvents] = useState<HarborEvent[] | null>(null);
  const [query, setQuery] = useState("");
  const [selectedSession, setSelectedSession] = useState<string | null>(null);

  const backButton = useRef<HTMLButtonElement>(null);
  const followTail = useRef(true);
  const homeButton = useRef<HTMLButtonElement>(null);
  const viewport = useRef<HTMLDivElement>(null);

  const paused = pausedEvents !== null;

  useEffect(() => {
    try {
      localStorage.setItem(
        "harbor.dismissed-boats",
        JSON.stringify([...dismissedSessions]),
      );
    } catch {
      // Keep the in-memory view usable when browser storage is disabled.
    }
  }, [dismissedSessions]);

  useEffect(() => {
    const stream = new EventSource("/api/stream");
    stream.onopen = () => setConnection("connected");
    stream.onerror = () => setConnection("disconnected");
    stream.addEventListener("snapshot", (message: MessageEvent<string>) => {
      setEvents(JSON.parse(message.data) as HarborEvent[]);
    });
    stream.addEventListener("event", (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as HarborEvent;
      setEvents((previous) => [...previous, event].slice(-EVENT_LIMIT));
    });
    return () => stream.close();
  }, []);

  const latestBySession = new Map<string, HarborEvent>();
  for (const event of events) {
    const key = sessionKey(event);
    const previous = latestBySession.get(key);
    latestBySession.set(key, {
      ...event,
      sessionName: event.sessionName ?? previous?.sessionName,
    });
  }
  const sessions = [...latestBySession.values()]
    .filter((event) => dismissedSessions.get(sessionKey(event)) !== event.id)
    .sort(
      (a, b) =>
        (a.sessionName ?? a.sessionId).localeCompare(
          b.sessionName ?? b.sessionId,
        ) ||
        a.source.localeCompare(b.source) ||
        a.sessionId.localeCompare(b.sessionId),
    );
  const attention = sessions.filter(
    (event) => event.type === "waiting" || event.type === "error",
  ).length;
  const ready = sessions.filter((event) => event.type === "ready").length;
  const selected = selectedSession
    ? latestBySession.get(selectedSession)
    : undefined;
  const history = (pausedEvents ?? events).filter(
    (event) => selectedSession === "*" || sessionKey(event) === selectedSession,
  );
  const displayed = history.filter((event) => !hiddenIds.has(event.id));
  const visible = displayed.filter(
    (event) =>
      (filter === "all" ||
        event.type === "waiting" ||
        event.type === "error") &&
      `${event.source} ${event.sessionId} ${event.sessionName ?? ""} ${event.type} ${event.message}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const pending = paused
    ? events.filter(
        (event) =>
          (selectedSession === "*" || sessionKey(event) === selectedSession) &&
          !pausedEvents.some((old) => old.id === event.id),
      ).length
    : 0;

  useEffect(() => {
    if (!paused && followTail.current && viewport.current) {
      viewport.current.scrollTop = viewport.current.scrollHeight;
    }
  }, [events, paused, query, filter, selectedSession]);

  useEffect(() => {
    if (selectedSession !== null) backButton.current?.focus();
  }, [selectedSession]);

  function enterTerminal(key: string) {
    setFilter("all");
    setPausedEvents(null);
    setQuery("");
    setSelectedSession(key);
    followTail.current = true;
  }

  function returnToHarbor() {
    setPausedEvents(null);
    setSelectedSession(null);
    requestAnimationFrame(() => homeButton.current?.focus());
  }

  function dismissSession(event: HarborEvent) {
    setDismissedSessions((previous) => {
      const next = new Map(previous);
      const key = sessionKey(event);
      next.delete(key);
      next.set(key, event.id);
      return new Map([...next].slice(-EVENT_LIMIT));
    });
  }

  function clearView() {
    setHiddenIds(
      (previous) => new Set([...previous, ...history.map((event) => event.id)]),
    );
    if (paused) setPausedEvents([]);
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <button
          className="brand"
          onClick={returnToHarbor}
          aria-label="Agent Harbor home"
        >
          <span className="brand-emblem">
            <HarborMark />
          </span>
          <span>
            Agent Harbor
            <span className="brand-caption">a quiet place for busy agents</span>
          </span>
        </button>
        <span className="version">LOCAL / v0.1</span>
      </header>

      <main>
        <section className="overview" aria-labelledby="page-title">
          <div>
            <p className="eyebrow">
              {selectedSession ? "THE LOGBOOK" : "YOUR HARBOR"}
            </p>
            <h1 id="page-title">
              {selectedSession
                ? (selected?.sessionName ??
                  (selected ? selected.sessionId : "Every signal, in sight."))
                : "A berth for every session."}
            </h1>
            <p className="intro">
              {selectedSession
                ? "A closer look at the signals received."
                : "A little fleet. A clearer head."}
            </p>
          </div>
          <div className="receiver-status" role="status">
            <span className={`connection-dot ${connection}`} />
            {connection === "connected"
              ? "Receiver listening"
              : connection === "connecting"
                ? "Connecting…"
                : "Receiver offline · retrying"}
          </div>
        </section>

        <WifiAccess />

        {selectedSession === null ? (
          <>
            <section
              className="session-summary"
              aria-label="Observed session summary"
            >
              <div>
                <span className="summary-value">
                  {String(sessions.length).padStart(2, "0")}
                </span>
                <span>boats in view</span>
              </div>
              <div>
                <span className="summary-value">
                  {String(attention).padStart(2, "0")}
                </span>
                <span>need attention</span>
              </div>
              <div>
                <span className="summary-value">
                  {String(ready).padStart(2, "0")}
                </span>
                <span>replies ready</span>
              </div>
              <span className="summary-note">from received events</span>
            </section>

            <section className="harbor" aria-label="Session boats">
              <div className="harbor-titlebar">
                <div className="terminal-path">
                  <span aria-hidden="true">⌁</span>
                  <span>
                    harbor <span className="path-divider">/</span> moorings
                  </span>
                </div>
                <button
                  className="logbook-button"
                  ref={homeButton}
                  onClick={() => enterTerminal("*")}
                >
                  Event log <span aria-hidden="true">↗</span>
                </button>
              </div>
              <div className="harbor-legend" aria-label="Boat status legend">
                <span>
                  <i className="boat-dot waiting" /> Needs input / error
                </span>
                <span>
                  <i className="boat-dot ready" /> Reply ready
                </span>
              </div>
              {sessions.length === 0 ? (
                <div className="harbor-empty empty-state">
                  <BoatIcon />
                  <p className="empty-title">
                    {latestBySession.size
                      ? "All tucked away."
                      : "Still waters, for now."}
                  </p>
                  <p>
                    {latestBySession.size
                      ? "Cleared boats return with their next event."
                      : "Your first session will find its berth here."}
                  </p>
                </div>
              ) : (
                <ul className="boat-grid">
                  {sessions.map((event) => {
                    const name =
                      event.sessionName ?? event.sessionId.slice(0, 8);
                    const sailing =
                      connection === "connected" &&
                      event.type === "activity" &&
                      (event.source === "claude-code" ||
                        event.source === "codex");
                    const signal =
                      event.type === "waiting" || event.type === "error"
                        ? "waiting"
                        : event.type === "ready"
                          ? "ready"
                          : "quiet";
                    return (
                      <li
                        className={`boat-card boat-${signal}${sailing ? " boat-sailing" : ""}`}
                        key={sessionKey(event)}
                      >
                        <button
                          className="boat-open"
                          onClick={() => enterTerminal(sessionKey(event))}
                          aria-label={`Open ${name}, ${platformNames[event.source] ?? event.source}, ${eventLabels[event.type]}`}
                        >
                          <span className="boat-illustration">
                            <BoatIcon />
                            {signal !== "quiet" && (
                              <span
                                className={`boat-dot boat-flag ${signal}`}
                                aria-hidden="true"
                              />
                            )}
                          </span>
                          <span
                            className="boat-name"
                            title={`${event.sessionName ?? event.sessionId}\nSession ID: ${event.sessionId}`}
                          >
                            {name}
                          </span>
                          <span className="boat-platform">
                            {platformNames[event.source] ?? event.source}
                          </span>
                          <span className="boat-status">
                            {eventLabels[event.type]}{" "}
                            <span aria-hidden="true">·</span>{" "}
                            <time dateTime={event.receivedAt}>
                              {new Date(event.receivedAt).toLocaleTimeString(
                                "en-GB",
                                {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                  hour12: false,
                                },
                              )}
                            </time>
                          </span>
                        </button>
                        <button
                          className="boat-dismiss"
                          onClick={() => dismissSession(event)}
                          aria-label={`Clear boat ${name}`}
                          title="Clear boat until its next event"
                        >
                          <span aria-hidden="true">×</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="harbor-caption">
                <span>
                  Clear a boat to make room. Its next signal brings it back.
                </span>
                <span>Latest observed status</span>
              </div>
            </section>
          </>
        ) : (
          <>
            <nav className="session-navigation" aria-label="Session navigation">
              <button ref={backButton} onClick={returnToHarbor}>
                <span aria-hidden="true">←</span> Back to harbor
              </button>
              <span>
                {selected
                  ? (platformNames[selected.source] ?? selected.source)
                  : "All platforms"}
              </span>
            </nav>
            <section className="terminal" aria-label="Event terminal">
              <div className="terminal-titlebar">
                <div className="terminal-path">
                  <span aria-hidden="true">⌁</span>
                  <span>
                    harbor <span className="path-divider">/</span>{" "}
                    {selected ? "session" : "events"}
                  </span>
                </div>
                <div className="terminal-actions">
                  <button
                    onClick={() => {
                      setPausedEvents(paused ? null : events);
                      followTail.current = true;
                    }}
                    aria-pressed={paused}
                  >
                    <span aria-hidden="true">{paused ? "▷" : "Ⅱ"}</span>{" "}
                    {paused
                      ? `Resume${pending ? ` (${pending})` : ""}`
                      : "Pause"}
                  </button>
                  <button onClick={clearView} disabled={displayed.length === 0}>
                    Clear view
                  </button>
                </div>
              </div>

              <div className="terminal-toolbar">
                <div
                  className="filters"
                  role="group"
                  aria-label="Filter events"
                >
                  <button
                    className={filter === "all" ? "selected" : ""}
                    aria-pressed={filter === "all"}
                    onClick={() => setFilter("all")}
                  >
                    All events <span>{displayed.length}</span>
                  </button>
                  <button
                    className={filter === "attention" ? "selected" : ""}
                    aria-pressed={filter === "attention"}
                    onClick={() => setFilter("attention")}
                  >
                    Attention
                  </button>
                </div>
                <label className="search">
                  <span aria-hidden="true">⌕</span>
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Filter the stream…"
                    aria-label="Search events"
                    type="search"
                  />
                </label>
              </div>

              <div
                className="terminal-viewport"
                ref={viewport}
                tabIndex={0}
                role="region"
                aria-label="Received events"
                onScroll={() => {
                  const el = viewport.current;
                  if (el)
                    followTail.current =
                      el.scrollHeight - el.scrollTop - el.clientHeight < 48;
                }}
              >
                {visible.length === 0 ? (
                  <div className="empty-state">
                    {displayed.length === 0 ? (
                      <>
                        <HarborMark large />
                        <p className="empty-title">The logbook is quiet.</p>
                        <p>Incoming events will appear here.</p>
                      </>
                    ) : (
                      <>
                        <p className="empty-title">No matching signals.</p>
                        <p>Try another search or switch to all events.</p>
                        <button
                          className="reset-button"
                          onClick={() => {
                            setFilter("all");
                            setQuery("");
                          }}
                        >
                          Reset filters
                        </button>
                      </>
                    )}
                  </div>
                ) : (
                  <ol className="event-list">
                    {visible.map((event) => (
                      <li
                        key={event.id}
                        className={`event-row event-${event.type}`}
                      >
                        <time
                          title={event.receivedAt}
                          dateTime={event.receivedAt}
                        >
                          {new Date(event.receivedAt).toLocaleTimeString(
                            "en-GB",
                            {
                              hour12: false,
                            },
                          )}
                        </time>
                        <span className="event-symbol" aria-hidden="true">
                          {eventSymbols[event.type]}
                        </span>
                        <div className="event-content">
                          <div className="event-meta">
                            <span className="event-source">{event.source}</span>
                            <span
                              className={
                                event.sessionName
                                  ? "event-session named"
                                  : "event-session"
                              }
                              title={`Session ID: ${event.sessionId}`}
                            >
                              {event.sessionName ?? event.sessionId}
                            </span>
                            <span className="event-label">
                              {eventLabels[event.type]}
                            </span>
                          </div>
                          <p>{event.message}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              <div className="terminal-prompt">
                <span className="prompt-chevron" aria-hidden="true">
                  ❯
                </span>
                <span>
                  {paused
                    ? "Display paused. Events are still being received."
                    : connection === "connected"
                      ? "Listening for incoming events"
                      : "Waiting for the local receiver"}
                </span>
                <span
                  className={paused ? "cursor still" : "cursor"}
                  aria-hidden="true"
                />
              </div>
              <div className="terminal-status">
                <span>
                  {paused
                    ? "PAUSED"
                    : connection === "connected"
                      ? "LIVE"
                      : "OFFLINE"}
                  <span className="status-separator">/</span>
                  {visible.length} {visible.length === 1 ? "event" : "events"}{" "}
                  shown
                </span>
                <span>
                  local time<span className="status-separator">/</span>in memory
                  · last {EVENT_LIMIT}
                </span>
              </div>
            </section>
          </>
        )}
      </main>

      <footer className="app-footer">
        <span>One harbor. Many journeys.</span>
        <span>
          AGENT HARBOR<span className="footer-divider">/</span>OBSERVE FIRST
        </span>
      </footer>
    </div>
  );
}
