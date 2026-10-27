import type { TelemetryPeriod } from "../src/telemetryData.ts";

export function periodFrom(
  url: URL,
  fallback: TelemetryPeriod = 30,
): TelemetryPeriod | null {
  const raw = url.searchParams.get("days") || String(fallback);
  if (raw === "all") return "all";
  if (["1", "2", "7", "30", "90"].includes(raw))
    return Number(raw) as 1 | 2 | 7 | 30 | 90;
  if (raw !== "custom") return null;
  const startText = url.searchParams.get("start"),
    endText = url.searchParams.get("end");
  if (
    !startText ||
    !endText ||
    !/^\d+$/.test(startText) ||
    !/^\d+$/.test(endText)
  )
    return null;
  const start = Number(startText),
    end = Number(endText);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end <= start
  )
    return null;
  return { start, end };
}
