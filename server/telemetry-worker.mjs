// Register TypeScript inside this worker; no detached process or inherited CLI
// loader behavior is required. This file is not part of the browser bundle.
import { register } from "tsx/esm/api";
register();
await import("./telemetryWorker.ts");
