import { readFileSync } from "fs";
import { join } from "path";
import { versionKey } from "./build-priority";

const fixtures = JSON.parse(readFileSync(join(__dirname, "../../pkg/buildpriority/testdata/version-keys.json"), "utf8")) as {
  orderedGroups: string[][];
  invalid: string[];
  golden: { version: string; key: string }[];
};

test("persistent version keys agree with the worker encoding", () => {
  let previous = "";
  for (const group of fixtures.orderedGroups) {
    const key = versionKey(...group);
    expect(key > previous).toBe(true);
    for (const version of group) expect(versionKey(version)).toBe(key);
    previous = key;
  }
  for (const version of fixtures.invalid) expect(versionKey(version)).toBe("");
  for (const golden of fixtures.golden) expect(versionKey(golden.version)).toBe(golden.key);
  expect(versionKey("latest", "1.9.0", "1.10", "1.8.0")).toBe(versionKey("1.10.0"));
  expect(versionKey()).toBe("");
});
