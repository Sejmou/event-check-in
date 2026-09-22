import { createPublicKey, verify, type KeyObject } from 'node:crypto';

/** A P-256 public key as a JWK, and nothing else. */
export type PublicJwk = { kty: 'EC'; crv: 'P-256'; x: string; y: string };

/**
 * The browser's public key, trimmed to the four fields that make it up, or null
 * unless it is a valid P-256 key. Anything else a JWK can carry (`key_ops`,
 * `ext`, a private `d`) is dropped rather than stored.
 */
export function parsePublicKey(value: unknown): PublicJwk | null {
	if (typeof value !== 'object' || value === null) return null;
	const { kty, crv, x, y } = value as Record<string, unknown>;
	if (kty !== 'EC' || crv !== 'P-256' || typeof x !== 'string' || typeof y !== 'string') {
		return null;
	}
	const jwk: PublicJwk = { kty, crv, x, y };
	return toKeyObject(jwk) ? jwk : null;
}

/**
 * Whether `signature` is `publicKey`'s over `message`. WebCrypto's ECDSA
 * signatures are raw r‖s (IEEE P1363), not the DER Node assumes by default.
 */
export function verifySignature(publicKey: PublicJwk, message: string, signature: string) {
	const key = toKeyObject(publicKey);
	if (!key) return false;
	try {
		return verify(
			'sha256',
			Buffer.from(message),
			{ key, dsaEncoding: 'ieee-p1363' },
			Buffer.from(signature, 'base64url')
		);
	} catch {
		return false;
	}
}

function toKeyObject(jwk: PublicJwk): KeyObject | null {
	try {
		// Throws for a point that isn't on the curve.
		return createPublicKey({ key: jwk, format: 'jwk' });
	} catch {
		return null;
	}
}
