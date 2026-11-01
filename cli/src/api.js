import { randomUUID } from 'node:crypto';
import { CliError, EXIT } from './errors.js';
import { DEFAULT_BASE_URL } from './config.js';
import { checkUrl, isLoopback, request } from './http.js';

const CODE = /([A-Z2-9]{4}-[A-Z2-9]{4})/;
const SETUP_LINK = /(https?:\/\/[^\s"'<>()]+?)\/api\/setup\/([A-Za-z2-9]{4}-[A-Za-z2-9]{4})(?![A-Za-z0-9-])/;

function serverUrl(value) {
  const url = checkUrl(value);
  if (url.username || url.password) {
    throw new CliError(`Refusing ${url.protocol}//${url.host}: a server address must not contain a user name or password.`, EXIT.USAGE);
  }
  return url;
}

/**
 * Finds the one-time setup link in what the user copied from the app (the whole text, the link alone, or the bare
 * code) and returns `<origin>/api/setup/<CODE>`. Null when there is none. A link to any server but AgentAlarm's (or
 * a loopback one, for development) is refused unless `server` names that origin: pasted text could carry a lookalike
 * host that would receive the redeem request and later every alert.
 */
export function extractSetupUrl(text, { server } = {}) {
  if (typeof text !== 'string') return null;
  const allowed = server ? serverUrl(server).origin : null;
  const link = text.match(SETUP_LINK);
  if (link) {
    const url = serverUrl(link[1]);
    if (url.origin !== DEFAULT_BASE_URL && url.origin !== allowed && !isLoopback(url)) {
      throw new CliError(
        `The link points to ${url.origin}, not ${DEFAULT_BASE_URL}. Only if you run that AgentAlarm server yourself, add --server ${url.origin}.`,
        EXIT.USAGE,
      );
    }
    return `${url.origin}/api/setup/${link[2].toUpperCase()}`;
  }
  const code = text.trim().toUpperCase().match(new RegExp(`^${CODE.source}$`));
  return code ? `${allowed ?? DEFAULT_BASE_URL}/api/setup/${code[1]}` : null;
}

function serverMessage(res) {
  const message = res.json && typeof res.json.message === 'string' ? res.json.message.trim() : '';
  return message.slice(0, 500);
}

/** Maps a failed response to a CliError with the server's own message where it has one. */
export function errorFrom(res) {
  const message = serverMessage(res);
  if (res.status === 401) {
    return new CliError('AgentAlarm rejected the key (revoked or expired). Run "agentalarm login" with a new link from the app.', EXIT.AUTH);
  }
  if (res.status === 403) {
    return new CliError('This key cannot create alerts (read-only). Connect again from the app without "read only".', EXIT.AUTH);
  }
  if (res.status === 422) {
    return new CliError(message || 'AgentAlarm refused the alert.', EXIT.REFUSED);
  }
  if (res.status === 429) {
    return new CliError('Too many requests. Wait a minute and try again.', EXIT.FAILURE);
  }
  return new CliError(`AgentAlarm answered HTTP ${res.status}${message ? `: ${message}` : '.'}`, EXIT.FAILURE);
}

/**
 * Opens the key page once (`?format=json`): the server creates the key named `name` and returns it.
 * The key must come from the same server as the link.
 */
export async function redeemSetup(setupUrl, name) {
  const url = new URL(`${setupUrl}/key`);
  url.searchParams.set('format', 'json');
  url.searchParams.set('name', name);
  const res = await request('GET', url.toString());

  if (res.status === 404) {
    throw new CliError(serverMessage(res) || 'This setup link is invalid, expired or already used. Create a new one in the AgentAlarm app.', EXIT.USAGE);
  }
  if (res.status !== 200) throw errorFrom(res);

  const data = res.json;
  if (!data || typeof data.key !== 'string' || !/^\d+\|\S{10,200}$/.test(data.key)) {
    throw new CliError('The setup page did not return a key. Update agentalarm ("npx agentalarm@latest") and try a new link.', EXIT.FAILURE);
  }
  return {
    key: data.key,
    name: typeof data.name === 'string' ? data.name : name,
    readOnly: data.read_only === true,
    baseUrl: new URL(setupUrl).origin,
  };
}

function authHeaders(creds) {
  if (!creds.key) {
    throw new CliError('Not logged in. Run: npx agentalarm login "<the text copied from the AgentAlarm app>" (or set AGENTALARM_KEY).', EXIT.AUTH);
  }
  return { Authorization: `Bearer ${creds.key}` };
}

/** POST /api/alarms with a client-made id, so a retried create never makes a second alert. */
export async function createAlarm(creds, alarm) {
  const body = { id: randomUUID(), ...alarm };
  const res = await request('POST', `${creds.baseUrl}/api/alarms`, { headers: authHeaders(creds), body });
  if (res.status !== 200 && res.status !== 201) throw errorFrom(res);
  return res.json ?? {};
}

export async function me(creds) {
  const res = await request('GET', `${creds.baseUrl}/api/me`, { headers: authHeaders(creds) });
  if (res.status !== 200) throw errorFrom(res);
  return res.json ?? {};
}

/** Revokes the key that makes the request (only that one). */
export async function revokeKey(creds) {
  const res = await request('POST', `${creds.baseUrl}/api/auth/logout`, { headers: authHeaders(creds) });
  if (res.status !== 200 && res.status !== 401) throw errorFrom(res);
}
