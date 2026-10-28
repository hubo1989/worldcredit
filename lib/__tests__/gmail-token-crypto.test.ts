import { describe, expect, it } from "vitest";
import { encryptToken, decryptToken, GmailCryptoError } from "../gmail/token-crypto";

const SECRET = "test-session-secret-for-gmail-tokens";

describe("gmail token crypto", () => {
  it("round-trips a refresh token", async () => {
    const enc = await encryptToken("1//0refresh-token-é中文", SECRET);
    expect(enc).not.toContain("refresh-token");
    expect(await decryptToken(enc, SECRET)).toBe("1//0refresh-token-é中文");
  });

  it("produces different ciphertexts for the same plaintext (random IV)", async () => {
    const a = await encryptToken("same", SECRET);
    const b = await encryptToken("same", SECRET);
    expect(a).not.toBe(b);
  });

  it("fails closed on wrong key or tampered ciphertext", async () => {
    const enc = await encryptToken("secret-value", SECRET);
    await expect(decryptToken(enc, "other-secret-xxxxxxxx")).rejects.toBeInstanceOf(GmailCryptoError);
    const tampered = enc.slice(0, -4) + (enc.endsWith("AAAA") ? "BBBB" : "AAAA");
    await expect(decryptToken(tampered, SECRET)).rejects.toBeInstanceOf(GmailCryptoError);
  });
});
