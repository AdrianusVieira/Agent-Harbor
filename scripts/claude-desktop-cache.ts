import { open, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { EventInput } from "../src/events.ts";

const BLOCK_BYTES = 32_768;
const MAX_FILE_BYTES = 8_388_608;
const MAX_TOTAL_BYTES = 33_554_432;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class Reader {
  position = 0;

  constructor(readonly data: Buffer) {}

  bytes(length: number) {
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      this.position + length > this.data.length
    ) {
      throw new Error("Incomplete cache record.");
    }
    const result = this.data.subarray(this.position, this.position + length);
    this.position += length;
    return result;
  }

  byte() {
    return this.bytes(1)[0];
  }

  integer() {
    let value = 0;
    for (let shift = 0; shift <= 49; shift += 7) {
      const byte = this.byte();
      value += (byte & 127) * 2 ** shift;
      if (!Number.isSafeInteger(value)) break;
      if (!(byte & 128)) return value;
    }
    throw new Error("Unsupported cache integer.");
  }
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) {
    value = (value >>> 1) ^ (value & 1 ? 0x82f63b78 : 0);
  }
  return value >>> 0;
});

function checksum(data: Buffer) {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  crc = (crc ^ 0xffffffff) >>> 0;
  return (((crc >>> 15) | (crc << 17)) + 0xa282ead8) >>> 0;
}

interface CacheWrite {
  key: Buffer;
  sequence: bigint;
  value?: Buffer;
}

// Read WAL bytes, never open LevelDB itself (which could lock or modify it).
// Format: https://github.com/google/leveldb/blob/main/doc/log_format.md
export function readCacheWrites(data: Buffer): CacheWrite[] {
  if (data.length > MAX_FILE_BYTES) throw new Error("Cache log exceeds limit.");
  const writes: CacheWrite[] = [];
  let fragments: Buffer[] | undefined;

  function batch(data: Buffer) {
    const reader = new Reader(data);
    const sequence = reader.bytes(8).readBigUInt64LE();
    const count = reader.bytes(4).readUInt32LE();
    if (count > data.length / 2) throw new Error("Invalid cache batch size.");
    const pending: CacheWrite[] = [];
    for (let index = 0; index < count; index++) {
      const kind = reader.byte();
      if (kind !== 0 && kind !== 1) throw new Error("Unsupported cache write.");
      const key = reader.bytes(reader.integer());
      const value = kind === 1 ? reader.bytes(reader.integer()) : undefined;
      pending.push({ key, sequence: sequence + BigInt(index), value });
    }
    if (reader.position !== data.length)
      throw new Error("Invalid cache batch.");
    for (const write of pending) writes.push(write);
  }

  for (let block = 0; block < data.length; block += BLOCK_BYTES) {
    const end = Math.min(block + BLOCK_BYTES, data.length);
    let position = block;
    while (position + 7 <= end) {
      const header = data.subarray(position, position + 7);
      const length = header.readUInt16LE(4);
      const kind = header[6];
      if (!length && !kind && !header.readUInt32LE()) break;
      const next = position + 7 + length;
      if (next > block + BLOCK_BYTES)
        throw new Error("Invalid cache fragment.");
      // Claude may still be appending the last physical/logical record.
      if (next > data.length) return writes;
      const payload = data.subarray(position + 7, next);
      if (
        checksum(data.subarray(position + 6, next)) !== header.readUInt32LE()
      ) {
        throw new Error("Cache checksum mismatch.");
      }
      if (kind === 1) {
        if (fragments) throw new Error("Incomplete cache fragments.");
        batch(payload);
      } else if (kind === 2) {
        if (fragments) throw new Error("Incomplete cache fragments.");
        fragments = [payload];
      } else if ((kind === 3 || kind === 4) && fragments) {
        fragments.push(payload);
        if (kind === 4) {
          batch(Buffer.concat(fragments));
          fragments = undefined;
        }
      } else {
        throw new Error("Unsupported cache fragment.");
      }
      position = next;
    }
  }
  return writes;
}

function conversationKey(key: Buffer) {
  const reader = new Reader(key);
  const prefix = reader.byte();
  const database = reader.bytes((prefix >>> 5) + 1);
  const store = reader.bytes(((prefix >>> 2) & 7) + 1);
  const index = reader.bytes((prefix & 3) + 1);
  if (
    !database.some(Boolean) ||
    !store.some(Boolean) ||
    index[0] !== 1 ||
    index.subarray(1).some(Boolean)
  )
    return;
  if (reader.byte() !== 1) return;
  const length = reader.integer();
  if (length !== 36) return;
  const id = Buffer.from(reader.bytes(length * 2))
    .swap16()
    .toString("utf16le");
  if (reader.position === key.length && UUID.test(id)) return id;
}

