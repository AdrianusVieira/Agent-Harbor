import assert from "node:assert/strict";
import { test } from "node:test";
import type { NetworkInterfaceInfo } from "node:os";
import { localNetworkUrls } from "./network-urls.ts";

const entry = (address: string, internal = false): NetworkInterfaceInfo => ({
  address,
  cidr: `${address}/24`,
  family: "IPv4",
  internal,
  mac: "00:00:00:00:00:00",
  netmask: "255.255.255.0",
});

test("network URLs follow the listening address, current private interfaces, and actual port", () => {
  const listener = { address: "0.0.0.0", family: "IPv4", port: 5173 };
  const interfaces = {
    lo0: [entry("127.0.0.1", true)],
    en0: [entry("192.168.1.20")],
    en1: [entry("10.0.0.2"), entry("10.0.0.2")],
    other: [entry("172.16.0.2"), entry("172.31.0.2"), entry("172.32.0.2"), entry("8.8.8.8")],
    ipv6: [{ ...entry("fe80::1"), family: "IPv6", scopeid: 1 } as NetworkInterfaceInfo],
  };
  assert.deepEqual(localNetworkUrls(listener, interfaces), [
    "http://10.0.0.2:5173/", "http://172.16.0.2:5173/",
    "http://172.31.0.2:5173/", "http://192.168.1.20:5173/",
  ]);
  for (const address of ["127.0.0.1", "::1"]) {
    assert.deepEqual(localNetworkUrls({ ...listener, address }, interfaces), []);
  }
  assert.deepEqual(localNetworkUrls(null, interfaces), []);
  assert.deepEqual(localNetworkUrls("/tmp/harbor.sock", interfaces), []);
  assert.deepEqual(localNetworkUrls({ ...listener, address: "192.168.1.20", port: 6000 }, interfaces), ["http://192.168.1.20:6000/"]);
  assert.deepEqual(localNetworkUrls(listener, { en0: [entry("192.168.1.30")] }), ["http://192.168.1.30:5173/"]);
});
