export type AppPage = "harbor" | "telemetry" | "history" | "settings";
export type TelemetryPage = "dashboard" | "sessions" | "accounts";
export type AppRoute = {
  page: AppPage;
  sessionKey?: string;
  usageTarget?: { source: "claude" | "codex"; id: string };
  telemetrySource?: "claude" | "codex";
  telemetryPage?: TelemetryPage;
};

export function telemetryPageFor(route: AppRoute): TelemetryPage {
  return route.telemetryPage ?? (route.usageTarget ? "sessions" : "dashboard");
}

export function parseAppRoute(hash: string): AppRoute {
  try {
    const parts = hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
    if (parts[0] === "signals" && parts.length === 1)
      return { page: "history" };
    if (parts[0] === "settings" && parts.length === 1)
      return { page: "settings" };
    if (parts[0] === "telemetry") {
      if (["dashboard", "sessions", "accounts"].includes(parts[1])) {
        const telemetryPage = parts[1] as TelemetryPage;
        if (parts.length === 2) return { page: "telemetry", telemetryPage };
        if (
          ["claude", "codex"].includes(parts[2]) &&
          telemetryPage !== "accounts"
        ) {
          if (parts.length === 3)
            return {
              page: "telemetry",
              telemetryPage,
              telemetrySource: parts[2] as "claude" | "codex",
            };
          if (
            parts.length === 4 &&
            telemetryPage === "sessions" &&
            parts[3] &&
            parts[3].length <= 200
          )
            return {
              page: "telemetry",
              telemetryPage,
              usageTarget: {
                source: parts[2] as "claude" | "codex",
                id: parts[3],
              },
            };
        }
        return { page: "harbor" };
      }
      if (parts.length === 1) return { page: "telemetry" };
      if (parts.length === 2 && ["claude", "codex"].includes(parts[1]))
        return {
          page: "telemetry",
          telemetrySource: parts[1] as "claude" | "codex",
        };
      if (
        parts.length === 3 &&
        ["claude", "codex"].includes(parts[1]) &&
        parts[2] &&
        parts[2].length <= 200
      )
        return {
          page: "telemetry",
          usageTarget: { source: parts[1] as "claude" | "codex", id: parts[2] },
        };
    }
    if (parts[0] === "harbor") {
      if (parts[1] === "dashboard" && parts.length === 2)
        return { page: "harbor" };
      if (parts[1] === "signals" && parts.length === 2)
        return { page: "history" };
      if (parts[1] === "notifications" && parts.length === 2)
        return { page: "settings" };
      if (parts[1] === "log" && parts.length === 2)
        return { page: "harbor", sessionKey: "*" };
      if (
        parts[1] === "session" &&
        parts.length === 4 &&
        parts[2] &&
        parts[2].length <= 60 &&
        parts[3] &&
        parts[3].length <= 120
      )
        return {
          page: "harbor",
          sessionKey: JSON.stringify([parts[2], parts[3]]),
        };
    }
  } catch {
    /* A malformed bookmarked URL must not break monitoring. */
  }
  return { page: "harbor" };
}

export function appRouteHash(route: AppRoute) {
  if (route.page === "history") return "#/harbor/signals";
  if (route.page === "settings") return "#/harbor/notifications";
  if (route.page === "telemetry" && route.telemetryPage) {
    const base = `#/telemetry/${route.telemetryPage}`;
    if (route.telemetryPage === "accounts") return base;
    return route.usageTarget
      ? `${base}/${route.usageTarget.source}/${encodeURIComponent(route.usageTarget.id)}`
      : route.telemetrySource
        ? `${base}/${route.telemetrySource}`
        : base;
  }
  if (route.page === "telemetry")
    return route.usageTarget
      ? `#/telemetry/${route.usageTarget.source}/${encodeURIComponent(route.usageTarget.id)}`
      : route.telemetrySource
        ? `#/telemetry/${route.telemetrySource}`
        : "#/telemetry";
  if (route.sessionKey === "*") return "#/harbor/log";
  if (route.sessionKey) {
    const [source, id] = JSON.parse(route.sessionKey) as [string, string];
    return `#/harbor/session/${encodeURIComponent(source)}/${encodeURIComponent(id)}`;
  }
  return "#/harbor/dashboard";
}
