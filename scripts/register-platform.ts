/**
 * Registers a Moodle instance with the LTI tool, so launches from it are
 * accepted. Once per Moodle tool configuration (i.e. per client ID).
 *
 *   pnpm lti:register-platform --url https://moodle.example.com --client-id abc123
 *
 * Re-running for a URL and client ID already registered does nothing.
 */
import { parseArgs } from 'node:util';
import { IdTokenValidationMethod } from 'ltijs';
import { provider } from '../src/lib/server/lti/provider';

const USAGE = `Usage: pnpm lti:register-platform --url <moodle-url> --client-id <client-id> [--name <name>]

  --url <url>        Base URL of the Moodle instance, e.g. https://moodle.example.com
  --client-id <id>   Client ID Moodle shows for the tool once it is saved
  --name <name>      Display name (default: Moodle)`;

const { values } = parseArgs({
	options: {
		url: { type: 'string' },
		'client-id': { type: 'string' },
		name: { type: 'string', default: 'Moodle' },
		help: { type: 'boolean', short: 'h' }
	}
});

if (values.help) {
	console.log(USAGE);
} else if (!values.url || !values['client-id']) {
	throw new Error(`--url and --client-id are required.\n\n${USAGE}`);
} else {
	// Moodle puts its URL without a trailing slash in `iss`, and ltijs matches it exactly.
	const url = values.url.replace(/\/+$/, '');
	const clientId = values['client-id'];

	const existing = await provider.platformManager.getPlatformByUrlAndClientId(url, clientId);
	if (existing) {
		console.log(`Already registered (id ${existing.id}) — nothing to do.`);
	} else {
		const platform = await provider.platformManager.registerPlatform({
			name: values.name,
			url,
			clientId,
			authenticationEndpoint: `${url}/mod/lti/auth.php`,
			accessTokenEndpoint: `${url}/mod/lti/token.php`,
			idTokenValidation: {
				method: IdTokenValidationMethod.JwkSet,
				key: `${url}/mod/lti/certs.php`
			}
		});
		console.log(`Registered "${platform.name}" (id ${platform.id}).`);
	}
}
