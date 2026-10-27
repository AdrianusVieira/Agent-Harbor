import { authFetch } from "./auth-fetch.ts";
import { useEffect, useState } from "react";
import { eventLabels, platformNames, type HarborEvent } from "./events.ts";

export function SignalHistory() {
  const [error, setError] = useState("");
  const [events, setEvents] = useState<HarborEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void authFetch("/api/history", {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load signal history.");
        const data = (await response.json()) as {
          events: HarborEvent[];
          total: number;
        };
        if (!controller.signal.aborted) {
          setEvents(data.events);
          setTotal(data.total);
        }
      })
      .catch((reason: Error) => {
        if (!controller.signal.aborted) setError(reason.message);
      });
    return () => controller.abort();
  }, []);
  async function more() {
    setLoading(true);
    try {
      const response = await authFetch(
        `/api/history?before=${encodeURIComponent(events.at(-1)!.id)}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("Could not load older signals.");
      const data = (await response.json()) as {
        events: HarborEvent[];
        total: number;
      };
      setEvents((previous) => [...previous, ...data.events]);
      setTotal(data.total);
      setError("");
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <section className="telemetry-panel" aria-label="Saved signal history">
      <h2 className="telemetry-heading">Saved signals</h2>
      <p className="telemetry-help">
        {total} signals stored locally. Newest first · this historical view does
        not trigger notifications.
      </p>
      {error && <p role="status">{error}</p>}
      <ol className="usage-activity">
        {events.map((event) => (
          <li key={event.id}>
            <time>{new Date(event.receivedAt).toLocaleString()}</time>
            <span>
              {event.sessionName ?? event.sessionId.slice(0, 8)} ·{" "}
              {platformNames[event.source] ?? event.source}
              <small>{event.projectName ?? ""}</small>
            </span>
            <span>{eventLabels[event.type]}</span>
            <p>{event.message}</p>
          </li>
        ))}
      </ol>
      {!events.length && !error && (
        <p className="telemetry-help">
          Saved signals begin when an observed session sends its next event.
        </p>
      )}
      {events.length < total && (
        <button
          className="usage-button"
          disabled={loading}
          onClick={() => void more()}
        >
          {loading ? "Loading…" : "Load older signals"}
        </button>
      )}
    </section>
  );
}
