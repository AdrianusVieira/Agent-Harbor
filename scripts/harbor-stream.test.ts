import assert from "node:assert/strict";
import { test } from "node:test";
import type { HarborEvent } from "../src/events.ts";
import { watchHarborStream } from "../src/harbor-stream.ts";
import type { Connection } from "../src/harbor-stream.ts";

class Stream extends EventTarget {
  closed = false;
  close() { this.closed = true; }
  send(type: string, value: unknown) {
    this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(value) }));
  }
}

function fixture() {
  const streams: Stream[] = [];
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" as DocumentVisibilityState });
  const states: Connection[] = [];
  let events: HarborEvent[] = [];
  const dispose = watchHarborStream({
    connection: (state) => states.push(state),
    snapshot: (snapshot) => { events = snapshot; },
    event: (event) => { events = [...events, event]; },
  }, {
    createStream: () => {
      const stream = new Stream();
      streams.push(stream);
      return stream;
    },
    window,
    document,
  });
  return { streams, window, document, states, dispose, events: () => events };
}

const working: HarborEvent = {
  id: "working", source: "codex", sessionId: "same-session",
  message: "Codex received a prompt.", type: "activity",
  receivedAt: "2026-10-26T16:14:00.000Z",
};
const ready: HarborEvent = {
  ...working, id: "ready", type: "ready",
  message: "Codex finished its response.", receivedAt: "2026-10-26T16:15:28.843Z",
};

test("returning to Harbor replaces a stale working view with the receiver snapshot", () => {
  const f = fixture();
  const original = f.streams[0];
  original.send("snapshot", [working]);
  assert.deepEqual(f.events(), [working]);
  assert.equal(f.states.at(-1), "connected");

  f.document.visibilityState = "hidden";
  f.document.dispatchEvent(new Event("visibilitychange"));
  f.window.dispatchEvent(new Event("focus"));
  assert.equal(f.streams.length, 1);

  f.document.visibilityState = "visible";
  f.document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(original.closed, true);
  assert.equal(f.states.at(-1), "connecting");
  // A late callback from the replaced connection cannot overwrite fresh state.
  const restored = f.streams[1];
  restored.send("snapshot", [working, ready]);
  original.send("snapshot", [working]);
  original.send("event", working);
  original.dispatchEvent(new Event("error"));
  assert.deepEqual(f.events(), [working, ready]);
  assert.equal(f.states.at(-1), "connected");
  restored.send("event", { ...working, id: "next-prompt" });
  assert.equal(f.events().at(-1)?.id, "next-prompt");
  f.dispose();
});

test("focus, network restoration, and page restoration resync; errors retry and cleanup ignores late callbacks", () => {
  const f = fixture();
  f.streams[0].send("snapshot", [working]);
  for (const name of ["focus", "online", "pageshow"]) {
    const previous = f.streams.at(-1)!;
    f.window.dispatchEvent(new Event(name));
    assert.equal(previous.closed, true);
    assert.equal(f.states.at(-1), "connecting");
    const current = f.streams.at(-1)!;
    current.dispatchEvent(new Event("open"));
    assert.equal(f.states.at(-1), "connecting");
    current.send("snapshot", [ready]);
    assert.equal(f.states.at(-1), "connected");
  }
  const current = f.streams.at(-1)!;
  current.dispatchEvent(new Event("error"));
  assert.equal(f.states.at(-1), "disconnected");
  // EventSource's native retry can still deliver a fresh snapshot.
  current.send("snapshot", []);
  assert.deepEqual(f.events(), []);
  assert.equal(f.states.at(-1), "connected");
  f.dispose();
  const count = f.streams.length;
  for (const name of ["focus", "online", "pageshow"])
    f.window.dispatchEvent(new Event(name));
  f.document.dispatchEvent(new Event("visibilitychange"));
  current.send("event", working);
  current.send("snapshot", [working]);
  current.dispatchEvent(new Event("error"));
  assert.equal(f.streams.length, count);
  assert.equal(current.closed, true);
  assert.deepEqual(f.events(), []);
  assert.equal(f.states.at(-1), "connected");
});
