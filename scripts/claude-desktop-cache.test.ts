import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  appendFile,
  mkdtemp,
  readFile,
  rename,
  rm,
  truncate,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { serialize } from "node:v8";
import { createReceiver } from "../server/receiver.ts";
import type { HarborEvent } from "../src/events.ts";
import {
  decodeCacheValue,
  readCacheWrites,
  readDesktopSnapshot,
} from "./claude-desktop-cache.ts";
import { createDesktopWatcher } from "./watch-claude-desktop.ts";

const ID = "11111111-1111-4111-8111-111111111111";
const LEAF = "22222222-2222-4222-8222-222222222222";
const NEXT = "33333333-3333-4333-8333-333333333333";
const START = Date.parse("2026-01-01T00:00:00Z");

function integer(value: number) {
  const bytes = [];
  do {
    const part = value % 128;
    value = Math.floor(value / 128);
    bytes.push(part | (value ? 128 : 0));
  } while (value);
  return Buffer.from(bytes);
}

function key(id = ID, store = 1) {
  return Buffer.concat([
    Buffer.from([0, 1, store, 1, 1]),
    integer(id.length),
    Buffer.from(id, "utf16le").swap16(),
  ]);
}

function value(input: unknown, version = 16) {
  const payload = Buffer.from(serialize(input));
  // JSON/container fixture tags are identical in V8 versions 15 and 16.
  // Exercise the observed Chrome version without modifying captured user data.
  payload[1] = version;
  return Buffer.concat([
    integer(1),
    Buffer.from([255, 21, 254]),
    Buffer.alloc(12),
    payload,
  ]);
}

function tree(
  leaf = LEAF,
  name: unknown = "Harbor check",
  timestamp = START + 1000,
) {
  const content: Record<string, unknown>[] = [
    {
      input: { command: "private-tool-arguments" },
      text: "private-response",
      type: "text",
    },
  ];
  const message = {
    content,
    created_at: new Date(timestamp).toISOString(),
    sender: "assistant",
    stop_reason: "end_turn",
    updated_at: new Date(timestamp).toISOString(),
    uuid: leaf,
  };
  return {
    accountUuid: "private-account",
    conversationUuid: ID,
    orgUuid: "private-organization",
    product: "chat",
    tree: {
      chat_messages: [message],
      current_leaf_message_uuid: leaf,
      messageByUuid: new Map([[leaf, message]]),
      name,
      settings: { private_setting: "private-value" },
      uuid: ID,
    },
  };
}

function questionTree(leaf = LEAF, name = "Harbor check") {
  const data = tree(leaf, name);
  data.tree.chat_messages[0].content.push(
    {
      id: "private-question-call",
      input: {
        questions: [
          {
            options: ["private-yes", "private-no"],
            question: "private-question",
            type: "single_select",
          },
        ],
      },
      name: "ask_user_input_v0",
      type: "tool_use",
    },
    {
      content: [{ text: "private-tool-result", type: "text" }],
      is_error: false,
      tool_use_id: "private-question-call",
      type: "tool_result",
    },
  );
  return data;
}

function batch(sequence: number, writes: { key?: Buffer; value?: Buffer }[]) {
  const header = Buffer.alloc(12);
  header.writeBigUInt64LE(BigInt(sequence));
  header.writeUInt32LE(writes.length, 8);
  return Buffer.concat([
    header,
    ...writes.flatMap((write) => {
      const k = write.key ?? key();
      return [
        Buffer.from([write.value ? 1 : 0]),
        integer(k.length),
        k,
        ...(write.value ? [integer(write.value.length), write.value] : []),
      ];
    }),
  ]);
}

// Independent bitwise CRC32C implementation for fixture checksums.
function fragment(kind: number, data: Buffer) {
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([Buffer.from([kind]), data])) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = crc & 1 ? (crc >>> 1) ^ 0x82f63b78 : crc >>> 1;
  }
  crc = (crc ^ 0xffffffff) >>> 0;
  const header = Buffer.alloc(7);
  header.writeUInt32LE((((crc >>> 15) | (crc << 17)) + 0xa282ead8) >>> 0);
  header.writeUInt16LE(data.length, 4);
  header[6] = kind;
  return Buffer.concat([header, data]);
}

