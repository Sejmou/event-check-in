import { expect, test } from 'vitest';
import { annotate } from './check-in-log';

// Newest first, the order the page shows them in.
const rows = [
	{ userId: 'ada', ipAddress: '10.0.0.9' }, // came back
	{ userId: 'bob', ipAddress: '10.0.0.7' }, // ...on Grace's phone
	{ userId: 'grace', ipAddress: '10.0.0.7' },
	{ userId: 'ada', ipAddress: '10.0.0.9' }
];

test('the first arrival is not a repeat and a later one is', () => {
	const { rows: marked, guests } = annotate(rows);

	expect(marked.map((r) => r.repeat)).toEqual([true, false, false, false]);
	expect(guests).toBe(3);
});

test('an address covering two guests is flagged on both of their rows', () => {
	const { rows: marked, addresses } = annotate(rows);

	expect(marked.map((r) => r.sharedAddress)).toEqual([false, true, true, false]);
	expect(addresses).toBe(2);
});

test('a missing address is not shared with every other missing one', () => {
	const { rows: marked, addresses } = annotate([
		{ userId: 'ada', ipAddress: null },
		{ userId: 'bob', ipAddress: null }
	]);

	expect(marked.every((r) => !r.sharedAddress)).toBe(true);
	expect(addresses).toBe(0);
});
