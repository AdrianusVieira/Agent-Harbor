import { Worker } from "node:worker_threads";
import type { TelemetryPeriod, TelemetrySource } from "../src/telemetryData.ts";
import type { Store as ClaudeStore } from "./collectors/claude/store.ts";
import type { Store as CodexStore } from "./collectors/codex/store.ts";
import type { getTelemetrySummary } from "./telemetrySummary.ts";
import type {
  getClaudeAccounts,
  getSessionEvents,
  getSessionView,
} from "./telemetryViews.ts";

type Results = {
  accounts: ReturnType<typeof getClaudeAccounts>;
  events: ReturnType<typeof getSessionEvents>;
  prompts: {
    total: number;
    prompts:
      | ReturnType<ClaudeStore["sessionPrompts"]>
      | ReturnType<CodexStore["sessionPrompts"]>;
  };
  sessions:
    | ReturnType<ClaudeStore["sessions"]>["sessions"]
    | ReturnType<CodexStore["sessions"]>["sessions"];
  summary: ReturnType<typeof getTelemetrySummary>;
  view: ReturnType<typeof getSessionView>;
};
export type TelemetryQuery = {
  id: number;
  kind: keyof Results;
  source: TelemetrySource;
  period: TelemetryPeriod;
  sessionId?: string;
  offset?: number;
};

export class TelemetryQueries {
  private closed = false;
  private nextId = 0;
  private pending = new Map<
    number,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private worker: Worker;
  readonly ready: Promise<void>;

  constructor(directory: string) {
    this.worker = new Worker(
      new URL("./telemetry-worker.mjs", import.meta.url),
      { workerData: { directory } },
    );
    this.ready = new Promise<void>((resolve, reject) => {
      this.worker.on("message", (message) => {
        if (message.ready) {
          resolve();
          return;
        }
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error));
        else pending.resolve(message.result);
      });
      this.worker.on("error", () => {
        reject(new Error("Telemetry query worker failed."));
        this.fail();
      });
      this.worker.on("exit", () => {
        reject(new Error("Telemetry query worker exited."));
        this.fail();
      });
    });
  }

  request<Kind extends keyof Results>(
    kind: Kind,
    source: TelemetrySource,
    period: TelemetryPeriod,
    sessionId?: string,
    offset?: number,
  ): Promise<Results[Kind]> {
    if (this.closed || this.pending.size >= 32)
      return Promise.reject(new Error("Telemetry history is busy or closed."));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Telemetry query timed out."));
      }, 30_000);
      timer.unref();
      this.pending.set(id, {
        resolve: (value) => resolve(value as Results[Kind]),
        reject,
        timer,
      });
      this.worker.postMessage({
        id,
        kind,
        source,
        period,
        sessionId,
        offset,
      } satisfies TelemetryQuery);
    });
  }

  invalidate() {
    if (!this.closed) this.worker.postMessage({ kind: "invalidate" });
  }

  private fail() {
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Telemetry query worker closed."));
    }
    this.pending.clear();
  }

  async close() {
    if (this.closed) {
      await this.worker.terminate();
      return;
    }
    this.fail();
    const exited = new Promise<void>((resolve) =>
      this.worker.once("exit", () => resolve()),
    );
    this.worker.postMessage({ kind: "close" });
    const timeout = setTimeout(() => {
      void this.worker.terminate();
    }, 5000);
    timeout.unref();
    await exited;
    clearTimeout(timeout);
  }
}