function log(batches: Buffer[]) {
  const parts: Buffer[] = [];
  let position = 0;
  for (const batch of batches) {
    let offset = 0;
    do {
      const available = 32768 - (position % 32768);
      if (available < 7) {
        parts.push(Buffer.alloc(available));
        position += available;
        continue;
      }
      const length = Math.min(batch.length - offset, available - 7);
      const last = offset + length === batch.length;
      const kind = offset === 0 ? (last ? 1 : 2) : last ? 4 : 3;
      const part = fragment(kind, batch.subarray(offset, offset + length));
      parts.push(part);
      position += part.length;
      offset += length;
    } while (offset < batch.length);
  }
  return Buffer.concat(parts);
}

test("Desktop cache decoder accepts supported containers and rejects unknown or malformed formats", () => {
  for (const version of [15, 16]) {
    const input = {
      array: [true, false, null, undefined, -12, 42, 1.5, "café", "港", "🚢"],
      map: new Map([["one", new Set([1, 2])]]),
    };
    const decoded = decodeCacheValue(value(input, version)) as typeof input;
    assert.deepEqual(decoded.array, input.array);
    assert.deepEqual(decoded.map, input.map);
  }
  const cyclic: Record<string, unknown> = { name: "safe" };
  cyclic.self = cyclic;
  const decoded = decodeCacheValue(value(cyclic)) as typeof cyclic;
  assert.equal(decoded.self, decoded);
  assert.equal(Object.getPrototypeOf(decoded), null);
  const dangerous = decodeCacheValue(
    value(JSON.parse('{"__proto__":{"polluted":true}}')),
  ) as Record<string, unknown>;
  assert.equal(Object.getPrototypeOf(dangerous), null);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  for (const input of [
    value({}, 17),
    value(new Date()),
    value(new ArrayBuffer(8)),
    Buffer.from([1, 255]),
    value({}).subarray(0, 18),
  ]) {
    assert.throws(() => decodeCacheValue(input));
  }
  const trailer = value({});
  trailer[4] = 1;
  assert.throws(() => decodeCacheValue(trailer));
  let nested: unknown = null;
  for (let i = 0; i < 70; i++) nested = [nested];
  assert.throws(() => decodeCacheValue(value(nested)));
});

test("WAL reader validates checksums and batches, joins fragments, and tolerates incomplete tails", () => {
  const large = batch(10, [{ value: value({ padding: "x".repeat(80_000) }) }]);
  const small = batch(11, [{ value: value(tree()) }, { key: key(ID, 2) }]);
  const data = log([large, small]);
  const writes = readCacheWrites(data);
  assert.deepEqual(
    writes.map((write) => write.sequence),
    [10n, 11n, 12n],
  );
  assert.equal(writes[2].value, undefined);
  assert.deepEqual(
    readCacheWrites(data.subarray(0, data.length - 1)).map(
      (write) => write.sequence,
    ),
    [10n],
  );
  assert.equal(readCacheWrites(log([large]).subarray(0, 50_000)).length, 0);
  const corrupt = Buffer.from(data);
  corrupt[50] ^= 1;
  assert.throws(() => readCacheWrites(corrupt), /checksum/);
  const wrongCount = batch(1, [{ value: value(tree()) }]);
  wrongCount.writeUInt32LE(2, 8);
  assert.throws(() => readCacheWrites(log([wrongCount])));
  assert.throws(() => readCacheWrites(fragment(3, Buffer.from("orphan"))));
  assert.throws(() => readCacheWrites(Buffer.alloc(8_388_609)), /limit/);
});

