import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { BrowserAuth } from "../server/auth.ts";
import { createReceiver } from "../server/receiver.ts";
import { localNetworkUrls } from "../server/network-urls.ts";
import { TelemetryQueries } from "../server/telemetryQueries.ts";
import { SignalStore } from "../server/signalStore.ts";
import { createTelemetryApi } from "../server/telemetryApi.ts";
import {
  closeTelemetryReceivers,
  startTelemetryReceivers,
} from "../server/telemetryReceiver.ts";
import { openTelemetryStores } from "../server/telemetryStore.ts";

// Resources start at listen, not configure: Vite can prepare a replacement
// configuration before closing the old server during a restart.
export function harborBackend(
  options: {
    directory?: string;
    ports?: { claude: number; codex: number };
  } = {},
): Plugin & { api: { ready(): Promise<void> } } {
  const active = new Set<() => Promise<void>>();
  let readiness = Promise.resolve();
  return {
    name: "harbor-backend",
    apply: "serve",
    api: { ready: () => readiness },
    config() {
      return {
        server: {
          fs: {
            deny: [
              ".env",
              ".env.*",
              "*.{crt,pem}",
              "**/.git/**",
              "**/data/**",
              "**/*.sqlite*",
              "**/*.db",
            ],
          },
        },
      };
    },
    configureServer(server) {
      const directory =
        options.directory ??
        process.env.HARBOR_DATA_DIR ??
        fileURLToPath(new URL("../data/", import.meta.url));
      let resolveReady!: () => void, rejectReady!: (reason: unknown) => void;
      const ready = new Promise<void>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
      });
      readiness = ready;
      void ready.catch(() => {});
      let stores: ReturnType<typeof openTelemetryStores> | undefined;
      let auth: BrowserAuth | undefined;
      let signals: SignalStore | undefined;
      let queries: TelemetryQueries | undefined;
      let receivers: Awaited<ReturnType<typeof startTelemetryReceivers>> = [];
      let receiver: ReturnType<typeof createReceiver> | undefined;
      let telemetry: ReturnType<typeof createTelemetryApi> | undefined;
      let starting: Promise<void> | undefined;
      let closing: Promise<void> | undefined;
      let closed = false;
      const close = () =>
        (closing ??= (async () => {
          closed = true;
          await starting;
          receiver?.close();
          await auth?.close();
          await closeTelemetryReceivers(receivers);
          await queries?.close();
          signals?.close();
          stores?.claude.close();
          stores?.codex.close();
          active.delete(close);
        })());
      server.middlewares.use((req, res, next) => {
        void ready
          .then(async () => {
            if (closed) {
              res.writeHead(503);
              res.end();
              return;
            }
            res.setHeader("X-Frame-Options", "DENY");
            if (await auth!.protect(req, res)) return;
            if (await telemetry!(req, res)) return;
            return receiver!.handle(req, res).then((handled) => {
              if (!handled) next();
            });
          })
          .catch(() => {
            if (!res.headersSent) res.writeHead(503);
            res.end();
          });
      });
      server.httpServer?.once("listening", () => {
        active.add(close);
        starting = (async () => {
          try {
            stores = openTelemetryStores(directory);
            signals = new SignalStore(directory);
            auth = new BrowserAuth(directory);
            receiver = createReceiver(
              () => localNetworkUrls(server.httpServer?.address() ?? null),
              signals,
              (req) => auth!.authenticated(req),
            );
            queries = new TelemetryQueries(directory);
            await queries.ready;
            telemetry = createTelemetryApi(queries, signals, (req) =>
              auth!.authenticated(req),
            );
            receivers = await startTelemetryReceivers(
              stores,
              options.ports,
              () => queries?.invalidate(),
            );
            if (closed) {
              rejectReady(new Error("Harbor closed during startup."));
              return;
            }
            const ports = receivers
              .map((item) => item.address())
              .map((address) =>
                address && typeof address !== "string" ? address.port : "?",
              );
            server.config.logger.info(
              `Harbor telemetry: Claude 127.0.0.1:${ports[0]} · Codex 127.0.0.1:${ports[1]} (HTTP/JSON)`,
            );
            resolveReady();
          } catch (error) {
            rejectReady(error);
            server.config.logger.error(
              error instanceof Error
                ? error.message
                : "Harbor telemetry could not start.",
            );
            queueMicrotask(() => {
              void server.close();
            });
          }
        })();
      });
      server.httpServer?.once("close", () => {
        void close();
      });
    },
    async closeBundle() {
      await Promise.all([...active].map((close) => close()));
    },
  };
}
