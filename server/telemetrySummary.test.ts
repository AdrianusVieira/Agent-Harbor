import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeTelemetry } from "./telemetrySummary.ts";

test("summarizes Claude usage and linked prompt groups without exposing session details", () => {
  const result = summarizeTelemetry("claude", 30, {
    sessions: [
      {
        id: "secret-id",
        title: "Private chat",
        prompts: 2,
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 20,
        cacheCreationTokens: 3,
        apiRequests: 2,
        estimatedCostUsd: 1.25,
        activeUserSeconds: 60,
        activeCliSeconds: 120,
        tokenTimeline: [
          {
            timestamp: 100,
            input: 10,
            output: 5,
            cacheRead: 0,
            cacheWrite: 0,
            promptId: "p1",
          },
          {
            timestamp: 200,
            input: 0,
            output: 0,
            cacheRead: 20,
            cacheWrite: 3,
            promptId: "p1",
          },
        ],
      },
      { id: "other", prompts: 1, estimatedCostUsd: null, tokenTimeline: [] },
    ],
  });
  assert.equal(result.conversations, 2);
  assert.equal(result.tokens, 38);
  assert.equal(result.estimatedCostUsd, 1.25);
  assert.equal(result.partialCost, true);
  assert.equal(result.activeSeconds, 180);
  assert.equal(result.avgTokensPerRequest, 19);
  assert.equal(result.avgTokensPerPrompt, 38);
  assert.equal(result.linkedPrompts, 1);
  assert.deepEqual(
    result.timeline.map((point) => point.total),
    [15, 38],
  );
  assert.equal(JSON.stringify(result).includes("Private chat"), false);
  assert.equal(JSON.stringify(result).includes("secret-id"), false);
});

test("summarizes Codex observed counts without inventing a cost or missing token total", () => {
  const result = summarizeTelemetry("codex", 7, {
    sessions: [
      {
        id: "conversation",
        prompts: 3,
        apiRequests: 4,
        errors: 1,
        toolCalls: 6,
        observedTokens: null,
        tokenTimeline: [],
      },
    ],
  });
  assert.equal(result.conversations, 1);
  assert.equal(result.tokens, null);
  assert.equal(result.toolResults, 6);
  assert.equal(result.estimatedCostUsd, null);
  assert.deepEqual(result.timeline, []);
});

test("counts worked Codex conversations while retaining signal-only token observations", () => {
  const result = summarizeTelemetry("codex", 7, {
    sessions: [
      {
        id: "worked",
        hasUserPrompt: true,
        prompts: 1,
        completedResponses: 1,
        observedTokens: 7,
        tokenTimeline: [{ timestamp: 100, total: 7 }],
      },
      {
        id: "signal-only",
        hasUserPrompt: false,
        prompts: 0,
        completedResponses: 1,
        observedTokens: 5,
        tokenTimeline: [{ timestamp: 200, total: 5 }],
      },
    ],
  });
  assert.equal(result.conversations, 1);
  assert.equal(result.signalOnlyIds, 1);
  assert.equal(result.tokens, 12);
  assert.equal(result.timeline.at(-1)?.total, 12);
});

test("rejects a malformed upstream response", () => {
  assert.throws(() => summarizeTelemetry("claude", 30, {}), /sessions array/);
});
