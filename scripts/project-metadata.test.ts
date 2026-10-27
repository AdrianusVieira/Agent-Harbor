import assert from "node:assert/strict";
import { test } from "node:test";
import { projectMetadata } from "./project-metadata.ts";

test("project labels reveal only a bounded working-folder name", () => {
  for (const cwd of [
    "/Users/private-account/work/Agent Harbor",
    "/Users/private-account/work/Agent Harbor/",
    "C:\\Users\\private-account\\work\\Agent Harbor\\",
  ]) {
    assert.deepEqual(projectMetadata(cwd), { projectName: "Agent Harbor" });
    assert.doesNotMatch(JSON.stringify(projectMetadata(cwd)), /private-account/);
  }
  for (const cwd of [
    undefined, null, {}, 42, "", "/", "C:\\", "relative/project",
    "/private/" + "x".repeat(201), "/private/bad\nlabel", "/" + "x".repeat(4096),
  ]) {
    assert.deepEqual(projectMetadata(cwd), {});
  }
});
