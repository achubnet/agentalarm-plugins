import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CliError, EXIT } from './errors.js';

export const DEFAULT_BASE_URL = 'https://alarm.achub.net';

/** When the hooks alert. Every option is in the README; `agentalarm setup` asks the important ones. */
export const HOOK_DEFAULTS = Object.freeze({
  onlyWhenAway: true, // alert only when the computer has been idle for awayAfterMinutes
  awayAfterMinutes: 2,
  minTaskMinutes: 3, // a "task finished" alert needs the turn to have run this long
  cooldownMinutes: 5, // at most one alert per agent session in this window
  ringOnDecision: false, // "needs your decision" rings instead of a quiet notification
  quietHours: null, // "23:00-08:00": rings become quiet notifications
});

/** Environment overrides for the hook options, e.g. AGENTALARM_MIN_TASK_MINUTES=10. */
const ENV_NAMES = Object.freeze({
  onlyWhenAway: 'AGENTALARM_ONLY_WHEN_AWAY',
  awayAfterMinutes: 'AGENTALARM_AWAY_AFTER_MINUTES',
  minTaskMinutes: 'AGENTALARM_MIN_TASK_MINUTES',
  cooldownMinutes: 'AGENTALARM_COOLDOWN_MINUTES',
  ringOnDecision: 'AGENTALARM_RING_ON_DECISION',
  quietHours: 'AGENTALARM_QUIET_HOURS',
});

function xdg(env, name, fallback) {
  const value = env[name];
  return value && path.isAbsolute(value) ? value : path.join(os.homedir(), fallback);
}

export function configDir(env = process.env) {
  return path.join(xdg(env, 'XDG_CONFIG_HOME', '.config'), 'agentalarm');
}

export function configPath(env = process.env) {
  return path.join(configDir(env), 'config.json');
}

/** Hook state (turn start times, last alert per session) and the hook log. Not secret. */
export function stateDir(env = process.env) {
  return path.join(xdg(env, 'XDG_STATE_HOME', path.join('.local', 'state')), 'agentalarm');
}

/** The config file, or {} when there is none. A broken file is an error for commands, but hooks treat it as empty. */
export function loadConfig(env = process.env) {
  let text;
  try {
    text = fs.readFileSync(configPath(env), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new CliError(`Cannot read ${configPath(env)}: ${error.message}`, EXIT.FAILURE);
  }
  try {
    const config = JSON.parse(text);
    return config && typeof config === 'object' && !Array.isArray(config) ? config : {};
  } catch {
    throw new CliError(`${configPath(env)} is not valid JSON. Fix it or delete it and run "agentalarm login" again.`, EXIT.FAILURE);
  }
}

/** Writes the config readable only by the user (600, directory 700), atomically. */
export function saveConfig(config, env = process.env) {
  const file = configPath(env);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
}

export function updateConfig(change, env = process.env) {
  const config = change(loadConfig(env));
  saveConfig(config, env);
  return config;
}

/**
 * The key and the server it belongs to; a key is never sent to another key's server. AGENTALARM_KEY (CI) wins and
 * goes to AGENTALARM_URL or the default server, never to the config file's; the saved key goes to its saved server.
 */
export function credentials(config, env = process.env) {
  const trimmed = (url) => url.replace(/\/+$/, '');
  const envKey = (env.AGENTALARM_KEY || '').trim();
  if (envKey) return { key: envKey, baseUrl: trimmed(env.AGENTALARM_URL || DEFAULT_BASE_URL), fromEnv: true };
  const key = typeof config.key === 'string' ? config.key.trim() : '';
  return { key: key || null, baseUrl: trimmed(config.baseUrl || DEFAULT_BASE_URL), fromEnv: false };
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  const v = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(v)) return false;
  return undefined;
}

function parseMinutes(value) {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 7 * 24 * 60 ? n : undefined;
}

const QUIET_HOURS = /^([01]?\d|2[0-3]):([0-5]\d)\s*-\s*([01]?\d|2[0-3]):([0-5]\d)$/;

/** "23:00-08:00" → {start: 1380, end: 480} (minutes after midnight), or null. */
export function parseQuietHours(value) {
  if (typeof value !== 'string') return null;
  const m = value.trim().match(QUIET_HOURS);
  if (!m) return null;
  const start = Number(m[1]) * 60 + Number(m[2]);
  const end = Number(m[3]) * 60 + Number(m[4]);
  return start === end ? null : { start, end };
}

function parseQuietSetting(value) {
  if (value === null || value === '' || value === 'off' || value === 'none') return null;
  return parseQuietHours(value) ? String(value).trim() : undefined;
}

const PARSERS = {
  onlyWhenAway: parseBoolean,
  awayAfterMinutes: parseMinutes,
  minTaskMinutes: parseMinutes,
  cooldownMinutes: parseMinutes,
  ringOnDecision: parseBoolean,
  quietHours: parseQuietSetting,
};

/** Validates one hook option; undefined when the value is not acceptable. */
export function parseHookOption(name, value) {
  return PARSERS[name] ? PARSERS[name](value) : undefined;
}

/** Defaults, then the config file's `hooks`, then environment variables. Invalid values fall back silently. */
export function hookSettings(config, env = process.env) {
  const settings = { ...HOOK_DEFAULTS };
  const fromFile = config.hooks && typeof config.hooks === 'object' ? config.hooks : {};
  for (const name of Object.keys(HOOK_DEFAULTS)) {
    for (const raw of [fromFile[name], env[ENV_NAMES[name]]]) {
      if (raw === undefined) continue;
      const value = parseHookOption(name, raw);
      if (value !== undefined) settings[name] = value;
    }
  }
  return settings;
}

export const HOOK_ENV_NAMES = ENV_NAMES;
