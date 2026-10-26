import assert from "node:assert/strict";
import { createServer } from "node:net";
import { once } from "node:events";
import { test } from "node:test";
import { assertReceiverPortAvailable } from "./startup.ts";

for (const host of ["0.0.0.0", "127.0.0.1"]) {
  test(`startup rejects an existing ${host} server before creating another receiver`, async () => {
    const server = createServer((socket) => socket.end());
    server.listen(0, host);
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    try {
      await assert.rejects(assertReceiverPortAvailable(address.port), /already has a local server/);
      assert.equal(server.listening, true);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
    // A clean shutdown makes the same port available for switching modes.
    await assertReceiverPortAvailable(address.port);
  });
}
