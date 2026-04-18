import nacl from "tweetnacl";
import { describe, expect, it } from "vitest";
import { encryptSecret } from "../../src/lib/crypto.js";

describe("encryptSecret", () => {
	it("produces a base64 sealed box", () => {
		const keyPair = nacl.box.keyPair();
		const publicKeyBase64 = Buffer.from(keyPair.publicKey).toString("base64");
		const result = encryptSecret(publicKeyBase64, "my-secret-value");

		const decoded = Buffer.from(result, "base64");
		expect(decoded.length).toBeGreaterThan(0);

		const messageBytes = Buffer.from("my-secret-value");
		const expectedLength = 32 + messageBytes.length + nacl.box.overheadLength;
		expect(decoded.length).toBe(expectedLength);
	});

	it("produces different ciphertext each call (ephemeral keys)", () => {
		const keyPair = nacl.box.keyPair();
		const publicKeyBase64 = Buffer.from(keyPair.publicKey).toString("base64");
		const result1 = encryptSecret(publicKeyBase64, "same-secret");
		const result2 = encryptSecret(publicKeyBase64, "same-secret");
		expect(result1).not.toBe(result2);
	});
});
