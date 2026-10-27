import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertReceiverPortAvailable } from "../server/startup.ts";
import { mergeTelemetryHistory } from "../server/telemetryImport.ts";
import { openTelemetryStores } from "../server/telemetryStore.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = resolve(process.env.HARBOR_DATA_DIR ?? join(root, "data"));
try {
  // Import is an explicit offline operation. Do not mutate a running collector's store.
  await assertReceiverPortAvailable(5173);
  const stores = openTelemetryStores(directory);
  stores.claude.close();
  stores.codex.close();
  for (const source of ["claude", "codex"] as const) {
    const paths = [
      join(root, "..", "minecode", "data", `${source}.sqlite3`),
      join(
        root,
        "..",
        `${source === "claude" ? "claude-code" : "codex"}-telemetry-dashboard`,
        "data",
        "telemetry.sqlite3",
      ),
    ];
    for (const [index, path] of paths.entries()) {
      const result = await mergeTelemetryHistory(
        source,
        path,
        join(directory, `${source}.sqlite3`),
      );
      console.log(
        `${source} · ${index === 0 ? "Minecode" : "standalone dashboard"}: ${result.skipped ? "no import needed" : `${result.inserted} new records merged`}.`,
      );
    }
  }
  console.log("History import complete. Original databases were preserved.");
} catch {
  console.error(
    "History import stopped. Stop Harbor before importing and check that the source databases are compatible. Originals were preserved.",
  );
  process.exitCode = 1;
}
