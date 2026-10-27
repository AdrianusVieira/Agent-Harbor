import { fileURLToPath } from "node:url";
import { AuthStore } from "../server/authStore.ts";

const directory =
  process.env.HARBOR_DATA_DIR ??
  fileURLToPath(new URL("../data/", import.meta.url));
const store = new AuthStore(directory);
try {
  store.reset();
  console.log(
    "Harbor login reset. Open http://127.0.0.1:5173 to create a new login. Telemetry and signal history were preserved.",
  );
} finally {
  store.close();
}
