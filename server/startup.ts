import { createConnection } from "node:net";

// Some systems allow wildcard and specific-address listeners on the same port.
// Vite's strictPort check alone then permits two independent Harbor receivers.
export async function assertReceiverPortAvailable(port: number) {
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(1500);
    socket.once("connect", () => {
      socket.destroy();
      reject(new Error(
        `Harbor cannot start: port ${port} already has a local server. ` +
        `Use the existing Harbor window, or stop that server before changing between local and Wi-Fi mode.`,
      ));
    });
    socket.once("error", (error: NodeJS.ErrnoException) => {
      socket.destroy();
      if (error.code === "ECONNREFUSED") resolve();
      else reject(new Error(`Cannot check Harbor port ${port}: ${error.code ?? error.message}`));
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error(`Cannot check Harbor port ${port}: connection timed out.`));
    });
  });
}
