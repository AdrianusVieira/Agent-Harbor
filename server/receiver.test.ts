import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { createReceiver } from "./receiver.ts";
import type { HarborEvent } from "../src/events.ts";

test("receiver validates events and delivers live events and reconnect history", async (t) => {
  const receiver = createReceiver();
  const server = createServer((req, res) => {
    void receiver.handle(req, res).then((handled) => {
      if (!handled) {
        res.writeHead(404);
        res.end();
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    receiver.close();
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const valid = {
    source: "manual",
    sessionId: "one",
    type: "waiting",
    message: "Need input.",
  };
  const post = (value: unknown, headers = {}) =>
    fetch(`${base}/api/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(value),
    });

  await t.test(
    "rejects malformed, unsupported and cross-origin submissions",
    async () => {
      assert.equal((await post({ ...valid, type: "finished" })).status, 400);
      assert.equal((await post({ ...valid, source: "" })).status, 400);
      assert.equal(
        (await post({ ...valid, message: "x".repeat(4001) })).status,
        400,
      );
      assert.equal(
        (await post(valid, { Origin: "https://unrelated.example" })).status,
        403,
      );
      assert.equal(
        (await fetch(`${base}/api/events`, { method: "POST", body: "{}" }))
          .status,
        415,
      );
      assert.equal(
        (
          await fetch(`${base}/api/events`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{",
          })
        ).status,
        400,
      );
      assert.equal(
        (await post({ ...valid, extra: "x".repeat(17_000) })).status,
        413,
      );
      assert.equal((await fetch(`${base}/api/events`)).status, 405);
    },
  );

  await t.test(
    "sends an empty snapshot, a live event and replay on reconnect",
    async () => {
      const controller = new AbortController();
      const stream = await fetch(`${base}/api/stream`, {
        signal: controller.signal,
      });
      const reader = stream.body!.getReader();
      const decoder = new TextDecoder();
      assert.equal(
        decoder.decode((await reader.read()).value),
        "event: snapshot\ndata: []\n\n",
      );
      const response = await post(valid);
      assert.equal(response.status, 201);
      const event = (await response.json()) as HarborEvent;
      assert.equal(event.type, "waiting");
      assert.ok(event.id);
      assert.ok(Number.isFinite(Date.parse(event.receivedAt)));
      const live = decoder.decode((await reader.read()).value);
      assert.ok(live.includes(`"id":"${event.id}"`));
      assert.ok(live.startsWith("event: event\n"));
      controller.abort();

      const reconnect = new AbortController();
      const replay = await fetch(`${base}/api/stream`, {
        signal: reconnect.signal,
      });
      const history = decoder.decode(
        (await replay.body!.getReader().read()).value,
      );
      assert.ok(history.startsWith("event: snapshot\n"));
      assert.ok(history.includes(event.id));
      reconnect.abort();
    },
  );
});
