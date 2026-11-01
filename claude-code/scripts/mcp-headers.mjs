#!/usr/bin/env node
// headersHelper for the plugin's AgentAlarm MCP server: prints {"Authorization": "Bearer <key>"} from
// `agentalarm login` (or AGENTALARM_KEY), so the key never sits in Claude Code's settings. Prints {} when there is
// no key, or when the saved key belongs to another server than the one Claude Code connects to.
// Kept dependency-free and in sync with the CLI's config location (cli/src/config.js).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_BASE_URL = 'https://alarm.achub.net';

function configFile(env) {
  const base = env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : path.join(os.homedir(), '.config');
  return path.join(base, 'agentalarm', 'config.json');
}

function origin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function headers(env = process.env) {
  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(configFile(env), 'utf8')) ?? {};
  } catch {
    // Not logged in yet.
  }
  // A key goes only to its own server: AGENTALARM_KEY with AGENTALARM_URL (or the default), the saved key with its
  // saved server; never one's key with the other's server.
  const envKey = (env.AGENTALARM_KEY || '').trim();
  const key = envKey || (typeof config.key === 'string' ? config.key.trim() : '');
  const keyOrigin = origin(envKey ? env.AGENTALARM_URL || DEFAULT_BASE_URL : config.baseUrl || DEFAULT_BASE_URL);
  const serverOrigin = origin(env.CLAUDE_CODE_MCP_SERVER_URL || `${DEFAULT_BASE_URL}/mcp`);
  return key && keyOrigin && keyOrigin === serverOrigin ? { Authorization: `Bearer ${key}` } : {};
}

process.stdout.write(`${JSON.stringify(headers())}\n`);
