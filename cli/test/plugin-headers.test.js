import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { saveConfig } from '../src/config.js';
import { tempEnv } from '../test-support/env.js';

// The Claude Code plugin's headersHelper reads the key saved by `agentalarm login`.
const SCRIPT = fileURLToPath(new URL('../../claude-code/scripts/mcp-headers.mjs', import.meta.url));
const helper = (env) => JSON.parse(execFileSync(process.execPath, [SCRIPT], { env }).toString());

test('MCP headers helper: the saved key for the server Claude Code connects to, else nothing', (t) => {
  const { env, cleanup } = tempEnv({ CLAUDE_CODE_MCP_SERVER_URL: 'https://alarm.achub.net/mcp' });
  t.after(cleanup);
  assert.deepEqual(helper(env), {});

  saveConfig({ key: '3|aa_saved', baseUrl: 'https://alarm.achub.net' }, env);
  assert.deepEqual(helper(env), { Authorization: 'Bearer 3|aa_saved' });

  // A key from another server (a local test setup) is never sent to this one.
  saveConfig({ key: '3|aa_local', baseUrl: 'http://127.0.0.1:8000' }, env);
  assert.deepEqual(helper(env), {});

  assert.deepEqual(helper({ ...env, AGENTALARM_KEY: '4|aa_env', AGENTALARM_URL: 'https://alarm.achub.net' }), { Authorization: 'Bearer 4|aa_env' });
  // AGENTALARM_KEY never pairs with the saved server, and the saved key never with AGENTALARM_URL.
  assert.deepEqual(helper({ ...env, AGENTALARM_KEY: '4|aa_env' }), { Authorization: 'Bearer 4|aa_env' });
  saveConfig({ key: '3|aa_saved', baseUrl: 'https://alarm.achub.net' }, env);
  assert.deepEqual(helper({ ...env, AGENTALARM_URL: 'http://127.0.0.1:8000' }), { Authorization: 'Bearer 3|aa_saved' });
  assert.deepEqual(helper({ ...env, AGENTALARM_KEY: '4|aa_env', AGENTALARM_URL: 'http://127.0.0.1:8000' }), {});
});
