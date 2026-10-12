import { createHash, createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { certificationSignature, fromHex, hmacSha256, sha256, toHex, utf8 } from "./hmac-sha256";

describe("sha256", () => {
  it("matches Node for the empty string, the standard vector and lengths around the padding edges", () => {
    expect(toHex(sha256(new Uint8Array()))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(toHex(sha256(utf8("abc")))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    for (const n of [1, 55, 56, 63, 64, 65, 119, 120, 200]) {
      const data = randomBytes(n);
      expect(toHex(sha256(new Uint8Array(data)))).toBe(createHash("sha256").update(data).digest("hex"));
    }
  });
});

describe("hmacSha256", () => {
  it("matches RFC 4231 test case 2 and Node for random keys, including keys longer than a block", () => {
    expect(toHex(hmacSha256(utf8("Jefe"), utf8("what do ya want for nothing?")))).toBe(
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    );
    for (const len of [16, 32, 64, 100]) {
      const key = randomBytes(len);
      const msg = randomBytes(77);
      expect(toHex(hmacSha256(new Uint8Array(key), new Uint8Array(msg)))).toBe(createHmac("sha256", key).update(msg).digest("hex"));
    }
  });
});

describe("certificationSignature", () => {
  it("is what scorecard_certify() expects: HMAC of the v1 message under the hex key", () => {
    const secret = randomBytes(32).toString("hex");
    const challenge = randomBytes(16).toString("hex");
    const hash = randomBytes(32).toString("hex");
    const expected = createHmac("sha256", Buffer.from(secret, "hex")).update(`pinpals-certify:v1:42:${challenge}:${hash}`).digest("hex");
    expect(certificationSignature(secret, 42, challenge, hash)).toBe(expected);
  });

  it("encodes UTF-8 like Node and rejects keys that aren't hex", () => {
    for (const s of ["Ciarán", "Ó Súilleabháin ⛳", "𝄞"]) expect(toHex(utf8(s))).toBe(Buffer.from(s, "utf8").toString("hex"));
    expect(() => fromHex("zz")).toThrow();
  });
});
