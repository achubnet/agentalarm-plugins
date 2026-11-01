import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { configPath, saveConfig, stateDir } from '../src/config.js';
import { parseArgs, parseDuration } from '../src/cli.js';
import { tempEnv } from '../test-support/env.js';
import { startFakeServer } from '../test-support/fake-server.js';

const BIN = fileURLToPath(new URL('../bin/agentalarm.js', import.meta.url));
const KEY = '12|aa_fakekeyfakekeyfakekeyfakekey';

function run(args, { env, input = '' } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

test('argument parsing', () => {
  assert.deepEqual(parseArgs(['Deploy', 'failed', '-u', '--at=2026-10-28T09:00', '-c', 'red']), {
    positional: ['Deploy', 'failed'],
    options: { urgent: true, at: '2026-10-28T09:00', color: 'red' },
  });
  assert.deepEqual(parseArgs(['--', '--not-an-option']).positional, ['--not-an-option']);
  assert.throws(() => parseArgs(['--bogus']), { exitCode: 2 });
  assert.throws(() => parseArgs(['x', '--at']), { exitCode: 2 });
  assert.equal(parseDuration('1h'), 3_600_000);
  assert.equal(parseDuration('30m'), 1_800_000);
  assert.equal(parseDuration('90'), 5_400_000);
  assert.equal(parseDuration('2d'), 172_800_000);
  assert.equal(parseDuration('forever'), null);
  assert.equal(parseDuration('0'), null);
});

describe('agentalarm end to end against a fake server', () => {
  let server;
  let alarmStatus = 201;
  let ctx;

  before(async () => {
    server = await startFakeServer({
      'GET /api/setup/AAAA-BBBB/key': (req) => ({
        status: 200,
        json: { key: KEY, name: req.query.name, read_only: false, mcp_url: `${server.url}/mcp`, api_url: `${server.url}/api` },
      }),
      'POST /api/alarms': (req) =>
        alarmStatus === 201
          ? { status: 201, json: { id: req.body.id, type: req.body.type, title: req.body.title, rings_at: '2026-10-28T06:00:00Z' } }
          : { status: 422, json: { message: 'You have 200 active reminders (the limit). Finish or cancel some first.' } },
      'GET /api/me': () => ({ status: 200, json: { id: 1, name: 'Alex', timezone: 'Europe/Kyiv', push_registered: true, key: { name: 'agentalarm CLI on test', abilities: [] } } }),
      'POST /api/auth/logout': () => ({ status: 200, json: { ok: true } }),
    });
    ctx = tempEnv();
  });
  after(async () => {
    await server.close();
    ctx.cleanup();
  });

  test('--help', async () => {
    const r = await run(['--help'], { env: ctx.env });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /agentalarm login/);
    assert.doesNotMatch(r.stdout, /GPT|phone call/i);
  });

  test('sending before login fails with exit 3', async () => {
    const r = await run(['hello'], { env: ctx.env });
    assert.equal(r.code, 3);
    assert.match(r.stderr, /Not logged in/);
  });

  test('login with the copied text saves the key (600) and never prints it', async () => {
    const text = `Connect my AgentAlarm (reminders on my iPhone): open ${server.url}/api/setup/AAAA-BBBB and follow the instructions.`;
    const r = await run(['login', text], { env: ctx.env });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(r.stdout.startsWith(`Redeeming the one-time link at ${server.url}`), r.stdout);
    assert.match(r.stdout, /Connected as "agentalarm CLI on /);
    assert.ok(!r.stdout.includes(KEY) && !r.stderr.includes(KEY));
    const config = JSON.parse(fs.readFileSync(configPath(ctx.env), 'utf8'));
    assert.equal(config.key, KEY);
    assert.equal(config.baseUrl, server.url);
    if (process.platform !== 'win32') assert.equal(fs.statSync(configPath(ctx.env)).mode & 0o777, 0o600);
  });

  test('key prints a new key into a pipe for CI secrets and does not save it', async () => {
    const ci = tempEnv();
    try {
      const r = await run(['key', `${server.url}/api/setup/AAAA-BBBB`, '--name', 'GitHub Actions'], { env: ci.env });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.stdout, KEY);
      assert.match(r.stderr, new RegExp(`Redeeming the one-time link at ${server.url}`));
      assert.equal(server.requests.at(-1).query.name, 'GitHub Actions');
      assert.equal(fs.existsSync(configPath(ci.env)), false);
    } finally {
      ci.cleanup();
    }
  });

  test('login refuses a lookalike server without --server and sends nothing', async () => {
    const before = server.requests.length;
    const r = await run(['login', 'open https://alarm.achub.net.evil.example/api/setup/AAAA-BBBB'], { env: ctx.env });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /https:\/\/alarm\.achub\.net\.evil\.example.*--server/s);
    assert.equal(server.requests.length, before);
  });

  test('login reads the text from stdin too, and rejects text without a link', async () => {
    const r = await run(['login'], { env: ctx.env, input: 'no link here' });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /No AgentAlarm setup link/);
  });

  test('no --at sends a notification now, --ring makes it a call, --at a reminder', async () => {
    let r = await run(['Build', 'done'], { env: ctx.env });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /^Notification sent: Build done/);
    assert.deepEqual([server.requests.at(-1).body.type, server.requests.at(-1).body.title, server.requests.at(-1).body.fire_at], ['normal', 'Build done', undefined]);

    r = await run(['Call me', '--ring', '--icon', 'checkmark.circle', '--location', 'Office'], { env: ctx.env });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /^Call sent \(rings now\): Call me/);
    assert.deepEqual({ ...server.requests.at(-1).body, id: undefined }, { id: undefined, type: 'urgent', title: 'Call me', icon: 'checkmark.circle', location: 'Office' });

    r = await run(['Deploy failed', '--urgent', '--at', '2026-10-28T09:00', '--body', 'step: migrate', '--color', 'red', '--sound', 'loudalarm'], { env: ctx.env });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Reminder set for 2026-10-28T06:00:00Z \(rings\): Deploy failed/);
    const body = server.requests.at(-1).body;
    assert.deepEqual({ ...body, id: undefined }, { id: undefined, type: 'urgent', title: 'Deploy failed', body: 'step: migrate', color: 'red', sound: 'loudalarm', fire_at: '2026-10-28T09:00' });
    assert.equal(server.requests.at(-1).headers.authorization, `Bearer ${KEY}`);
  });

  test('a bad --at is a usage error; the server limit message is printed with exit 4', async () => {
    assert.equal((await run(['x', '--at', 'tomorrow-ish'], { env: ctx.env })).code, 2);
    alarmStatus = 422;
    const r = await run(['x'], { env: ctx.env });
    alarmStatus = 201;
    assert.equal(r.code, 4);
    assert.match(r.stderr, /200 active reminders \(the limit\)/);
  });

  test('AGENTALARM_KEY works without a config file (CI)', async () => {
    const ci = tempEnv({ AGENTALARM_KEY: '99|aa_cikey', AGENTALARM_URL: server.url });
    try {
      const r = await run(['CI failed', '-u'], { env: ci.env });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(server.requests.at(-1).headers.authorization, 'Bearer 99|aa_cikey');
    } finally {
      ci.cleanup();
    }
  });

  test('test and status', async () => {
    let r = await run(['test'], { env: ctx.env });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(server.requests.at(-1).body.type, 'urgent');
    r = await run(['status'], { env: ctx.env });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Connected: key "agentalarm CLI on test"/);
    assert.ok(!r.stdout.includes(KEY));
  });

  test('hook: a long Claude Code turn ends in one notification; the hook prints nothing and exits 0', async () => {
    const env = { ...ctx.env, AGENTALARM_HOOK_SYNC: '1', AGENTALARM_ONLY_WHEN_AWAY: 'false' };
    const session = { session_id: 'e2e', cwd: '/tmp/my-project', transcript_path: '/nonexistent' };
    // Pretend the prompt was 10 minutes ago.
    let r = await run(['hook', 'claude-code'], { env, input: JSON.stringify({ ...session, hook_event_name: 'UserPromptSubmit', prompt: 'p' }) });
    assert.equal(r.code, 0);
    const sessions = path.join(stateDir(env), 'sessions');
    const [file] = fs.readdirSync(sessions);
    fs.writeFileSync(path.join(sessions, file), JSON.stringify({ turnStart: Date.now() - 10 * 60_000 }));

    const before = server.requests.length;
    r = await run(['hook', 'claude-code'], { env, input: JSON.stringify({ ...session, hook_event_name: 'Stop', last_assistant_message: 'secret' }) });
    assert.deepEqual([r.code, r.stdout], [0, '']);
    const sent = server.requests.slice(before);
    assert.equal(sent.length, 1);
    assert.deepEqual([sent[0].body.type, sent[0].body.title], ['normal', 'Claude Code: task finished in my-project']);
    assert.ok(!JSON.stringify(sent[0].body).includes('secret'));
    assert.match(fs.readFileSync(path.join(stateDir(env), 'hook.log'), 'utf8'), /delivered normal/);
  });

  test('hook: garbage input, unknown agents and Cursor output never fail', async () => {
    let r = await run(['hook', 'claude-code'], { env: ctx.env, input: 'not json' });
    assert.equal(r.code, 0);
    r = await run(['hook', 'nope'], { env: ctx.env, input: '{}' });
    assert.equal(r.code, 0);
    r = await run(['hook', 'cursor'], { env: ctx.env, input: JSON.stringify({ hook_event_name: 'beforeSubmitPrompt', conversation_id: 'c' }) });
    assert.deepEqual([r.code, r.stdout], [0, '{"continue":true}\n']);
  });

  test('pause and resume', async () => {
    let r = await run(['pause', '2h'], { env: ctx.env });
    assert.equal(r.code, 0, r.stderr);
    const until = Date.parse(JSON.parse(fs.readFileSync(configPath(ctx.env), 'utf8')).pausedUntil);
    assert.ok(Math.abs(until - (Date.now() + 2 * 3_600_000)) < 60_000);
    assert.equal((await run(['pause', 'soon'], { env: ctx.env })).code, 2);
    r = await run(['resume'], { env: ctx.env });
    assert.equal(r.code, 0);
    assert.equal(JSON.parse(fs.readFileSync(configPath(ctx.env), 'utf8')).pausedUntil, undefined);
  });

  test('setup --defaults writes the hook settings; without a terminal it asks for --defaults', async () => {
    assert.equal((await run(['setup'], { env: ctx.env })).code, 2);
    const r = await run(['setup', '--defaults'], { env: ctx.env });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(fs.readFileSync(configPath(ctx.env), 'utf8')).hooks.ringOnDecision, false);
  });

  test('config set, show and unset one hook option; bad values are refused', async () => {
    let r = await run(['config', 'set', 'minTaskMinutes', '10'], { env: ctx.env });
    assert.equal(r.code, 0, r.stderr);
    r = await run(['config', 'set', 'quietHours', '23:00-08:00'], { env: ctx.env });
    assert.equal(r.code, 0, r.stderr);
    r = await run(['config'], { env: ctx.env });
    assert.deepEqual([JSON.parse(r.stdout).minTaskMinutes, JSON.parse(r.stdout).quietHours], [10, '23:00-08:00']);
    assert.equal((await run(['config', 'set', 'minTaskMinutes', 'soon'], { env: ctx.env })).code, 2);
    assert.equal((await run(['config', 'set', 'key', 'x'], { env: ctx.env })).code, 2);
    r = await run(['config', 'unset', 'minTaskMinutes'], { env: ctx.env });
    assert.equal(r.code, 0);
    assert.equal(JSON.parse((await run(['config'], { env: ctx.env })).stdout).minTaskMinutes, 3);
  });

  test('logout revokes the key and removes it, keeping the settings', async () => {
    const r = await run(['logout'], { env: ctx.env });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(server.requests.at(-1).path, '/api/auth/logout');
    const config = JSON.parse(fs.readFileSync(configPath(ctx.env), 'utf8'));
    assert.equal(config.key, undefined);
    assert.ok(config.hooks);
    saveConfig({}, ctx.env);
  });
});
