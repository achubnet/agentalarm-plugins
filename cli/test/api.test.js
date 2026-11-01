import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createAlarm, extractSetupUrl, redeemSetup, revokeKey } from '../src/api.js';
import { EXIT } from '../src/errors.js';
import { checkUrl, request } from '../src/http.js';
import { startFakeServer } from '../test-support/fake-server.js';

const KEY = '7|aa_0123456789abcdefghijklmnopqrstuvwxyz';

describe('extractSetupUrl', () => {
  test('finds the link in the text copied from the app', () => {
    const text = 'Connect my AgentAlarm (reminders on my iPhone): open https://alarm.achub.net/api/setup/K7M2-9QXP and follow the instructions. The link works once, for 30 minutes.\n\nAfter connecting, alert me:\n- When a long task is done';
    assert.equal(extractSetupUrl(text), 'https://alarm.achub.net/api/setup/K7M2-9QXP');
  });

  test('accepts the bare link, the key page link and the bare code', () => {
    assert.equal(extractSetupUrl('https://alarm.achub.net/api/setup/K7M2-9QXP/key'), 'https://alarm.achub.net/api/setup/K7M2-9QXP');
    assert.equal(extractSetupUrl('  k7m2-9qxp '), 'https://alarm.achub.net/api/setup/K7M2-9QXP');
    assert.equal(extractSetupUrl('http://127.0.0.1:8000/api/setup/AAAA-BBBB.'), 'http://127.0.0.1:8000/api/setup/AAAA-BBBB');
  });

  test('returns null without a link', () => {
    assert.equal(extractSetupUrl('hello'), null);
    assert.equal(extractSetupUrl(''), null);
    assert.equal(extractSetupUrl('https://alarm.achub.net/api/setup/K7M2-9QXPZ'), null);
  });

  test('refuses any server but AgentAlarm (or loopback) unless --server names it', () => {
    for (const host of ['https://alarm.achub.net.evil.example', 'https://alarm-achub.net', 'https://evil.example']) {
      assert.throws(() => extractSetupUrl(`open ${host}/api/setup/K7M2-9QXP now`), { exitCode: EXIT.USAGE, message: /--server/ });
    }
    assert.equal(
      extractSetupUrl('open https://alarm.self.hosted/api/setup/K7M2-9QXP', { server: 'https://alarm.self.hosted' }),
      'https://alarm.self.hosted/api/setup/K7M2-9QXP',
    );
    assert.throws(() => extractSetupUrl('https://evil.example/api/setup/K7M2-9QXP', { server: 'https://alarm.self.hosted' }), /--server/);
    assert.equal(extractSetupUrl('K7M2-9QXP', { server: 'https://alarm.self.hosted/' }), 'https://alarm.self.hosted/api/setup/K7M2-9QXP');
    assert.equal(extractSetupUrl('http://localhost:8000/api/setup/K7M2-9QXP'), 'http://localhost:8000/api/setup/K7M2-9QXP');
  });

  test('refuses links with a user name or password', () => {
    assert.throws(() => extractSetupUrl('https://alarm.achub.net@evil.example/api/setup/K7M2-9QXP'), { exitCode: EXIT.USAGE, message: /user name or password/ });
    assert.throws(() => extractSetupUrl('https://user:pw@alarm.achub.net/api/setup/K7M2-9QXP'), /user name or password/);
    assert.throws(() => extractSetupUrl('K7M2-9QXP', { server: 'https://u:p@alarm.self.hosted' }), /user name or password/);
  });

  test('refuses plain http to a remote host', () => {
    assert.throws(() => extractSetupUrl('http://alarm.achub.net/api/setup/K7M2-9QXP'), { exitCode: EXIT.USAGE });
  });
});

describe('http', () => {
  test('only https, or http on loopback', () => {
    assert.equal(checkUrl('https://alarm.achub.net/api').host, 'alarm.achub.net');
    assert.equal(checkUrl('http://localhost:3000').hostname, 'localhost');
    assert.throws(() => checkUrl('http://example.com'), /HTTPS/);
    assert.throws(() => checkUrl('ftp://example.com'), /HTTPS/);
  });

  test('gives up after the timeout', async () => {
    const server = await startFakeServer({ 'GET /slow': 'hang' });
    try {
      await assert.rejects(request('GET', `${server.url}/slow`, { timeoutMs: 100 }), /no answer within/);
    } finally {
      await server.close();
    }
  });
});