test(
  "Desktop watcher ignores history and renames, sends private-content-free ready events, and survives cache/receiver changes",
  { timeout: 15_000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "harbor-desktop-"));
    t.after(() => rm(directory, { force: true, recursive: true }));
    const file = join(directory, "000004.log");
    const receiver = createReceiver();
    let reject = false;
    let stall = false;
    const server = createServer((req, res) => {
      if (stall) return;
      if (reject) {
        res.writeHead(503);
        res.end();
        return;
      }
      void receiver.handle(req, res);
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
    let clock = START;
    const poll = createDesktopWatcher(directory, address.port, () => clock);
    const batches = [batch(1, [{ value: value(tree()) }])];
    const save = () => writeFile(file, log(batches));
    await save();
    const original = await readFile(file);
    assert.equal((await poll()).baseline, true);
    assert.equal((await poll()).delivered, 0);
    assert.deepEqual(
      await readFile(file),
      original,
      "Reader must not change cache bytes.",
    );
    batches.push(batch(2, [{ value: value(tree(LEAF, "Renamed")) }]));
    await save();
    assert.equal(
      (await poll()).delivered,
      0,
      "Rename must not replay the response.",
    );
    const fresh = tree(NEXT, "Renamed");
    Reflect.deleteProperty(fresh.tree.chat_messages[0], "updated_at");
    batches.push(batch(3, [{ value: value(fresh) }]));
    await save();
    assert.equal((await poll()).delivered, 1);
    assert.equal((await poll()).delivered, 0);
    const controller = new AbortController();
    const stream = await fetch(`http://127.0.0.1:${address.port}/api/stream`, {
      signal: controller.signal,
    });
    const chunk = await stream.body!.getReader().read();
    controller.abort();
    const snapshot = new TextDecoder().decode(chunk.value);
    assert.doesNotMatch(
      snapshot,
      /private-|content|accountUuid|messageByUuid|stop_reason/,
    );
    const history = JSON.parse(
      snapshot.split("data: ")[1].trim(),
    ) as HarborEvent[];
    assert.equal(history.length, 1);
    const { id, receivedAt, ...event } = history[0];
    assert.ok(id && receivedAt);
    assert.deepEqual(event, {
      message: "Claude Desktop finished its response.",
      sessionId: ID,
      sessionName: "Renamed",
      source: "claude-desktop",
      type: "ready",
    });

    // Late cache loading of old history must not alert, even for an unseen ID.
    const old = tree(
      "44444444-4444-4444-8444-444444444444",
      "Old",
      START - 1000,
    );
    batches.push(batch(4, [{ value: value(old) }]));
    await save();
    assert.equal((await poll()).delivered, 0);
    // The active leaf controls completion: previous end_turn messages do not.
    const human = tree();
    human.tree.chat_messages[0].sender = "human";
    batches.push(batch(5, [{ value: value(human) }]));
    await save();
    assert.equal((await poll()).delivered, 0);
    reject = true;
    batches.push(
      batch(6, [
        { value: value(tree("55555555-5555-4555-8555-555555555555")) },
      ]),
    );
    await save();
    assert.equal((await poll()).failed, 1);
    assert.equal(
      (await poll()).failed,
      0,
      "Failed delivery must not be retried.",
    );
    reject = false;
    stall = true;
    batches.push(
      batch(7, [
        { value: value(tree("66666666-6666-4666-8666-666666666666")) },
      ]),
    );
    await save();
    assert.equal((await poll()).failed, 1);
    stall = false;
    // Rotation preserves the sequence; disappearance/read failure keeps state.
    await rename(file, join(directory, "000005.log"));
    assert.equal((await poll()).baseline, false);
    await rename(join(directory, "000005.log"), join(directory, "hidden"));
    await assert.rejects(poll());
    await rename(join(directory, "hidden"), file);
    assert.equal((await poll()).delivered, 0);
    // A truncated/rebuilt source establishes a new baseline without replay.
    await writeFile(file, log([batch(1, [{ value: value(tree()) }])]));
    assert.equal((await poll()).reset, true);
    clock = START + 10_000;
    await truncate(file, 0);
    assert.equal((await poll()).reset, true);
    await writeFile(
      file,
      log([
        batch(1, [
          {
            value: value(
              tree(
                "77777777-7777-4777-8777-777777777777",
                "Late old response",
                START + 2000,
              ),
            ),
          },
        ]),
      ]),
    );
    assert.equal((await poll()).delivered, 0);
    assert.throws(() => createDesktopWatcher(directory, 0));
  },
);

test("Desktop snapshots select the current leaf, enforce identity, and skip unsupported records", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "harbor-desktop-schema-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const file = join(directory, "000004.log");
  for (const mutate of [
    (d: ReturnType<typeof tree>) => {
      d.tree.current_leaf_message_uuid = NEXT;
    },
    (d: ReturnType<typeof tree>) => {
      d.tree.chat_messages[0].stop_reason = "tool_use";
    },
    (d: ReturnType<typeof tree>) => {
      d.conversationUuid = NEXT;
    },
    (d: ReturnType<typeof tree>) => {
      d.tree.uuid = NEXT;
    },
    (d: ReturnType<typeof tree>) => {
      d.tree.chat_messages[0].updated_at = "invalid";
    },
    (d: ReturnType<typeof tree>) => {
      d.product = "unknown";
    },
  ]) {
    const data = tree();
    mutate(data);
    await writeFile(file, log([batch(1, [{ value: value(data) }])]));
    assert.equal((await readDesktopSnapshot(directory)).observations.length, 0);
  }
  for (const name of [null, 42, "", "x".repeat(201)]) {
    await writeFile(
      file,
      log([batch(1, [{ value: value(tree(LEAF, name)) }])]),
    );
    assert.equal(
      (await readDesktopSnapshot(directory)).observations[0].event.sessionName,
      undefined,
    );
  }
  await writeFile(
    file,
    log([
      batch(1, [
        { value: value(tree()) },
        { value: value(tree(), 17), key: key(ID, 2) },
      ]),
    ]),
  );
  const result = await readDesktopSnapshot(directory);
  assert.equal(result.observations.length, 1);
  assert.equal(result.skipped, 1);
  await appendFile(file, fragment(1, batch(3, [{ key: key() }])));
  assert.equal((await readDesktopSnapshot(directory)).observations.length, 0);
});

