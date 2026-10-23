import { useEffect, useRef, useState } from "react";
import { EVENT_LIMIT, eventLabels, eventSymbols } from "./events.ts";
import type { EventInput, HarborEvent } from "./events.ts";

type Connection = "connecting" | "connected" | "disconnected";
const exampleCommand = [
  "curl -X POST http://127.0.0.1:5173/api/events \\",
  "  -H 'Content-Type: application/json' \\",
  `  -d '{"source":"manual","sessionId":"first-session","type":"waiting","message":"Ready for your input."}'`,
].join("\n");

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

async function sendEvent(input: EventInput) {
  const response = await fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok)
    throw new Error(
      "Could not send an event. Check that npm run dev is running.",
    );
}

export function App() {
  const [connection, setConnection] = useState<Connection>("connecting");
  const [copied, setCopied] = useState(false);
  const [events, setEvents] = useState<HarborEvent[]>([]);
  const [filter, setFilter] = useState<"all" | "attention">("all");
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState("");
  const [pausedEvents, setPausedEvents] = useState<HarborEvent[] | null>(null);
  const [query, setQuery] = useState("");
  const [sending, setSending] = useState(false);

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

  useEffect(() => {
    if (copied) {
      const timeout = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(timeout);
    }
  }, [copied]);

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
      `${event.source} ${event.sessionId} ${event.type} ${event.message}`
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

  async function addSample() {
    setSending(true);
    setNotice("");
    try {
      const batch = Date.now().toString(36);
      const sample: EventInput[] = [
        {
          source: "demo/claude-code",
          sessionId: `sample-${batch}`,
          type: "started",
          message: "Sample session started. No agent is connected.",
        },
        {
          source: "demo/claude-code",
          sessionId: `sample-${batch}`,
          type: "activity",
          message: "Reviewing the project structure…",
        },
        {
          source: "demo/claude-code",
          sessionId: `sample-${batch}`,
          type: "waiting",
          message: "May I run the project checks?",
        },
        {
          source: "demo/codex",
          sessionId: `sample-${batch}`,
          type: "ready",
          message: "Your response is ready to review.",
        },
      ];
      for (const event of sample) await sendEvent(event);
      followTail.current = true;
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setSending(false);
    }
  }

  function clearView() {
    setHiddenIds(new Set(events.map((event) => event.id)));
    if (paused) setPausedEvents([]);
  }

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(exampleCommand);
      setCopied(true);
    } catch {
      setNotice(
        "Copy is unavailable. Select the command below to copy it manually.",
      );
    }
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
                    <p>
                      Incoming events will appear here.
                      <br />
                      Send your first signal, or try a sample stream.
                    </p>
                    <button
                      className="sample-button"
                      onClick={() => void addSample()}
                      disabled={sending || connection !== "connected"}
                    >
                      {sending ? "Sending…" : "↗ Send sample events"}
                    </button>
                    <span className="empty-footnote">
                      Sample data only. No agents connected yet.
                    </span>
                  </>
                ) : (
                  <>
                    <p className="empty-title">No matching signals.</p>
                    <p>Try another search or switch to all events.</p>
                    <button
                      className="sample-button"
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
                        <span className="event-session">{event.sessionId}</span>
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

        {notice && (
          <p className="notice" role="alert">
            {notice}
          </p>
        )}

        <details className="send-guide">
          <summary>
            <span>
              <span className="guide-symbol" aria-hidden="true">
                ＋
              </span>{" "}
              Send an event
            </span>
            <span className="guide-caption">a small first step</span>
          </summary>
          <div className="guide-content">
            <p>
              Run this in your terminal while <code>npm run dev</code> is
              running.
            </p>
            <div className="command-block">
              <pre>
                <code>{exampleCommand}</code>
              </pre>
              <button onClick={() => void copyCommand()}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="guide-note">
              Events stay in memory until the dev server restarts. Agent
              integrations come next.
            </p>
            <button
              className="text-button"
              onClick={() => void addSample()}
              disabled={sending || connection !== "connected"}
            >
              {sending ? "Sending…" : "Send another sample stream ↗"}
            </button>
          </div>
        </details>
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
