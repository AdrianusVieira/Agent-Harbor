import type { Plugin } from "vite";
import { runDesktopWatcher } from "./watch-claude-desktop.ts";

// Share Vite's lifetime, including config restarts, without a detached process.
export function claudeDesktopObserver(): Plugin {
  let controller: AbortController | undefined;
  let running: Promise<void> | undefined;

  return {
    name: "harbor-claude-desktop-observer",
    apply: "serve",
    configureServer(server) {
      if (process.platform !== "darwin") return;
      server.httpServer?.once("listening", () => {
        const address = server.httpServer?.address();
        if (!address || typeof address === "string") return;
        controller = new AbortController();
        running = runDesktopWatcher({
          logger: {
            error: (message: string) => server.config.logger.warn(message),
            log: (message: string) => server.config.logger.info(message),
          },
          port: address.port,
          signal: controller.signal,
        }).catch(() => {
          server.config.logger.error(
            "Agent Harbor: Desktop observer stopped unexpectedly. Restart Harbor to resume monitoring.",
          );
        });
      });
      server.httpServer?.once("close", () => controller?.abort());
    },
    async closeBundle() {
      controller?.abort();
      await running;
    },
  };
}
