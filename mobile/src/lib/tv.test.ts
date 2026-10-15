import { describe, expect, it } from "vitest";

import { normaliseTvCode, tidyTvCodeInput } from "./tv-code";

describe("TV codes", () => {
  it("read however they're typed", () => {
    expect(normaliseTvCode("k7q 4mp")).toBe("K7Q4MP");
    expect(normaliseTvCode("K7Q-4MP")).toBe("K7Q4MP");
  });
  it("refuse look-alikes and short codes", () => {
    expect(normaliseTvCode("K7Q4M0")).toBeNull();
    expect(normaliseTvCode("K7Q4MI")).toBeNull();
    expect(normaliseTvCode("K7Q4M")).toBeNull();
  });
  it("tidy the box as you type", () => {
    expect(tidyTvCodeInput("k7q 4mp9")).toBe("K7Q4MP");
  });
});