test("fresh Desktop replies may have only created_at; missing or invalid timestamps stay ineligible", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "harbor-desktop-timestamps-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const file = join(directory, "000004.log");
  const data = tree();
  Reflect.deleteProperty(data.tree.chat_messages[0], "updated_at");
  await writeFile(file, log([batch(1, [{ value: value(data) }])]));
  assert.equal(
    (await readDesktopSnapshot(directory)).observations[0].messageAt,
    START + 1000,
  );
  data.tree.chat_messages[0].stop_reason = "tool_use";
  await writeFile(file, log([batch(1, [{ value: value(data) }])]));
  assert.equal(
    (await readDesktopSnapshot(directory)).observations.length,
    0,
    "A creation date alone must not imply completion.",
  );
  data.tree.chat_messages[0].stop_reason = "end_turn";
  for (const created_at of [undefined, "not-a-date"]) {
    if (created_at === undefined)
      Reflect.deleteProperty(data.tree.chat_messages[0], "created_at");
    else data.tree.chat_messages[0].created_at = created_at;
    await writeFile(file, log([batch(1, [{ value: value(data) }])]));
    assert.equal((await readDesktopSnapshot(directory)).observations.length, 0);
  }
});

test("only a successful structured question on the active finished reply reports input requested", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "harbor-desktop-question-schema-"),
  );
  t.after(() => rm(directory, { force: true, recursive: true }));
  const file = join(directory, "000001.log");
  const snapshot = async (data: ReturnType<typeof tree>) => {
    await writeFile(file, log([batch(1, [{ value: value(data) }])]));
    return readDesktopSnapshot(directory);
  };
  assert.equal(
    (await snapshot(questionTree())).observations[0].event.type,
    "waiting",
  );
  for (const mutate of [
    (d: ReturnType<typeof tree>) => {
      d.tree.chat_messages[0].content[1].name = "another_tool";
    },
    (d: ReturnType<typeof tree>) => {
      d.tree.chat_messages[0].content[1].id = "";
    },
    (d: ReturnType<typeof tree>) => {
      d.tree.chat_messages[0].content[1].input = { questions: [] };
    },
    (d: ReturnType<typeof tree>) => {
      d.tree.chat_messages[0].content[1].input = {
        questions: [{ question: "" }],
      };
    },
    (d: ReturnType<typeof tree>) => {
      d.tree.chat_messages[0].content[2].is_error = true;
    },
    (d: ReturnType<typeof tree>) => {
      Reflect.deleteProperty(d.tree.chat_messages[0].content[2], "is_error");
    },
    (d: ReturnType<typeof tree>) => {
      d.tree.chat_messages[0].content[2].tool_use_id = "unrelated-call";
    },
    (d: ReturnType<typeof tree>) => {
      d.tree.chat_messages[0].content.pop();
    },
  ]) {
    const data = questionTree();
    mutate(data);
    assert.equal((await snapshot(data)).observations[0].event.type, "ready");
  }
  const unfinished = questionTree();
  unfinished.tree.chat_messages[0].stop_reason = "tool_use";
  assert.equal((await snapshot(unfinished)).observations.length, 0);
  assert.equal(
    (await snapshot(tree())).observations[0].event.type,
    "ready",
    "Ordinary text is not interpreted as a question request.",
  );
});

