import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { createAlarm, extractSetupUrl, me, redeemSetup, revokeKey } from './api.js';
import {
  HOOK_DEFAULTS,
  HOOK_ENV_NAMES,
  configPath,
  credentials,
  hookSettings,
  loadConfig,
  parseHookOption,
  saveConfig,
  stateDir,
  updateConfig,
} from './config.js';
import { CliError, EXIT } from './errors.js';
import { AGENTS, SessionStore, handleHook, hookOutput } from './hook.js';
import { idleMs } from './idle.js';
import { runMcpProxy } from './mcp.js';
import { askHookSettings } from './setup.js';
import { VERSION } from './version.js';

const BIN = fileURLToPath(new URL('../bin/agentalarm.js', import.meta.url));

const HELP = `agentalarm ${VERSION}: alerts on your iPhone from scripts, CI and AI agents (https://alarm.achub.net)

Usage:
  agentalarm "text" [options]       Send a notification now (the app's Notifications feed).
    -r, --ring, -u, --urgent        A call: rings like an alarm, through Silent and Focus, until Done or Snooze.
    --at <time>                     A reminder at that time instead (the app's Reminders list), e.g. 2026-10-28T09:00
                                    (your timezone in the app) or with an offset.
    -b, --body <text>               Details; line breaks and links are kept.
    -c, --color <name>              blue, red, orange, green or purple.
    -i, --icon <name>               bell, checkmark.circle, exclamationmark.triangle, calendar, sportscourt, gift,
                                    cart, airplane, heart or briefcase.
    -l, --location <text>           An address or place; the app opens it in Maps.
    -s, --sound <id>                Ring sound (with --ring), e.g. loudalarm, urgentpulse, calmpiano.
    --json                          Print the created alert as JSON.

  agentalarm login "<text from the app>"   Connect: paste the text (or link) from AgentAlarm > Connect an agent.
                                    Links to another server need --server <origin> (self-hosted only).
  agentalarm key "<text from the app>" [--name CI] | gh secret set AGENTALARM_KEY
                                    Redeem a link for CI: prints the new key into a pipe, never to a terminal.
  agentalarm setup [--defaults]     Choose when agent hooks alert you.
  agentalarm config [set <option> <value> | unset <option>]   Show or change one hook option.
  agentalarm test                   Send a test call (it rings).
  agentalarm status                 Show the connection and hook settings.
  agentalarm pause [30m|1h|2d]      Pause hook alerts (default 1h). Direct alerts still go out.
  agentalarm resume                 Resume hook alerts.
  agentalarm logout                 Revoke this computer's key and forget it.
  agentalarm hook <claude-code|cursor|codex>   Run as an agent hook (reads the event JSON on stdin).
  agentalarm mcp                    Local MCP server (stdio) that forwards to AgentAlarm with your key.

Environment: AGENTALARM_KEY (a key, for CI), AGENTALARM_<OPTION> for hook options (see the README).
Exit codes: 0 ok, 1 network or server error, 2 usage, 3 not logged in or key rejected, 4 refused by the server.`;

const VALUE_OPTIONS = {
  '--name': 'name', '--server': 'server', '--at': 'at', '--body': 'body', '-b': 'body', '--color': 'color', '-c': 'color',
  '--sound': 'sound', '-s': 'sound', '--icon': 'icon', '-i': 'icon', '--location': 'location', '-l': 'location',
};
const FLAG_OPTIONS = {
  '--urgent': 'urgent', '-u': 'urgent', '--ring': 'urgent', '-r': 'urgent',
  '--json': 'json', '--defaults': 'defaults', '--local': 'local', '--no-setup': 'noSetup',
};

