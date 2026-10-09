import { describe, expect, it } from "vitest";

import { teeColour } from "./tee-colours";

describe("tee colours", () => {
  it("reads the colour from the tee's name, wherever it is", () => {
    expect(teeColour("Yellow").fill).toBe("#f6c915");
    expect(teeColour("Green (Women)").fill).toBe("#2f8f46");
    expect(teeColour("Championship · Blue").fill).toBe("#2160c4");
    expect(teeColour("RED").fill).toBe("#c8372d");
  });

  it("keeps light tees visible and their labels readable", () => {
    const white = teeColour("White");
    expect(white.border).not.toBe(white.fill);
    expect(white.text).toBe("#0e1520");
    expect(teeColour("Blue").text).toBe("#f7f3ea");
  });

  it("falls back to navy for a name with no colour", () => {
    expect(teeColour("Medal")).toMatchObject({ named: false, fill: "#0c2038" });
    expect(teeColour(null).named).toBe(false);
  });
});