test("Desktop structured questions deliver waiting then ready without replaying history or leaking question/answer content", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "harbor-desktop-question-flow-"),
  );
  t.after(() => rm(directory, { force: true, recursive: true }));
  const file = join(directory, "000001.log");
  const receiver = createReceiver();
  const server = createServer((req, res) => {
    void receiver.handle(req, res);
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
  const poll = createDesktopWatcher(directory, address.port, () => START);
  const batches = [batch(1, [{ value: value(questionTree()) }])];
  const save = () => writeFile(file, log(batches));
  const history = async () => {
    const controller = new AbortController();
    const stream = await fetch(`http://127.0.0.1:${address.port}/api/stream`, {
      signal: controller.signal,
    });
    const result = await stream.body!.getReader().read();
    controller.abort();
    const text = new TextDecoder().decode(result.value);
    assert.doesNotMatch(
      text,
      /private-|questions|options|ask_user_input|tool_use_id|messageAt/,
    );
    return JSON.parse(text.split("data: ")[1].trim()) as HarborEvent[];
  };
  await save();
  assert.equal((await poll()).baseline, true);
  assert.equal(
    (await history()).length,
    0,
    "Existing questions must not be replayed.",
  );
  const question = questionTree(NEXT);
  batches.push(batch(2, [{ value: value(question) }]));
  await save();
  assert.equal((await poll()).delivered, 1);
  const waiting = (await history())[0];
  const { id, receivedAt, ...event } = waiting;
  assert.ok(id && receivedAt);
  assert.deepEqual(event, {
    message: "Claude Desktop asked for input.",
    sessionId: ID,
    sessionName: "Harbor check",
    source: "claude-desktop",
    type: "waiting",
  });
  assert.equal((await poll()).delivered, 0);
  question.tree.name = "Renamed";
  batches.push(batch(3, [{ value: value(question) }]));
  await save();
  assert.equal((await poll()).delivered, 0);

  const humanId = "44444444-4444-4444-8444-444444444444";
  const replyId = "55555555-5555-4555-8555-555555555555";
  const human = {
    ...tree(humanId).tree.chat_messages[0],
    parent_message_uuid: NEXT,
    sender: "human",
  };
  human.content = [{ text: "private-answer", type: "text" }];
  const answered = tree(replyId, "Renamed");
  const humanState = {
    ...question,
    tree: {
      ...question.tree,
      chat_messages: [...question.tree.chat_messages, human],
      current_leaf_message_uuid: humanId,
    },
  };
  batches.push(batch(4, [{ value: value(humanState) }]));
  await save();
  assert.equal((await poll()).delivered, 0);
  assert.equal(
    (await history()).at(-1)?.type,
    "waiting",
    "No instant answer/resume event is claimed.",
  );
  answered.tree.chat_messages.unshift(...question.tree.chat_messages, human);
  batches.push(batch(5, [{ value: value(answered) }]));
  await save();
  assert.equal((await poll()).delivered, 1);
  assert.equal(
    (await history()).at(-1)?.type,
    "ready",
    "Old questions in history must not keep the new reply waiting.",
  );

  // Later cache enrichment can add a question to an already observed response.
  batches.push(batch(6, [{ value: value(questionTree(replyId, "Renamed")) }]));
  await save();
  assert.equal((await poll()).delivered, 1);
  batches.push(batch(7, [{ value: value(tree(replyId, "Renamed")) }]));
  await save();
  assert.equal(
    (await poll()).delivered,
    0,
    "A partial rewrite cannot downgrade the same question message to ready.",
  );
  batches.push(
    batch(8, [
      { value: value(tree("66666666-6666-4666-8666-666666666666", "Renamed")) },
    ]),
  );
  await save();
  assert.equal((await poll()).delivered, 1);
  assert.deepEqual(
    (await history()).map((e) => e.type),
    ["waiting", "ready", "waiting", "ready"],
  );
});

test("Desktop watcher CLI --once baselines an isolated cache without posting or exposing content", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "harbor-desktop-cli-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  await writeFile(
    join(directory, "000001.log"),
    log([batch(1, [{ value: value(tree()) }])]),
  );
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "scripts/watch-claude-desktop.ts", "--once"],
    {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      env: {
        ...process.env,
        CLAUDE_DESKTOP_CACHE_DIR: directory,
        HARBOR_PORT: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const [code] = await once(child, "close");
  assert.equal(code, 0, output);
  assert.match(output, /baseline loaded \(1/);
  assert.doesNotMatch(output, /private-|11111111|Harbor check|delivery failed/);
  assert.deepEqual(
    (await readDesktopSnapshot(directory)).observations[0].event.sessionId,
    ID,
  );
});