export function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    const [flag, inline] = arg.startsWith('--') && arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined];
    if (VALUE_OPTIONS[flag]) {
      const value = inline ?? argv[++i];
      if (value === undefined) throw new CliError(`${flag} needs a value.`, EXIT.USAGE);
      options[VALUE_OPTIONS[flag]] = value;
    } else if (FLAG_OPTIONS[flag] && inline === undefined) {
      options[FLAG_OPTIONS[flag]] = true;
    } else if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '-v' || arg === '--version') {
      options.version = true;
    } else if (arg.startsWith('-') && arg.length > 1) {
      throw new CliError(`Unknown option ${flag}. See "agentalarm --help".`, EXIT.USAGE);
    } else {
      positional.push(arg);
    }
  }
  return { positional, options };
}

/** "30m", "1h", "2d", "90" (minutes) → ms; null when invalid. */
export function parseDuration(text) {
  const m = String(text).trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(m|min|mins|minutes?|h|hours?|d|days?)?$/);
  if (!m) return null;
  const unit = (m[2] || 'm')[0];
  const ms = Number(m[1]) * { m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  return ms > 0 && ms <= 30 * 86_400_000 ? ms : null;
}

function readStdin(stdin, { limit = 1_000_000, timeoutMs = 2000 } = {}) {
  if (stdin.isTTY) return Promise.resolve('');
  return new Promise((resolve) => {
    let data = '';
    const done = () => {
      clearTimeout(timer);
      stdin.removeAllListeners('data');
      stdin.pause();
      resolve(data);
    };
    const timer = setTimeout(done, timeoutMs);
    stdin.setEncoding('utf8');
    stdin.on('data', (chunk) => {
      data += chunk;
      if (data.length > limit) done();
    });
    stdin.on('end', done);
    stdin.on('error', done);
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Hook log: why each hook did or did not alert. No keys, no prompts, no code.

const LOG_MAX_BYTES = 256 * 1024;

export function logHook(env, line) {
  try {
    const dir = stateDir(env);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, 'hook.log');
    try {
      if (fs.statSync(file).size > LOG_MAX_BYTES) fs.renameSync(file, `${file}.1`);
    } catch {
      // No log yet.
    }
    fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`, { mode: 0o600 });
  } catch {
    // Logging must never break a hook.
  }
}

/** Sends from a detached process, so the hook exits at once and the agent never waits for the network. */
function deliverInBackground(alarm, env) {
  const child = spawn(process.execPath, [BIN, '__deliver'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...env, AGENTALARM_DELIVERY: JSON.stringify(alarm) },
  });
  child.unref();
}

async function deliver(alarm, env) {
  const creds = credentials(loadConfig(env), env);
  try {
    await createAlarm(creds, alarm);
    logHook(env, `delivered ${alarm.type}: ${alarm.title}`);
  } catch (error) {
    logHook(env, `delivery failed: ${error.message}`);
  }
}

async function runHook(agent, { stdin, stdout, env }) {
  if (!AGENTS[agent]) {
    logHook(env, `unknown agent "${agent}" (use ${Object.keys(AGENTS).join(', ')})`);
    return EXIT.OK;
  }
  const raw = await readStdin(stdin);
  let payload = {};
  try {
    payload = JSON.parse(raw || '{}');
  } catch {
    logHook(env, `${agent}: hook input is not JSON`);
  }
  stdout.write(hookOutput(agent, payload));

  try {
    let config = {};
    try {
      config = loadConfig(env);
    } catch (error) {
      logHook(env, `${agent}: ${error.message}`);
    }
    const result = await handleHook(agent, payload, {
      store: new SessionStore(stateDir(env)),
      now: () => new Date(),
      settings: hookSettings(config, env),
      pausedUntil: config.pausedUntil ?? null,
      hasKey: Boolean(credentials(config, env).key),
      idle: () => idleMs(),
      deliver: (alarm) => (env.AGENTALARM_HOOK_SYNC === '1' ? deliver(alarm, env) : deliverInBackground(alarm, env)),
    });
    logHook(env, `${agent} ${payload.hook_event_name ?? '?'}: ${result.sent ? 'alert' : 'skip'} (${result.reason})`);
  } catch (error) {
    logHook(env, `${agent}: hook error: ${error.message}`);
  }
  return EXIT.OK;
}

// ---------------------------------------------------------------------------------------------------------------

function hostLabel() {
  return os.hostname().split('.')[0].slice(0, 30) || 'this computer';
}

/** No --at: a notification now (a call with --ring). --at: a reminder at that time (the server's rule). */
function describeAlarm(alarm, requested) {
  const rings = requested.type === 'urgent';
  if (requested.fire_at) {
    const when = alarm.rings_at ? ` for ${alarm.rings_at}` : '';
    return `Reminder set${when}${rings ? ' (rings)' : ''}: ${requested.title}`;
  }
  return `${rings ? 'Call sent (rings now)' : 'Notification sent'}: ${requested.title}`;
}

async function send(title, options, io) {
  if (!title) throw new CliError('Nothing to send. Usage: agentalarm "text" [--ring] [--at <time>]', EXIT.USAGE);
  if (options.at !== undefined && !Number.isFinite(Date.parse(options.at))) {
    throw new CliError(`--at: "${options.at}" is not a date and time like 2026-10-28T09:00.`, EXIT.USAGE);
  }
  const alarm = { type: options.urgent ? 'urgent' : 'normal', title };
  for (const field of ['body', 'color', 'sound', 'icon', 'location']) if (options[field] !== undefined) alarm[field] = options[field];
  if (options.at !== undefined) alarm.fire_at = options.at;

  const created = await createAlarm(credentials(loadConfig(io.env), io.env), alarm);
  io.stdout.write(options.json ? `${JSON.stringify(created, null, 2)}\n` : `${describeAlarm(created, alarm)}\n`);
  return EXIT.OK;
}

function interactive(io) {
  return Boolean(io.stdin.isTTY && io.stdout.isTTY);
}

async function withPrompt(io, fn) {
  const rl = readline.createInterface({ input: io.stdin, output: io.stdout });
  try {
    return await fn((question) => rl.question(question));
  } finally {
    rl.close();
  }
}

async function setup(options, io) {
  const config = loadConfig(io.env);
  let hooks;
  if (options.defaults) {
    hooks = { ...HOOK_DEFAULTS };
  } else if (!interactive(io)) {
    throw new CliError('Run "agentalarm setup" in a terminal, or "agentalarm setup --defaults".', EXIT.USAGE);
  } else {
    hooks = await withPrompt(io, (ask) => askHookSettings(ask, hookSettings(config, {}), (line) => io.stdout.write(`${line}\n`)));
  }
  saveConfig({ ...config, hooks }, io.env);
  io.stdout.write(`Saved to ${configPath(io.env)}:\n${JSON.stringify(hooks, null, 2)}\n`);
  return EXIT.OK;
}

async function setupUrlFrom(positional, options, io, announce) {
  let text = positional.join(' ');
  if (!text && !io.stdin.isTTY) text = await readStdin(io.stdin, { limit: 64_000, timeoutMs: 10_000 });
  const setupUrl = extractSetupUrl(text, { server: options.server });
  if (!setupUrl) {
    throw new CliError('No AgentAlarm setup link found. In the app: Settings > Connected Agents > Connect, then: agentalarm login "<the copied text>"', EXIT.USAGE);
  }
  announce(`Redeeming the one-time link at ${new URL(setupUrl).origin} ...\n`);
  return setupUrl;
}

/** A key for CI secrets: written only into a pipe, so it does not land in the terminal's scrollback. */
async function printKey(positional, options, io) {
  if (io.stdout.isTTY) {
    throw new CliError('The key is printed only into a pipe, e.g.: agentalarm key "<text>" | gh secret set AGENTALARM_KEY', EXIT.USAGE);
  }
  // stdout is the pipe that receives the key, so the origin goes to stderr.
  const setupUrl = await setupUrlFrom(positional, options, io, (line) => io.stderr.write(line));
  const redeemed = await redeemSetup(setupUrl, options.name || `agentalarm CI key from ${hostLabel()}`);
  io.stdout.write(redeemed.key);
  io.stderr.write(`Created the key "${redeemed.name}". Revoke it in the app under Connected Agents.\n`);
  return EXIT.OK;
}

async function login(positional, options, io) {
  const setupUrl = await setupUrlFrom(positional, options, io, (line) => io.stdout.write(line));
  const redeemed = await redeemSetup(setupUrl, options.name || `agentalarm CLI on ${hostLabel()}`);
  updateConfig((config) => ({ ...config, key: redeemed.key, keyName: redeemed.name, baseUrl: redeemed.baseUrl }), io.env);

  const out = (line = '') => io.stdout.write(`${line}\n`);
  out(`Connected as "${redeemed.name}". The key is saved in ${configPath(io.env)} (readable only by you).`);
  if (redeemed.readOnly) out('Note: this key is read-only, so it cannot send alerts. Connect again without "read only".');
  if (io.env.AGENTALARM_KEY) out('Note: AGENTALARM_KEY is set in this shell and wins over the saved key.');

  if (!options.noSetup && interactive(io)) {
    const answer = await withPrompt(io, (ask) => ask('Choose when agent hooks alert you now? [Y/n] '));
    if (!/^n/i.test(answer.trim())) return setup({}, io);
  }
  out('Next: "agentalarm setup" chooses when hooks alert you; "agentalarm test" sends a test alert.');
  return EXIT.OK;
}

async function status(io) {
  const config = loadConfig(io.env);
  const creds = credentials(config, io.env);
  const out = (line = '') => io.stdout.write(`${line}\n`);
  out(`Config: ${configPath(io.env)}`);
  out(`Server: ${creds.baseUrl}`);
  if (!creds.key) {
    out('Not logged in. Run: npx agentalarm login "<the text copied from the AgentAlarm app>"');
    return EXIT.AUTH;
  }
  const info = await me(creds);
  const keyName = info.key && info.key.name ? info.key.name : config.keyName;
  out(`Connected: key "${keyName}"${creds.fromEnv ? ' (from AGENTALARM_KEY)' : ''}, timezone ${info.timezone ?? 'unknown'}`);
  if (info.push_registered === false) out('Warning: no iPhone registered for pushes yet. Open the AgentAlarm app once.');
  const paused = Date.parse(config.pausedUntil ?? '');
  out(Number.isFinite(paused) && paused > Date.now() ? `Hooks: paused until ${new Date(paused).toLocaleString()}` : 'Hooks: active');
  out(`Hook settings: ${JSON.stringify(hookSettings(config, io.env))}`);
  return EXIT.OK;
}

async function logout(options, io) {
  const config = loadConfig(io.env);
  if (!config.key) {
    io.stdout.write('Not logged in on this computer.\n');
    return EXIT.OK;
  }
  let revoked = false;
  if (!options.local) {
    try {
      await revokeKey({ key: config.key, baseUrl: credentials(config, {}).baseUrl });
      revoked = true;
    } catch (error) {
      io.stderr.write(`Could not revoke the key on the server (${error.message}). Revoke "${config.keyName ?? 'agentalarm CLI'}" in the app.\n`);
    }
  }
  const { key, keyName, ...rest } = config;
  saveConfig(rest, io.env);
  io.stdout.write(`Logged out: the key is ${revoked ? 'revoked and ' : ''}removed from this computer.\n`);
  return EXIT.OK;
}

function configCommand(args, io) {
  const [action, name, ...value] = args;
  const out = (line) => io.stdout.write(`${line}\n`);
  if (action === undefined) {
    out(JSON.stringify(hookSettings(loadConfig(io.env), io.env), null, 2));
    return EXIT.OK;
  }
  const names = Object.keys(HOOK_DEFAULTS);
  if (!['set', 'unset'].includes(action) || !names.includes(name) || (action === 'set' && value.length === 0)) {
    throw new CliError(`Usage: agentalarm config set <option> <value> | unset <option>. Options: ${names.join(', ')}.`, EXIT.USAGE);
  }
  if (action === 'unset') {
    updateConfig((config) => {
      const { [name]: removed, ...hooks } = config.hooks ?? {};
      return { ...config, hooks };
    }, io.env);
    out(`${name} is back to the default (${JSON.stringify(HOOK_DEFAULTS[name])}).`);
    return EXIT.OK;
  }
  const parsed = parseHookOption(name, value.join(' '));
  if (parsed === undefined) throw new CliError(`Invalid value for ${name}: "${value.join(' ')}".`, EXIT.USAGE);
  updateConfig((config) => ({ ...config, hooks: { ...(config.hooks ?? {}), [name]: parsed } }), io.env);
  out(`${name} = ${JSON.stringify(parsed)}${io.env[HOOK_ENV_NAMES[name]] !== undefined ? ` (note: ${HOOK_ENV_NAMES[name]} is set and wins)` : ''}`);
  return EXIT.OK;
}

function pause(positional, io) {
  const ms = parseDuration(positional[0] ?? '1h');
  if (ms === null) throw new CliError('Usage: agentalarm pause [30m|1h|2d] (at most 30 days).', EXIT.USAGE);
  const until = new Date(Date.now() + ms).toISOString();
  updateConfig((config) => ({ ...config, pausedUntil: until }), io.env);
  io.stdout.write(`Hook alerts paused until ${new Date(until).toLocaleString()}. "agentalarm resume" ends the pause.\n`);
  return EXIT.OK;
}

function resume(io) {
  updateConfig(({ pausedUntil, ...config }) => config, io.env);
  io.stdout.write('Hook alerts resumed.\n');
  return EXIT.OK;
}

async function deliverFromEnv(io) {
  try {
    await deliver(JSON.parse(io.env.AGENTALARM_DELIVERY || ''), io.env);
  } catch (error) {
    logHook(io.env, `delivery failed: ${error.message}`);
  }
  return EXIT.OK;
}

export async function main(argv, io = { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr, env: process.env }) {
  try {
    const [command, ...rest] = argv;
    // Hooks never fail the agent: no option parsing, no error exit.
    if (command === 'hook') return await runHook(rest[0], io);
    if (command === '__deliver') return await deliverFromEnv(io);
    if (command === 'mcp') {
      await runMcpProxy({ creds: credentials(loadConfig(io.env), io.env), input: io.stdin, output: io.stdout });
      return EXIT.OK;
    }

    const { positional, options } = parseArgs(argv);
    if (options.version) {
      io.stdout.write(`${VERSION}\n`);
      return EXIT.OK;
    }
    if (options.help || argv.length === 0 || command === 'help') {
      io.stdout.write(`${HELP}\n`);
      return argv.length === 0 ? EXIT.USAGE : EXIT.OK;
    }

    const [name, ...args] = positional;
    switch (name) {
      case 'login':
        return await login(args, options, io);
      case 'key':
        return await printKey(args, options, io);
      case 'logout':
        return await logout(options, io);
      case 'status':
        return await status(io);
      case 'setup':
        return await setup(options, io);
      case 'config':
        return configCommand(args, io);
      case 'pause':
        return pause(args, io);
      case 'resume':
        return resume(io);
      case 'test':
        return await send('AgentAlarm test: your agents can reach you', { ...options, urgent: true, body: 'Sent by "agentalarm test". Tap Done to stop the ring.' }, io);
      case 'send':
        return await send(args.join(' ').trim(), options, io);
      default:
        return await send(positional.join(' ').trim(), options, io);
    }
  } catch (error) {
    if (error instanceof CliError) {
      io.stderr.write(`agentalarm: ${error.message}\n`);
      return error.exitCode;
    }
    io.stderr.write(`agentalarm: unexpected error: ${error.message}\n`);
    return EXIT.FAILURE;
  }
}
