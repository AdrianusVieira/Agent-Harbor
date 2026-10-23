import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createReceiver } from "./server/receiver.ts";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "harbor-local-receiver",
      configureServer(server) {
        const receiver = createReceiver();
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
