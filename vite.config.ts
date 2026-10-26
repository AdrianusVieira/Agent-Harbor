import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { claudeDesktopObserver } from "./scripts/claude-desktop-plugin.ts";
import { localNetworkUrls } from "./server/network-urls.ts";
import { createReceiver } from "./server/receiver.ts";

export default defineConfig({
  plugins: [
    react(),
    claudeDesktopObserver(),
    {
      name: "harbor-local-receiver",
      configureServer(server) {
        const receiver = createReceiver(() =>
          localNetworkUrls(server.httpServer?.address() ?? null),
        );
        server.middlewares.use((req, res, next) => {
          void receiver
            .handle(req, res)
            .then((handled) => {
              if (!handled) next();
            })
            .catch(next);
        });
        server.httpServer?.once("close", receiver.close);
      },
    },
  ],
  server: { port: 5173 },
});
