/**
 * The key pair that stands in for a guest on the phone they set up. Made with
 * WebCrypto, private half non-extractable: page scripts, this one included,
 * can sign with it but can never read it out. It lives in IndexedDB, which can
 * store a CryptoKey as is.
 *
 * What gets signed is always prefixed with what it is for, so a signature made
 * for one can never pass for the other.
 */

export const enrollMessage = (token: string) => `enroll:${token}`;
export const checkInMessage = (scanId: string) => `checkin:${scanId}`;

const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const DB_NAME = 'event-checkin';
const STORE = 'device-key';
const RECORD = 'current';

export type DeviceKey = { keyId: string; privateKey: CryptoKey };

export async function createKeyPair() {
	// extractable: false covers the private key only; a public key always exports.
	return crypto.subtle.generateKey(ALGORITHM, false, ['sign', 'verify']);
}

export async function exportPublicKey(publicKey: CryptoKey) {
	return crypto.subtle.exportKey('jwk', publicKey);
}

/** Base64url, the way the server reads it. */
export async function sign(privateKey: CryptoKey, message: string) {
	const signature = await crypto.subtle.sign(
		{ name: 'ECDSA', hash: 'SHA-256' },
		privateKey,
		new TextEncoder().encode(message)
	);
	// Not Uint8Array.toBase64: older iPhones don't have it.
	return btoa(String.fromCharCode(...new Uint8Array(signature)))
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replace(/=+$/, '');
}

export async function loadDeviceKey(): Promise<DeviceKey | undefined> {
	const db = await open();
	try {
		return await request(db.transaction(STORE).objectStore(STORE).get(RECORD));
	} finally {
		db.close();
	}
}

export async function saveDeviceKey(key: DeviceKey) {
	const db = await open();
	try {
		await request(db.transaction(STORE, 'readwrite').objectStore(STORE).put(key, RECORD));
	} finally {
		db.close();
	}
	// Asks the browser not to clear it under storage pressure. Best effort: it
	// may say no, and Safari's own seven-day rule for sites you don't visit is
	// a separate thing this doesn't switch off.
	await navigator.storage?.persist?.().catch(() => false);
}

function open() {
	const opening = indexedDB.open(DB_NAME, 1);
	opening.onupgradeneeded = () => opening.result.createObjectStore(STORE);
	return request(opening);
}

function request<T>(req: IDBRequest<T>) {
	return new Promise<T>((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}
