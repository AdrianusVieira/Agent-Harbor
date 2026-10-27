import { useEffect, useRef, useState, type ReactNode } from "react";
import { appRouteHash, telemetryPageFor, type AppRoute } from "./app-route.ts";
import type { Connection } from "./harbor-stream.ts";
import { useBrowserAuth } from "./AuthGate.tsx";

export const navigationGroups: {
  label: string;
  items: { label: string; route: AppRoute }[];
}[] = [
  {
    label: "Harbor",
    items: [
      { label: "Dashboard", route: { page: "harbor" } },
      { label: "Signal History", route: { page: "history" } },
      { label: "Notification Settings", route: { page: "settings" } },
    ],
  },
  {
    label: "Telemetry",
    items: [
      {
        label: "Dashboard",
        route: { page: "telemetry", telemetryPage: "dashboard" },
      },
      {
        label: "Sessions",
        route: { page: "telemetry", telemetryPage: "sessions" },
      },
      {
        label: "Accounts",
        route: { page: "telemetry", telemetryPage: "accounts" },
      },
    ],
  },
];

export function navigationItemActive(current: AppRoute, item: AppRoute) {
  return (
    current.page === item.page &&
    (item.page !== "telemetry" ||
      telemetryPageFor(current) === telemetryPageFor(item))
  );
}

export function AppShell({
  children,
  connection,
  mark,
  onNavigate,
  route,
}: {
  children: ReactNode;
  connection: Connection;
  mark: ReactNode;
  onNavigate(route: AppRoute): void;
  route: AppRoute;
}) {
  const auth = useBrowserAuth();
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      return localStorage.getItem("harbor.sidebar-open") !== "false";
    } catch {
      return true;
    }
  });
  const firstLink = useRef<HTMLAnchorElement>(null);
  const showButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    try {
      localStorage.setItem("harbor.sidebar-open", String(sidebarOpen));
    } catch {
      /* Optional display preference. */
    }
  }, [sidebarOpen]);
  function toggleSidebar() {
    setSidebarOpen((open) => !open);
    requestAnimationFrame(() => {
      if (sidebarOpen) showButton.current?.focus();
      else firstLink.current?.focus();
    });
  }
  return (
    <div className="app-layout">
      <a
        href="#page-title"
        className="skip-link"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("page-title")?.focus();
        }}
      >
        Skip to page
      </a>
      {sidebarOpen && (
        <aside className="app-sidebar" aria-label="Workspace sidebar">
          <button
            className="brand sidebar-brand"
            onClick={() => onNavigate({ page: "harbor" })}
            aria-label="Agent Harbor home"
          >
            <span className="brand-emblem">{mark}</span>
            <span>
              Agent Harbor
              <span className="brand-caption">signals & usage, locally</span>
            </span>
          </button>
          <nav aria-label="Primary navigation">
            {navigationGroups.map((group, groupIndex) => (
              <section
                className="sidebar-nav-group"
                key={group.label}
                aria-label={group.label}
              >
                <h2 className="sidebar-group-label">{group.label}</h2>
                <div className="sidebar-group-links">
                  {group.items.map((item, index) => {
                    const destination: AppRoute =
                      item.route.page === "telemetry" &&
                      item.route.telemetryPage !== "accounts"
                        ? {
                            ...item.route,
                            ...(route.usageTarget?.source ||
                            route.telemetrySource
                              ? {
                                  telemetrySource:
                                    route.usageTarget?.source ??
                                    route.telemetrySource,
                                }
                              : {}),
                          }
                        : item.route;
                    return (
                      <a
                        key={item.label}
                        ref={
                          groupIndex === 0 && index === 0
                            ? firstLink
                            : undefined
                        }
                        href={appRouteHash(destination)}
                        aria-current={
                          navigationItemActive(route, item.route)
                            ? "page"
                            : undefined
                        }
                        className="sidebar-page"
                        onClick={(event) => {
                          if (
                            event.metaKey ||
                            event.ctrlKey ||
                            event.shiftKey ||
                            event.altKey
                          )
                            return;
                          event.preventDefault();
                          onNavigate(destination);
                        }}
                      >
                        {item.label}
                      </a>
                    );
                  })}
                </div>
              </section>
            ))}
          </nav>
          <div className="sidebar-footer">
            {auth && (
              <>
                <span className="signed-in-user">
                  Signed in · {auth.username}
                </span>
                <button
                  className="sidebar-toggle"
                  onClick={() => void auth.logout()}
                >
                  Sign out
                </button>
                {auth.logoutError && <p role="alert">{auth.logoutError}</p>}
              </>
            )}
            <span className="sidebar-status">
              <i className={`connection-dot ${connection}`} />
              {connection === "connected"
                ? "Local receiver connected"
                : connection === "connecting"
                  ? "Connecting…"
                  : "Receiver offline"}
            </span>
            <p>History stays on this computer.</p>
            <button
              className="sidebar-toggle"
              onClick={toggleSidebar}
              aria-expanded="true"
            >
              ◧ Hide sidebar
            </button>
            <span className="version">AGENT HARBOR / LOCAL</span>
          </div>
        </aside>
      )}
      <div className="page-area">
        <div className="page-topbar">
          {!sidebarOpen && auth && (
            <button
              className="sidebar-toggle"
              onClick={() => void auth.logout()}
            >
              Sign out
            </button>
          )}
          {!sidebarOpen && (
            <button
              ref={showButton}
              className="sidebar-toggle"
              onClick={toggleSidebar}
              aria-expanded="false"
            >
              ☰ Show sidebar
            </button>
          )}
          <span>
            {route.page === "telemetry" ? "Telemetry" : "Harbor"}
            <span aria-hidden="true">/</span>{" "}
            {
              navigationGroups
                .flatMap((group) => group.items)
                .find((item) => navigationItemActive(route, item.route))?.label
            }
            {route.usageTarget && (
              <>
                {" "}
                <span aria-hidden="true">/</span> Session
              </>
            )}
          </span>
          {!sidebarOpen && auth?.logoutError && (
            <p role="alert">{auth.logoutError}</p>
          )}
          <span className="page-topbar-note">LOCAL FIRST</span>
        </div>
        <div className="app-shell">{children}</div>
      </div>
    </div>
  );
}
