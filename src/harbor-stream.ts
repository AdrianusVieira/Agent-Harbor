import type { HarborEvent } from "./events.ts";

export type Connection = "connecting" | "connected" | "disconnected";

type Environment = {
  createStream: () => Pick<EventTarget, "addEventListener"> & { close: () => void };
  window: Pick<Window, "addEventListener" | "removeEventListener">;
  document: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">;
};

export function watchHarborStream(
  callbacks: {
    connection: (state: Connection) => void;
    snapshot: (events: HarborEvent[]) => void;
    event: (event: HarborEvent) => void;
  },
  environment: Environment = {
    createStream: () => new EventSource("/api/stream"),
    window,
    document,
  },
) {
  let current: ReturnType<Environment["createStream"]> | undefined;
  let disposed = false;

  function connect() {
    current?.close();
    callbacks.connection("connecting");
    const stream = environment.createStream();
    current = stream;
    const active = () => !disposed && current === stream;
    stream.addEventListener("error", () => {
      if (active()) callbacks.connection("disconnected");
    });
    stream.addEventListener("snapshot", (message) => {
      if (!active()) return;
      callbacks.snapshot(JSON.parse((message as MessageEvent<string>).data) as HarborEvent[]);
      // A socket opening alone does not establish that the view is current.
      callbacks.connection("connected");
    });
    stream.addEventListener("event", (message) => {
      if (active())
        callbacks.event(JSON.parse((message as MessageEvent<string>).data) as HarborEvent);
    });
  }

  function resume() {
    // A suspended tab can retain an apparently open but stale connection.
    // A new connection gets an authoritative snapshot without replaying events.
    if (environment.document.visibilityState === "visible") connect();
  }

  connect();
  environment.document.addEventListener("visibilitychange", resume);
  for (const name of ["focus", "pageshow", "online"])
    environment.window.addEventListener(name, resume);

  return () => {
    disposed = true;
    current?.close();
    environment.document.removeEventListener("visibilitychange", resume);
    for (const name of ["focus", "pageshow", "online"])
      environment.window.removeEventListener(name, resume);
  };
}
