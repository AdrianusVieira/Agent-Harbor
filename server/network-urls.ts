import { networkInterfaces } from "node:os";
import type { AddressInfo } from "node:net";

// Advertise private IPv4 interfaces covered by the actual listening socket.
export function localNetworkUrls(
  listener: AddressInfo | string | null,
  interfaces = networkInterfaces(),
): string[] {
  if (!listener || typeof listener === "string") return [];
  const addresses = Object.values(interfaces)
    .flatMap((entries) => entries ?? [])
    .filter((entry) => {
      if (entry.internal || entry.family !== "IPv4") return false;
      const [first, second] = entry.address.split(".").map(Number);
      const privateAddress =
        first === 10 ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 168);
      return privateAddress &&
        (listener.address === "0.0.0.0" || listener.address === entry.address);
    })
    .map((entry) => `http://${entry.address}:${listener.port}/`);
  return [...new Set(addresses)].sort();
}
