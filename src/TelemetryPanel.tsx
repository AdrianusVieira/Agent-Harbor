import { authFetch } from "./auth-fetch.ts";
import { useEffect, useState } from "react";
import type { TelemetryPage } from "./app-route.ts";
import type {
  AccountOverview,
  SessionSummary,
  SessionView,
  TelemetrySource,
  TelemetrySummary,
} from "./telemetryData.ts";

export type UsageTarget = { source: TelemetrySource; id: string };
const number = (value: number | null | undefined) =>
  value == null
    ? "Unavailable"
    : new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(
        value,
      );
const money = (value: number | null | undefined) =>
  value == null
    ? "Unavailable"
    : new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 4,
      }).format(value);

async function read<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await authFetch(path, { signal, cache: "no-store" });
  if (!response.ok)
    throw new Error(
      response.status === 403
        ? "Log in to view account details."
        : response.status === 404
          ? "No telemetry for this session in the selected period."
          : "Could not load telemetry. Check the receiver connection.",
    );
  return response.json() as Promise<T>;
}

export function TelemetryPanel({
  initialTarget,
  initialSource,
  onOpen,
  page = "dashboard",
}: {
  initialTarget: UsageTarget | null;
  initialSource?: TelemetrySource;
  onOpen?(source: TelemetrySource, id?: string, page?: TelemetryPage): void;
  page?: TelemetryPage;
}) {
  const [accounts, setAccounts] = useState<AccountOverview | null>(null);
  const [detail, setDetail] = useState<SessionView | null>(null);
  const [end, setEnd] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState(initialTarget ? "all" : "30");
  const [privateDetails, setPrivateDetails] = useState(false);
  const [query, setQuery] = useState("");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [source, setSource] = useState<TelemetrySource>(
    page === "accounts"
      ? "claude"
      : (initialTarget?.source ?? initialSource ?? "claude"),
  );
  const [start, setStart] = useState("");
  const [summary, setSummary] = useState<TelemetrySummary | null>(null);
  const [target, setTarget] = useState<string | null>(
    initialTarget?.id ?? null,
  );
  const [visibleCount, setVisibleCount] = useState(20);
  function open(
    source: TelemetrySource,
    id?: string,
    destination: TelemetryPage = page,
  ) {
    if (onOpen) onOpen(source, id, destination);
    else {
      setSource(source);
      setTarget(id ?? null);
    }
  }

  let range = `days=${period}`;
  if (period === "custom") {
    const from = start ? new Date(`${start}T00:00:00`) : null;
    const through = end ? new Date(`${end}T00:00:00`) : null;
    if (through) through.setDate(through.getDate() + 1);
    range =
      from &&
      through &&
      Number.isFinite(+from) &&
      Number.isFinite(+through) &&
      +through > +from
        ? `days=custom&start=${+from}&end=${+through}`
        : "";
  }

  useEffect(() => {
    const controller = new AbortController();
    const base = `/api/telemetry/${source}`;
    setAccounts(null);
    setDetail(null);
    setError("");
    setSessions([]);
    setSummary(null);
    setVisibleCount(20);
    setLoading(true);
    if (!range) {
      setLoading(false);
      return () => controller.abort();
    }
    async function refresh() {
      try {
        // Each page loads only its own content. Navigating never restarts the
        // collector or the app's single lifecycle subscription.
        if (page === "dashboard") {
          const data = await read<TelemetrySummary>(
            `${base}?${range}`,
            controller.signal,
          );
          if (!controller.signal.aborted) setSummary(data);
        } else if (page === "accounts") {
          const data = await read<AccountOverview>(
            `/api/telemetry/claude/accounts?${range}`,
            controller.signal,
          );
          if (!controller.signal.aborted) {
            setAccounts(data);
            setPrivateDetails(true);
          }
        } else if (target) {
          const data = await read<SessionView>(
            `${base}/sessions/${encodeURIComponent(target)}?${range}`,
            controller.signal,
          );
          if (!controller.signal.aborted) {
            setDetail(data);
            setPrivateDetails(data.privateDetails);
          }
        } else {
          const data = await read<{
            sessions: SessionSummary[];
            privateDetails: boolean;
          }>(`${base}/sessions?${range}`, controller.signal);
          if (!controller.signal.aborted) {
            setSessions(data.sessions);
            setPrivateDetails(data.privateDetails);
          }
        }
        if (!controller.signal.aborted) setError("");
      } catch (reason) {
        if (!controller.signal.aborted) setError((reason as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void refresh();
    const timer = target
      ? null
      : window.setInterval(() => void refresh(), 15_000);
    return () => {
      controller.abort();
      if (timer !== null) window.clearInterval(timer);
    };
  }, [source, range, target, page]);

  const filtered = sessions.filter((item) =>
    `${item.name} ${item.id} ${item.project ?? ""} ${item.models.join(" ")}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const name =
    detail?.session.name ??
    (detail && "title" in detail.session ? detail.session.title : target);
  const label =
    page === "dashboard"
      ? "Telemetry dashboard"
      : page === "accounts"
        ? "Telemetry accounts"
        : "Telemetry sessions";
  return (
    <section className="telemetry-panel" aria-label={label}>
      <div className="telemetry-toolbar">
        {page === "accounts" ? (
          <span className="telemetry-source-label">Claude Code · accounts</span>
        ) : (
          <div className="filters" role="group" aria-label="Telemetry source">
            {(["claude", "codex"] as const).map((value) => (
              <button
                key={value}
                aria-pressed={source === value}
                className={source === value ? "selected" : ""}
                onClick={() => open(value)}
              >
                {value === "claude" ? "Claude Code" : "Codex"}
              </button>
            ))}
          </div>
        )}
        <label>
          Period{" "}
          <select
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
            aria-label="Telemetry period"
          >
            <option value="1">Last 24 hours</option>
            <option value="2">Last 48 hours</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="all">All history</option>
            <option value="custom">Custom dates</option>
          </select>
        </label>
        {period === "custom" && (
          <>
            <label>
              From{" "}
              <input
                aria-label="Telemetry start date"
                type="date"
                value={start}
                onChange={(event) => setStart(event.target.value)}
              />
            </label>
            <label>
              Through{" "}
              <input
                aria-label="Telemetry end date"
                type="date"
                value={end}
                onChange={(event) => setEnd(event.target.value)}
              />
            </label>
          </>
        )}
      </div>
      <p className="telemetry-help">
        {page === "dashboard"
          ? "Observed usage totals and trends. Costs are estimates; missing fields remain unavailable."
          : page === "sessions"
            ? "Browse sessions by name, project, or model, then open one for its usage and activity."
            : "Usage grouped by the account recorded on each Claude Code event. Codex account attribution is unavailable."}{" "}
        {target
          ? "Session details are a snapshot."
          : "Updates every 15 seconds."}
      </p>
      {!range && <p role="status">Choose a valid start and end date.</p>}
      {error && (
        <p className="telemetry-error" role="status">
          {error}
        </p>
      )}
      {loading && range && <p role="status">Loading telemetry…</p>}

      {page === "dashboard" && summary && (
        <>
          <div className="usage-grid">
            <Metric label="Observed tokens" value={number(summary.tokens)} />
            <Metric
              label="Conversations"
              value={number(summary.conversations)}
            />
            <Metric label="API requests" value={number(summary.apiRequests)} />
            <Metric label="Prompts" value={number(summary.prompts)} />
            <Metric
              label={`Estimated cost${summary.partialCost ? " · partial" : ""}`}
              value={money(summary.estimatedCostUsd)}
            />
            <Metric
              label="Active time · minutes"
              value={number(
                summary.activeSeconds == null
                  ? null
                  : summary.activeSeconds / 60,
              )}
            />
          </div>
          {!!summary.signalOnlyIds && (
            <p className="telemetry-help">
              {summary.signalOnlyIds} Codex IDs with only startup/completion
              signals contribute observed usage but are excluded from the
              conversation count.
            </p>
          )}
          <TokenTimeline points={summary.timeline} />
          {!summary.conversations && (
            <p className="telemetry-help">No usage observed in this period.</p>
          )}
        </>
      )}

      {page === "sessions" &&
        (target ? (
          <>
            <button
              className="usage-button"
              onClick={() => open(source, undefined, "sessions")}
            >
              ← All sessions
            </button>
            <h2 className="telemetry-heading">{name}</h2>
            {detail && (
              <>
                <p className="telemetry-help">
                  {!privateDetails ? "Log in to view prompt text. " : ""}
                  Return to the session list and reopen to refresh.
                </p>
                <SessionDetails
                  key={`${source}:${target}:${range}`}
                  detail={detail}
                />
              </>
            )}
          </>
        ) : (
          <>
            <div className="telemetry-toolbar">
              <h2 className="telemetry-heading">
                Sessions <small>({filtered.length})</small>
              </h2>
              <input
                type="search"
                aria-label="Search telemetry sessions"
                placeholder="Search sessions, projects, models…"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setVisibleCount(20);
                }}
              />
            </div>
            <div className="usage-table-wrap">
              <table className="usage-table">
                <thead>
                  <tr>
                    <th>Session / project</th>
                    <th>Tokens</th>
                    <th>Requests</th>
                    <th>Estimated cost</th>
                    <th>Last observed</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, visibleCount).map((item) => (
                    <tr key={item.id}>
                      <td>
                        <button
                          className="usage-session"
                          onClick={() => open(source, item.id, "sessions")}
                        >
                          {item.name}
                        </button>
                        <small>
                          {item.project ?? "Project unavailable"} ·{" "}
                          {item.id.slice(0, 8)}
                        </small>
                      </td>
                      <td>{number(item.tokens)}</td>
                      <td>{number(item.apiRequests)}</td>
                      <td>{money(item.estimatedCostUsd)}</td>
                      <td>{new Date(item.lastSeen).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!filtered.length && !loading && !error && (
              <p className="telemetry-help">
                No matching telemetry. Collection begins when a configured agent
                exports an event.
              </p>
            )}
            {filtered.length > visibleCount && (
              <button
                className="usage-button"
                onClick={() => setVisibleCount((value) => value + 20)}
              >
                Show more sessions
              </button>
            )}
          </>
        ))}

      {page === "accounts" && accounts && (
        <>
          <h2 className="telemetry-heading">
            Accounts <small>({accounts.accounts.length})</small>
          </h2>
          <p className="telemetry-help">
            Account details are protected by your Harbor login. Chats spanning
            multiple accounts contribute to each account's observed chat count.
          </p>
          <div className="usage-table-wrap">
            <table className="usage-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Tokens</th>
                  <th>Chats</th>
                  <th>API requests</th>
                  <th>Active minutes</th>
                  <th>Estimated cost</th>
                </tr>
              </thead>
              <tbody>
                {accounts.accounts.map((item) => (
                  <tr key={item.email}>
                    <td>{item.email || "Unattributed"}</td>
                    <td>
                      {number(
                        item.inputTokens +
                          item.outputTokens +
                          item.cacheReadTokens +
                          item.cacheCreationTokens,
                      )}
                    </td>
                    <td>{item.sessions}</td>
                    <td>{number(item.apiRequests)}</td>
                    <td>
                      {number(
                        item.activeUserSeconds == null &&
                          item.activeCliSeconds == null
                          ? null
                          : ((item.activeUserSeconds ?? 0) +
                              (item.activeCliSeconds ?? 0)) /
                              60,
                      )}
                    </td>
                    <td>
                      {money(item.estimatedCostUsd)}
                      {item.missingCostSlices ? " · partial" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!accounts.accounts.length && (
            <p className="telemetry-help">
              No account usage observed in this period.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="usage-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TokenTimeline({ points }: { points: TelemetrySummary["timeline"] }) {
  const max = points.at(-1)?.total ?? 0;
  if (!max) return null;
  const start = points[0].timestamp,
    span = Math.max(1, points.at(-1)!.timestamp - start);
  const path = points
    .map(
      (point) =>
        `${20 + (760 * (point.timestamp - start)) / span},${145 - (125 * point.total) / max}`,
    )
    .join(" ");
  return (
    <figure className="usage-timeline">
      <figcaption>
        Cumulative observed tokens <strong>{number(max)}</strong>
      </figcaption>
      <svg
        viewBox="0 0 800 165"
        role="img"
        aria-label={`Cumulative usage reaches ${number(max)} tokens`}
      >
        <path d="M20 20V145H780" className="usage-chart-axis" />
        <polyline
          points={`20,145 ${path}`}
          fill="none"
          className="usage-chart-line"
        />
      </svg>
      <div>
        <span>{new Date(start).toLocaleDateString()}</span>
        <span>{new Date(points.at(-1)!.timestamp).toLocaleDateString()}</span>
      </div>
    </figure>
  );
}

function SessionDetails({ detail }: { detail: SessionView }) {
  const [activity, setActivity] = useState(detail.activity);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [prompts, setPrompts] = useState(detail.prompts);
  const [promptLimit, setPromptLimit] = useState(10);
  const session = detail.session;
  const input = session.inputTokens,
    output = session.outputTokens;
  const cached =
    "cacheReadTokens" in session
      ? session.cacheReadTokens
      : session.cachedInputTokens;
  const cacheWrite =
    "cacheCreationTokens" in session
      ? session.cacheCreationTokens
      : session.cacheWriteTokens;
  const range =
    typeof detail.period === "object"
      ? `days=custom&start=${detail.period.start}&end=${detail.period.end}`
      : `days=${detail.period}`;
  async function morePrompts() {
    if (promptLimit < prompts.length) {
      setPromptLimit((value) => value + 10);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await authFetch(
        `/api/telemetry/${detail.source}/sessions/${encodeURIComponent(session.id)}/prompts?${range}&offset=${prompts.length}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("Could not load older prompts.");
      const data = (await response.json()) as {
        prompts: SessionView["prompts"];
      };
      setPrompts((previous) => [...previous, ...data.prompts]);
      setPromptLimit((value) => value + 10);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setLoading(false);
    }
  }
  async function loadMore() {
    setLoading(true);
    setError("");
    const period =
      typeof detail.period === "object"
        ? `days=custom&start=${detail.period.start}&end=${detail.period.end}`
        : `days=${detail.period}`;
    try {
      const response = await authFetch(
        `/api/telemetry/${detail.source}/sessions/${encodeURIComponent(session.id)}/events?${period}&offset=${activity.length}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("Could not load older activity.");
      const data = (await response.json()) as {
        events: SessionView["activity"];
      };
      setActivity((previous) => [...previous, ...data.events]);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="session-usage">
      <p className="telemetry-help">
        {session.models.join(" · ") || "Model unavailable"} · Session{" "}
        {session.id}
      </p>
      <div className="usage-grid">
        <Metric label="Input tokens" value={number(input)} />
        <Metric label="Output tokens" value={number(output)} />
        <Metric label="Cached input" value={number(cached)} />
        <Metric label="Cache write" value={number(cacheWrite)} />
        <Metric
          label="Median API request · ms"
          value={number(session.medianRequestMs)}
        />
        <Metric label="API requests" value={number(session.apiRequests)} />
      </div>
      <div className="usage-grid">
        <Metric
          label="Reasoning output tokens"
          value={number(
            "reasoningOutputTokens" in session
              ? session.reasoningOutputTokens
              : null,
          )}
        />
        <Metric
          label="Estimated session cost"
          value={money(
            "estimatedCostUsd" in session ? session.estimatedCostUsd : null,
          )}
        />
        <Metric
          label="Active time · minutes"
          value={number(
            "activeUserSeconds" in session &&
              (session.activeUserSeconds !== null ||
                session.activeCliSeconds !== null)
              ? ((session.activeUserSeconds ?? 0) +
                  (session.activeCliSeconds ?? 0)) /
                  60
              : null,
          )}
        />
      </div>
      {detail.source === "codex" && (
        <p className="telemetry-help">
          Cached input and reasoning tokens are subsets of input/output. Missing
          completion counts can make observed totals partial. Cost and active
          time are unavailable for Codex.
        </p>
      )}
      <h3>Prompts</h3>
      <p className="telemetry-help">
        Showing {Math.min(promptLimit, prompts.length)} of {detail.promptTotal}{" "}
        observed prompts. Text requires prompt export and is sanitized before
        storage; redaction is best effort.
      </p>
      {prompts.slice(0, promptLimit).map((prompt) => (
        <details className="usage-prompt" key={prompt.id}>
          <summary>
            {new Date(prompt.timestamp).toLocaleString()} ·{" "}
            {prompt.tokens == null
              ? "Prompt"
              : `${number(prompt.tokens)} tokens`}
          </summary>
          <pre>
            {prompt.text ??
              (detail.privateDetails
                ? "Prompt text was not captured."
                : "Log in to view prompt text.")}
          </pre>
        </details>
      ))}
      {detail.promptTotal > Math.min(promptLimit, prompts.length) && (
        <button
          className="usage-button"
          disabled={loading}
          onClick={() => void morePrompts()}
        >
          Show more prompts
        </button>
      )}
      <h3>Observed tool and request activity</h3>
      <ul className="usage-activity">
        {activity.map((event, index) => (
          <li key={`${event.timestamp}:${index}`}>
            <time>{new Date(event.timestamp).toLocaleString()}</time>
            <span>
              {event.name}
              {event.toolName || event.tool
                ? ` · ${event.toolName || event.tool}`
                : ""}
            </span>
            <span>
              {event.durationMs == null ? "" : `${number(event.durationMs)} ms`}
            </span>
          </li>
        ))}
      </ul>
      {error && <p role="status">{error}</p>}
      {activity.length < detail.activityTotal && (
        <button
          className="usage-button"
          disabled={loading}
          onClick={() => void loadMore()}
        >
          {loading ? "Loading…" : "Load older activity"}
        </button>
      )}
    </div>
  );
}
