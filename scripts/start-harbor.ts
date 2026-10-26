import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { assertReceiverPortAvailable } from "../server/startup.ts";

let server: Awaited<ReturnType<typeof createServer>> | undefined;
try {
  const root = fileURLToPath(new URL("../", import.meta.url));
  await assertReceiverPortAvailable(5173);
  server = await createServer({
    root,
    configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
    server: {
      host: process.argv.includes("--lan") ? "0.0.0.0" : "127.0.0.1",
      port: 5173,
      strictPort: true,
    },
  });
  await server.listen();
  server.printUrls();
  server.bindCLIShortcuts({ print: true });
} catch (error) {
  await server?.close();
  console.error(error instanceof Error ? error.message : "Harbor could not start.");
  process.exitCode = 1;
}
