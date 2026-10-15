import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";

import { weatherKitToken, windProvider } from "./wind";

describe("windProvider", () => {
  it("uses WeatherKit only with all four settings, else Open-Meteo, and can be switched off", () => {
    const all = { WEATHERKIT_TEAM_ID: "T", WEATHERKIT_SERVICE_ID: "S", WEATHERKIT_KEY_ID: "K", WEATHERKIT_PRIVATE_KEY: "P" } as unknown as NodeJS.ProcessEnv;
    expect(windProvider(all)).toBe("weatherkit");
    expect(windProvider({ ...all, WEATHERKIT_KEY_ID: "" } as NodeJS.ProcessEnv)).toBe("open-meteo");
    expect(windProvider({ ...all, WIND_PROVIDER: "off" } as NodeJS.ProcessEnv)).toBe("off");
  });
});

describe("weatherKitToken", () => {
  it("is an ES256 JWT that verifies with the key's public half", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString().replace(/\n/g, "\\n");
    const env = { WEATHERKIT_TEAM_ID: "TEAM123456", WEATHERKIT_SERVICE_ID: "ie.pinpals.weather", WEATHERKIT_KEY_ID: "KEY1", WEATHERKIT_PRIVATE_KEY: pem } as unknown as NodeJS.ProcessEnv;
    const token = weatherKitToken(env, 1_800_000_000);
    const [h, b, sig] = token.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "ES256", kid: "KEY1", id: "TEAM123456.ie.pinpals.weather" });
    expect(JSON.parse(Buffer.from(b, "base64url").toString())).toEqual({ iss: "TEAM123456", iat: 1_800_000_000, exp: 1_800_003_600, sub: "ie.pinpals.weather" });
    const v = createVerify("SHA256");
    v.update(`${h}.${b}`);
    expect(v.verify({ key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url"))).toBe(true);
  });
});