describe('API calls', () => {
  let server;
  let alarmResponse;

  before(async () => {
    server = await startFakeServer({
      'GET /api/setup/AAAA-BBBB/key': (req) => ({
        status: 200,
        json: { key: KEY, name: req.query.name, read_only: false, mcp_url: `${server.url}/mcp`, api_url: `${server.url}/api` },
      }),
      'GET /api/setup/CCCC-DDDD/key': () => ({ status: 404, json: { message: 'This AgentAlarm setup link is invalid, expired or already used.' } }),
      'GET /api/setup/EEEE-FFFF/key': () => ({ status: 200, text: '# AgentAlarm key\n\nmarkdown only' }),
      'POST /api/alarms': () => alarmResponse,
      'POST /api/auth/logout': () => ({ status: 200, json: { ok: true } }),
    });
  });
  after(() => server.close());

  test('redeems the setup link as JSON, named, once', async () => {
    const redeemed = await redeemSetup(`${server.url}/api/setup/AAAA-BBBB`, 'agentalarm CLI on mbp');
    assert.deepEqual(redeemed, { key: KEY, name: 'agentalarm CLI on mbp', readOnly: false, baseUrl: server.url });
    const req = server.requests.at(-1);
    assert.deepEqual(req.query, { format: 'json', name: 'agentalarm CLI on mbp' });
    assert.equal(req.headers.authorization, undefined);
  });

  test('a used link reports the server message', async () => {
    await assert.rejects(redeemSetup(`${server.url}/api/setup/CCCC-DDDD`, 'x'), { message: /already used/, exitCode: EXIT.USAGE });
  });

  test('a server without the JSON page is an error, not a guess', async () => {
    await assert.rejects(redeemSetup(`${server.url}/api/setup/EEEE-FFFF`, 'x'), /did not return a key/);
  });

  test('creates an alarm with the key in the Authorization header and a client id', async () => {
    alarmResponse = { status: 201, json: { id: 'x', type: 'urgent', rings_at: '2026-10-28T09:00:00Z' } };
    await createAlarm({ key: KEY, baseUrl: server.url }, { type: 'urgent', title: 'Deploy failed' });
    const req = server.requests.at(-1);
    assert.equal(req.headers.authorization, `Bearer ${KEY}`);
    assert.equal(req.body.type, 'urgent');
    assert.equal(req.body.title, 'Deploy failed');
    assert.match(req.body.id, /^[0-9a-f-]{36}$/);
    assert.ok(!req.path.includes(KEY) && !JSON.stringify(req.query).includes(KEY));
  });

  test('a refused alert carries the server limit message', async () => {
    alarmResponse = { status: 422, json: { message: 'This day already has 40 reminders (the limit). Pick another day or finish one.' } };
    await assert.rejects(createAlarm({ key: KEY, baseUrl: server.url }, { type: 'normal', title: 'x' }), {
      message: 'This day already has 40 reminders (the limit). Pick another day or finish one.',
      exitCode: EXIT.REFUSED,
    });
  });

  test('a rejected key is an auth error', async () => {
    alarmResponse = { status: 401, json: { message: 'Unauthenticated.' } };
    await assert.rejects(createAlarm({ key: KEY, baseUrl: server.url }, { type: 'normal', title: 'x' }), { exitCode: EXIT.AUTH });
  });

  test('no key: nothing is sent', async () => {
    const before = server.requests.length;
    await assert.rejects(createAlarm({ key: null, baseUrl: server.url }, { type: 'normal', title: 'x' }), { exitCode: EXIT.AUTH });
    assert.equal(server.requests.length, before);
  });

  test('revokes the key', async () => {
    await revokeKey({ key: KEY, baseUrl: server.url });
    assert.equal(server.requests.at(-1).path, '/api/auth/logout');
  });
});
