import test from "node:test";
import assert from "node:assert/strict";
import { isPathWithinRoot, normalizePathForCompare } from "./path-utils.js";

test("normalizePathForCompare strips Windows extended drive prefix", () => {
  const normal = normalizePathForCompare("D:\\Workspace\\Demo");
  const extended = normalizePathForCompare("\\\\?\\D:\\Workspace\\Demo");

  assert.equal(extended, normal);
});

test("normalizePathForCompare strips Windows extended UNC prefix", () => {
  const normal = normalizePathForCompare("\\\\server\\share\\Demo");
  const extended = normalizePathForCompare("\\\\?\\UNC\\server\\share\\Demo");

  assert.equal(extended, normal);
});

test("isPathWithinRoot treats extended child path as inside root", () => {
  assert.equal(
    isPathWithinRoot("\\\\?\\D:\\Workspace\\Demo\\src", "d:\\workspace\\demo"),
    true,
  );
});
