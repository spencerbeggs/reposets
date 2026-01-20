import { blake2b } from "blakejs";
import nacl from "tweetnacl";

/**
 * Encrypt a secret using libsodium's sealed box algorithm.
 * Implementation based on tweetsodium using tweetnacl + blakejs.
 *
 * The sealed box format is: ephemeral_public_key (32 bytes) || ciphertext
 */
export function encryptSecret(publicKey: string, secretValue: string): string {
	const messageBytes = Buffer.from(secretValue);
	const publicKeyBytes = Buffer.from(publicKey, "base64");

	const ephemeralKeyPair = nacl.box.keyPair();

	const nonceInput = new Uint8Array(64);
	nonceInput.set(ephemeralKeyPair.publicKey);
	nonceInput.set(publicKeyBytes, 32);
	const nonce = blake2b(nonceInput, undefined, 24);

	const ciphertext = nacl.box(messageBytes, nonce, publicKeyBytes, ephemeralKeyPair.secretKey);

	const sealed = new Uint8Array(ephemeralKeyPair.publicKey.length + ciphertext.length);
	sealed.set(ephemeralKeyPair.publicKey);
	sealed.set(ciphertext, ephemeralKeyPair.publicKey.length);

	return Buffer.from(sealed).toString("base64");
}
