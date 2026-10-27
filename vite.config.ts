import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { claudeDesktopObserver } from "./scripts/claude-desktop-plugin.ts";
import { harborBackend } from "./scripts/telemetry-plugin.ts";

export default defineConfig({
  plugins: [react(), harborBackend(), claudeDesktopObserver()],
  server: { port: 5173 },
});