// A deliberately restricted structured-clone reader: objects, arrays, maps,
// sets, references, and scalars. No V8 version rewriting, host objects,
// executable code, external blobs, ArrayBuffers, or general database support.
// Tags: https://github.com/v8/v8/blob/main/src/objects/value-serializer.cc
function plainValue(reader: Reader): unknown {
  const objects: unknown[] = [];
  let remaining = 500_000;

  function tag() {
    while (reader.data[reader.position] === 0) reader.byte();
    return reader.data[reader.position];
  }

  function properties(
    target: Record<string, unknown> | unknown[],
    end: number,
    depth: number,
  ) {
    let count = 0;
    while (tag() !== end) {
      const key = value(depth + 1);
      if (typeof key !== "string" && typeof key !== "number")
        throw new Error("Unsupported cache property.");
      const item = value(depth + 1);
      Object.defineProperty(target, String(key), {
        configurable: true,
        enumerable: true,
        value: item,
        writable: true,
      });
      count++;
    }
    reader.byte();
    if (reader.integer() !== count)
      throw new Error("Invalid cache property count.");
  }

  function value(depth: number): unknown {
    if (depth > 64 || --remaining < 0)
      throw new Error("Cache value exceeds limit.");
    tag();
    const kind = reader.byte();
    switch (kind) {
      case 45: // hole
      case 95:
        return undefined;
      case 48:
        return null;
      case 84:
        return true;
      case 70:
        return false;
      case 73: {
        const number = reader.integer();
        if (number > 0xffffffff) throw new Error("Invalid cache integer.");
        return (number >>> 1) ^ -(number & 1);
      }
      case 85: {
        const number = reader.integer();
        if (number > 0xffffffff) throw new Error("Invalid cache integer.");
        return number;
      }
      case 78:
        return reader.bytes(8).readDoubleLE();
      case 34:
        return reader.bytes(reader.integer()).toString("latin1");
      case 83:
        return new TextDecoder("utf8", { fatal: true }).decode(
          reader.bytes(reader.integer()),
        );
      case 99: {
        const bytes = reader.bytes(reader.integer());
        if (bytes.length % 2) throw new Error("Invalid cache string.");
        return bytes.toString("utf16le");
      }
      case 94: {
        const id = reader.integer();
        if (id >= objects.length) throw new Error("Invalid cache reference.");
        return objects[id];
      }
      case 59: {
        const map = new Map<unknown, unknown>();
        objects.push(map);
        let count = 0;
        while (tag() !== 58) {
          const key = value(depth + 1);
          map.set(key, value(depth + 1));
          count += 2;
        }
        reader.byte();
        if (reader.integer() !== count) throw new Error("Invalid cache map.");
        return map;
      }
      case 39: {
        const set = new Set<unknown>();
        objects.push(set);
        let count = 0;
        while (tag() !== 44) {
          set.add(value(depth + 1));
          count++;
        }
        reader.byte();
        if (reader.integer() !== count) throw new Error("Invalid cache set.");
        return set;
      }
      case 111: {
        const object: Record<string, unknown> = Object.create(null);
        objects.push(object);
        properties(object, 123, depth);
        return object;
      }
      case 65:
      case 97: {
        const length = reader.integer();
        if (length > 100_000 || length > reader.data.length)
          throw new Error("Cache array exceeds limit.");
        const array: unknown[] = new Array(length);
        objects.push(array);
        if (kind === 65) {
          for (let i = 0; i < length; i++) array[i] = value(depth + 1);
        }
        properties(array, kind === 65 ? 36 : 64, depth);
        if (reader.integer() !== length || array.length !== length)
          throw new Error("Invalid cache array.");
        return array;
      }
      default:
        throw new Error(`Unsupported cache value tag ${kind}.`);
    }
  }

  const result = value(0);
  tag();
  if (reader.position !== reader.data.length)
    throw new Error("Unexpected cache trailer.");
  return result;
}

