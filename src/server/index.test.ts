import test from "node:test";
import assert from "node:assert/strict";
import { isMainModule } from "./index.js";

test("isMainModule matches Windows ESM execution paths", () => {
  assert.equal(
    isMainModule(
      "file:///D:/tools/codex-thread-merge-weak/dist/server/index.js",
      "D:\\tools\\codex-thread-merge-weak\\dist\\server\\index.js",
    ),
    true,
  );
});

test("isMainModule returns false when argv entry path is missing", () => {
  assert.equal(isMainModule("file:///D:/tools/server.js", undefined), false);
});
