import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { HOOK_DEFAULTS, configPath, credentials, hookSettings, loadConfig, parseQuietHours, saveConfig, stateDir } from '../src/config.js';
import { tempEnv } from '../test-support/env.js';

test('config lives under XDG_CONFIG_HOME and is readable only by the user', (t) => {
  const { env, dir, cleanup } = tempEnv();
  t.after(cleanup);
  assert.equal(configPath(env), path.join(dir, 'config', 'agentalarm', 'config.json'));
  assert.equal(stateDir(env), path.join(dir, 'state', 'agentalarm'));

  saveConfig({ key: '1|aa_secret' }, env);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(configPath(env)).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(configPath(env))).mode & 0o777, 0o700);
  }
  assert.deepEqual(loadConfig(env), { key: '1|aa_secret' });
});

test('an existing file that was too open becomes 600 on save', (t) => {
  if (process.platform === 'win32') return t.skip('POSIX modes');
  const { env, cleanup } = tempEnv();
  t.after(cleanup);
  fs.mkdirSync(path.dirname(configPath(env)), { recursive: true });
  fs.writeFileSync(configPath(env), '{}', { mode: 0o644 });
  saveConfig({ key: 'x' }, env);
  assert.equal(fs.statSync(configPath(env)).mode & 0o777, 0o600);
});

test('a missing config is empty, a broken one is an error', (t) => {
  const { env, cleanup } = tempEnv();
  t.after(cleanup);
  assert.deepEqual(loadConfig(env), {});
  fs.mkdirSync(path.dirname(configPath(env)), { recursive: true });
  fs.writeFileSync(configPath(env), '{nope');
  assert.throws(() => loadConfig(env), /not valid JSON/);
});

test('a key always goes to the server it belongs to: env key with env URL or the default, saved key with its URL', () => {
  const saved = { key: 'saved', baseUrl: 'https://tampered.example' };
  assert.deepEqual(credentials(saved, { AGENTALARM_KEY: 'ci' }), { key: 'ci', baseUrl: 'https://alarm.achub.net', fromEnv: true });
  assert.deepEqual(credentials(saved, { AGENTALARM_KEY: 'ci', AGENTALARM_URL: 'https://self.hosted/' }), { key: 'ci', baseUrl: 'https://self.hosted', fromEnv: true });
  assert.deepEqual(credentials(saved, {}), { key: 'saved', baseUrl: 'https://tampered.example', fromEnv: false });
  assert.deepEqual(credentials(saved, { AGENTALARM_URL: 'https://elsewhere.example' }), { key: 'saved', baseUrl: 'https://tampered.example', fromEnv: false });
});

test('AGENTALARM_KEY wins over the saved key', () => {
  assert.equal(credentials({ key: 'saved' }, { AGENTALARM_KEY: 'from-env' }).key, 'from-env');
  assert.equal(credentials({ key: 'saved' }, {}).key, 'saved');
  assert.equal(credentials({}, {}).key, null);
  assert.equal(credentials({}, {}).baseUrl, 'https://alarm.achub.net');
});

test('the Claude Code plugin key option: after AGENTALARM_KEY, before the saved key, never to the saved server', () => {
  const saved = { key: 'saved', baseUrl: 'http://127.0.0.1:8000' };
  const plugin = { CLAUDE_PLUGIN_OPTION_AGENTALARM_KEY: ' plugin ' };
  assert.deepEqual(credentials(saved, plugin), { key: 'plugin', baseUrl: 'https://alarm.achub.net', fromEnv: true });
  assert.equal(credentials(saved, { ...plugin, AGENTALARM_KEY: 'ci' }).key, 'ci');
  assert.equal(credentials(saved, { CLAUDE_PLUGIN_OPTION_AGENTALARM_KEY: '' }).key, 'saved');
  assert.equal(credentials({}, plugin).key, 'plugin');
});

test('hook settings: defaults, then the file, then the environment; bad values are ignored', () => {
  assert.deepEqual(hookSettings({}, {}), HOOK_DEFAULTS);
  assert.equal(HOOK_DEFAULTS.ringOnDecision, false);
  assert.equal(HOOK_DEFAULTS.onlyWhenAway, true);

  const settings = hookSettings(
    { hooks: { minTaskMinutes: 10, cooldownMinutes: 'soon', quietHours: '23:00-08:00', onlyWhenAway: false } },
    { AGENTALARM_MIN_TASK_MINUTES: '1', AGENTALARM_RING_ON_DECISION: 'yes', AGENTALARM_AWAY_AFTER_MINUTES: '-3' },
  );
  assert.equal(settings.minTaskMinutes, 1);
  assert.equal(settings.cooldownMinutes, HOOK_DEFAULTS.cooldownMinutes);
  assert.equal(settings.quietHours, '23:00-08:00');
  assert.equal(settings.onlyWhenAway, false);
  assert.equal(settings.ringOnDecision, true);
  assert.equal(settings.awayAfterMinutes, HOOK_DEFAULTS.awayAfterMinutes);
});

test('quiet hours format', () => {
  assert.deepEqual(parseQuietHours('23:00-08:00'), { start: 1380, end: 480 });
  assert.deepEqual(parseQuietHours('9:30 - 17:00'), { start: 570, end: 1020 });
  assert.equal(parseQuietHours('25:00-08:00'), null);
  assert.equal(parseQuietHours('08:00-08:00'), null);
  assert.equal(parseQuietHours('night'), null);
});
