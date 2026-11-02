import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { VERSION } from '../src/version.js';

const read = (file) => JSON.parse(fs.readFileSync(new URL(`../../claude-code/${file}`, import.meta.url), 'utf8'));

test('Claude Code plugin hooks run this exact CLI version through npx', () => {
  const commands = Object.values(read('hooks/hooks.json').hooks).flatMap((groups) => groups.flatMap((g) => g.hooks.map((h) => h.command)));
  assert.ok(commands.length > 0);
  for (const command of commands) assert.equal(command, `npx -y agentalarm@${VERSION} hook claude-code`);
});

test('Claude Code plugin MCP server is plain remote OAuth: no headers, no helper script', () => {
  assert.deepEqual(read('.mcp.json').mcpServers.agentalarm, { type: 'http', url: 'https://alarm.achub.net/mcp' });
});

test('Claude Code plugin asks for the hooks key as a sensitive option the CLI reads', () => {
  const option = read('.claude-plugin/plugin.json').userConfig.agentalarm_key;
  assert.equal(option.type, 'string');
  assert.equal(option.sensitive, true);
});
