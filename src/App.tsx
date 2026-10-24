import { useEffect, useRef, useState } from "react";
import { EVENT_LIMIT, eventLabels, eventSymbols } from "./events.ts";
import type { HarborEvent } from "./events.ts";

type Connection = "connecting" | "connected" | "disconnected";
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
  const [events, setEvents] = useState<HarborEvent[]>([]);
  const [filter, setFilter] = useState<"all" | "attention">("all");
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [pausedEvents, setPausedEvents] = useState<HarborEvent[] | null>(null);
  const [query, setQuery] = useState("");

  const followTail = useRef(true);
  const viewport = useRef<HTMLDivElement>(null);

  const paused = pausedEvents !== null;

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

  const displayed = (pausedEvents ?? events).filter(
    (event) => !hiddenIds.has(event.id),
  );
  const latestBySession = new Map<string, HarborEvent>();
  for (const event of displayed)
    latestBySession.set(JSON.stringify([event.source, event.sessionId]), event);
  const sessions = [...latestBySession.values()];
  const attention = sessions.filter(
    (event) => event.type === "waiting" || event.type === "error",
  ).length;
  const ready = sessions.filter((event) => event.type === "ready").length;
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
    ? events.filter((event) => !pausedEvents.some((old) => old.id === event.id))
        .length
    : 0;

  useEffect(() => {
    if (!paused && followTail.current && viewport.current) {
      viewport.current.scrollTop = viewport.current.scrollHeight;
    }
  }, [events, paused, query, filter]);

  function clearView() {
    setHiddenIds(new Set(events.map((event) => event.id)));
    if (paused) setPausedEvents([]);
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="/" aria-label="Agent Harbor home">
          <span className="brand-emblem">
            <HarborMark />
          </span>
          <span>
            Agent Harbor
            <span className="brand-caption">a quiet place for busy agents</span>
          </span>
        </a>
        <span className="version">LOCAL / v0.1</span>
      </header>

      <main>
        <section className="overview" aria-labelledby="page-title">
          <div>
            <p className="eyebrow">THE WATCH</p>
            <h1 id="page-title">Every signal, in sight.</h1>
            <p className="intro">An open channel for your AI work sessions.</p>
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

        <section
          className="session-summary"
          aria-label="Observed session summary"
        >
          <div>
            <span className="summary-value">
              {String(sessions.length).padStart(2, "0")}
            </span>
            <span>sessions observed</span>
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
          <span className="summary-note">
            {paused ? "view paused" : "from received events"}
          </span>
        </section>

        <section className="terminal" aria-label="Event terminal">
          <div className="terminal-titlebar">
            <div className="terminal-path">
              <span aria-hidden="true">⌁</span>
              <span>
                harbor <span className="path-divider">/</span> events
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
                {paused ? `Resume${pending ? ` (${pending})` : ""}` : "Pause"}
              </button>
              <button onClick={clearView} disabled={displayed.length === 0}>
                Clear view
              </button>
            </div>
          </div>

          <div className="terminal-toolbar">
            <div className="filters" role="group" aria-label="Filter events">
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
                    <p className="empty-title">The harbor is quiet.</p>
                    <p>Incoming session events will appear here.</p>
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
                    <time title={event.receivedAt} dateTime={event.receivedAt}>
                      {new Date(event.receivedAt).toLocaleTimeString("en-GB", {
                        hour12: false,
                      })}
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
              {visible.length} {visible.length === 1 ? "event" : "events"} shown
            </span>
            <span>
              local time<span className="status-separator">/</span>in memory ·
              last {EVENT_LIMIT}
            </span>
          </div>
        </section>
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
