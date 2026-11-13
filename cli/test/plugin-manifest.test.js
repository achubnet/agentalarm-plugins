import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const pluginDir = new URL('../../claude-code/', import.meta.url);
const read = (file) => JSON.parse(fs.readFileSync(new URL(file, pluginDir), 'utf8'));

test('Claude Code plugin MCP server is plain remote OAuth: no headers, no helper script', () => {
  assert.deepEqual(read('.mcp.json').mcpServers.agentalarm, { type: 'http', url: 'https://alarm.achub.net/mcp' });
});

test('Claude Code plugin ships no hooks and no key option, so the plugin directory accepts it', () => {
  assert.equal(fs.existsSync(new URL('hooks/', pluginDir)), false);
  assert.equal(read('.claude-plugin/plugin.json').userConfig, undefined);
});