export function decodeCacheValue(data: Buffer) {
  const reader = new Reader(data);
  reader.integer(); // IndexedDB record version, unrelated to serialization.
  if (reader.byte() !== 255 || reader.integer() !== 21 || reader.byte() !== 254)
    throw new Error("Unsupported Blink cache version.");
  // Blink 21's trailer offset and size; external-object trailers are unsupported.
  if (reader.bytes(12).some(Boolean))
    throw new Error("Unsupported Blink cache trailer.");
  if (reader.byte() !== 255 || ![15, 16].includes(reader.integer()))
    throw new Error("Unsupported V8 cache version.");
  return plainValue(reader);
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export interface DesktopObservation {
  event: EventInput & { type: "ready" | "waiting" };
  messageAt: number;
  messageId: string;
  sequence: bigint;
}

function observation(
  value: unknown,
  sessionId: string,
  sequence: bigint,
): DesktopObservation | undefined {
  if (
    !object(value) ||
    value.product !== "chat" ||
    value.conversationUuid !== sessionId ||
    !object(value.tree)
  )
    return;
  const tree = value.tree;
  if (
    tree.uuid !== sessionId ||
    !Array.isArray(tree.chat_messages) ||
    typeof tree.current_leaf_message_uuid !== "string" ||
    !UUID.test(tree.current_leaf_message_uuid)
  )
    return;
  const leaf = tree.chat_messages.find(
    (message: unknown) =>
      object(message) && message.uuid === tree.current_leaf_message_uuid,
  );
  if (
    !object(leaf) ||
    leaf.sender !== "assistant" ||
    leaf.stop_reason !== "end_turn"
  )
    return;
  // Fresh cache entries can omit updated_at. This timestamp is only a guard
  // against late-loaded history; end_turn is the evidence of completion.
  const timestamp = leaf.updated_at ?? leaf.created_at;
  const messageAt = typeof timestamp === "string" ? Date.parse(timestamp) : NaN;
  if (!Number.isFinite(messageAt)) return;
  const sessionName =
    typeof tree.name === "string" && tree.name.trim() && tree.name.length <= 200
      ? tree.name.trim()
      : undefined;
  const content = Array.isArray(leaf.content) ? leaf.content : [];
  // Report an observed structured question, not an inferred permission gate.
  // The result must confirm success; an attempted/failed call isn't enough.
  const askedForInput = content.some((call: unknown) => {
    if (
      !object(call) ||
      call.type !== "tool_use" ||
      call.name !== "ask_user_input_v0" ||
      typeof call.id !== "string" ||
      !call.id.trim() ||
      !object(call.input) ||
      !Array.isArray(call.input.questions) ||
      !call.input.questions.length ||
      !call.input.questions.every(
        (question: unknown) =>
          object(question) &&
          typeof question.question === "string" &&
          !!question.question.trim(),
      )
    )
      return false;
    return content.some(
      (result: unknown) =>
        object(result) &&
        result.type === "tool_result" &&
        result.tool_use_id === call.id &&
        result.is_error === false,
    );
  });
  return {
    event: {
      message: askedForInput
        ? "Claude Desktop asked for input."
        : "Claude Desktop finished its response.",
      sessionId,
      ...(sessionName ? { sessionName } : {}),
      source: "claude-desktop",
      type: askedForInput ? "waiting" : "ready",
    },
    messageAt,
    messageId: tree.current_leaf_message_uuid,
    sequence,
  };
}

export async function readDesktopSnapshot(directory: string) {
  const names = (await readdir(directory))
    .filter((name) => /^\d+\.log$/.test(name))
    .sort();
  if (!names.length || names.length > 32)
    throw new Error("Cache logs unavailable or exceed limit.");
  const latest = new Map<string, CacheWrite>();
  let bytes = 0;
  let firstSequence: bigint | undefined;
  let lastSequence = 0n;

  for (const name of names) {
    const file = await open(join(directory, name), "r");
    try {
      const info = await file.stat();
      bytes += info.size;
      if (
        !info.isFile() ||
        info.size > MAX_FILE_BYTES ||
        bytes > MAX_TOTAL_BYTES
      )
        throw new Error("Cache log exceeds limit.");
      const data = Buffer.alloc(info.size);
      let offset = 0;
      while (offset < data.length) {
        const { bytesRead } = await file.read(
          data,
          offset,
          data.length - offset,
          offset,
        );
        if (!bytesRead) break;
        offset += bytesRead;
      }
      for (const write of readCacheWrites(data.subarray(0, offset))) {
        firstSequence =
          firstSequence === undefined || write.sequence < firstSequence
            ? write.sequence
            : firstSequence;
        if (write.sequence > lastSequence) lastSequence = write.sequence;
        let id: string | undefined;
        try {
          id = conversationKey(write.key);
        } catch {
          continue;
        }
        if (!id) continue;
        const key = write.key.toString("hex");
        const previous = latest.get(key);
        if (!previous || write.sequence > previous.sequence)
          latest.set(key, write);
      }
    } finally {
      await file.close();
    }
  }

  const observations: DesktopObservation[] = [];
  let skipped = 0;
  for (const write of latest.values()) {
    if (!write.value) continue;
    try {
      const result = observation(
        decodeCacheValue(write.value),
        conversationKey(write.key)!,
        write.sequence,
      );
      if (result) observations.push(result);
    } catch {
      // No raw values or decoder errors leave this reader.
      skipped++;
    }
  }
  observations.sort((a, b) =>
    a.sequence < b.sequence ? -1 : a.sequence > b.sequence ? 1 : 0,
  );
  return { firstSequence, lastSequence, observations, skipped };
}
