import { describe, it, expect } from "vitest";
import { generateKeyPairSync, verify } from "node:crypto";
import { appleClientSecret } from "./apple-sign-in";

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

describe("Apple client secret", () => {
  it("is an ES256 JWT for PinPals' app that Apple can verify", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const now = Date.UTC(2026, 9, 28, 9, 0, 0);

    const jwt = appleClientSecret({ keyId: "ABC123DEFG", privateKey: pem, teamId: "8UEGCT8434" }, now);
    const [header, payload, signature] = jwt.split(".");

    expect(decode(header)).toEqual({ alg: "ES256", kid: "ABC123DEFG", typ: "JWT" });
    expect(decode(payload)).toEqual({
      iss: "8UEGCT8434",
      iat: now / 1000,
      exp: now / 1000 + 300,
      aud: "https://appleid.apple.com",
      sub: "ie.pinpals.app",
    });
    const sig = Buffer.from(signature, "base64url");
    expect(sig.length).toBe(64); // r‖s, not DER
    expect(
      verify("sha256", Buffer.from(`${header}.${payload}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, sig),
    ).toBe(true);
  });
});
