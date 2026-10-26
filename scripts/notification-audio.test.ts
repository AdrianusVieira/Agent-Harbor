import assert from "node:assert/strict";
import { test } from "node:test";
import { deliverLiveSound, prepareLiveAudio } from "../src/notification-audio.ts";

test("live audio resumes a previously activated suspended/interrupted context", async () => {
  for (const state of ["running", "suspended", "interrupted"]) {
    let resumes = 0;
    const context = { state, async resume() { resumes++; this.state = "running"; } };
    assert.equal(await prepareLiveAudio(context), true);
    assert.equal(resumes, state === "running" ? 0 : 1);
  }
  assert.equal(await prepareLiveAudio(null), false);
  let resumed = false;
  assert.equal(await prepareLiveAudio({ state: "closed", async resume() { resumed = true; } }), false);
  assert.equal(resumed, false);
});

test("blocked or unanswered browser resume attempts fail quietly within a bound", async () => {
  assert.equal(await prepareLiveAudio({ state: "suspended", async resume() { throw new Error("gesture required"); } }), false);
  assert.equal(await prepareLiveAudio({ state: "suspended", resume: () => new Promise<void>(() => {}) }, 5), false);
});

test("the live event path resumes audio before claiming and playing its sound", async () => {
  const order: string[] = [];
  const context = { state: "suspended", async resume() { order.push("resume"); this.state = "running"; } };
  const result = await deliverLiveSound({
    context, allowed: () => true,
    claim: async () => { order.push("claim"); return true; },
    play: () => { order.push("play"); return true; },
  });
  assert.equal(result, "played");
  assert.deepEqual(order, ["resume", "claim", "play"]);
});

test("blocked or stale live events do not consume another tab's sound claim", async () => {
  let claims = 0;
  let plays = 0;
  const handlers = { claim: async () => { claims++; return true; }, play: () => { plays++; return true; } };
  assert.equal(await deliverLiveSound({ context: null, allowed: () => true, ...handlers }), "blocked");
  let allowed = true;
  const context = { state: "suspended", async resume() { this.state = "running"; allowed = false; } };
  assert.equal(await deliverLiveSound({ context, allowed: () => allowed, ...handlers }), "stale");
  assert.equal(claims, 0);
  assert.equal(plays, 0);
});

test("a claimed or superseded sound is not played; playback failures are reported", async () => {
  const context = { state: "running", async resume() {} };
  let plays = 0;
  const play = () => { plays++; return true; };
  assert.equal(await deliverLiveSound({ context, allowed: () => true, claim: async () => false, play }), "claimed");
  let allowed = true;
  assert.equal(await deliverLiveSound({ context, allowed: () => allowed, claim: async () => { allowed = false; return true; }, play }), "stale");
  assert.equal(plays, 0);
  assert.equal(await deliverLiveSound({ context, allowed: () => true, claim: async () => true, play: () => false }), "blocked");
});
