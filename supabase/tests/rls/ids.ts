// Reads the fixture ids that global-setup.ts wrote to disk (see that file for
// why this can't just be a shared module-level variable: globalSetup runs in
// its own process, separate from the test files that need these ids).
import { readFileSync } from "node:fs";
import path from "node:path";
import type { FixtureIds } from "./fixtures";

const FIXTURE_IDS_PATH = path.join(__dirname, ".fixture-ids.json");

let cached: FixtureIds | undefined;

export function fixtureIds(): FixtureIds {
  if (!cached) {
    cached = JSON.parse(readFileSync(FIXTURE_IDS_PATH, "utf-8")) as FixtureIds;
  }
  return cached;
}
