import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseQuietHours } from './config.js';

/**
 * Hooks turn agent events into alerts, deterministically and without spam:
 *  - "prompt"   (the user sent a message): remember when the turn started;
 *  - "finished" (the agent stopped): a quiet notification if the turn ran at least minTaskMinutes;
 *  - "decision" (the agent waits for a permission or an answer): a quiet notification, or a ring with ringOnDecision.
 * Every alert also needs: not paused, outside the session's cooldown, and (onlyWhenAway) the computer idle.
 */

export const AGENTS = Object.freeze({
  'claude-code': 'Claude Code',
  cursor: 'Cursor',
  codex: 'Codex',
});

/** Claude Code notification types that mean "the agent is blocked on you". idle_prompt follows a Stop: skipped. */
const DECISION_NOTIFICATIONS = new Set([
  'permission_prompt',
  'elicitation_dialog',
  'elicitation_url_dialog',
  'agent_needs_input',
]);

function projectName(dir) {
  if (typeof dir !== 'string' || dir.trim() === '') return null;
  const name = path.basename(dir.replace(/[\\/]+$/, ''));
  return cleanText(name, 60) || null;
}

/** One line, no control or format characters, at most `max` characters. */
export function cleanText(text, max) {
  const line = String(text)
    .replace(/[\s\p{Z}]+/gu, ' ')
    .replace(/[\p{Cc}\p{Cf}]+/gu, '')
    .trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** The agent's hook payload → {event, sessionId, project, label, failed?, transcriptPath?}. */
export function normalizeEvent(agent, payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const label = AGENTS[agent];
  const base = { event: 'ignore', label, sessionId: String(p.session_id ?? p.conversation_id ?? 'default') };

  if (agent === 'cursor') {
    const roots = Array.isArray(p.workspace_roots) ? p.workspace_roots : [];
    const event = { ...base, project: projectName(roots[0]) };
    switch (p.hook_event_name) {
      case 'beforeSubmitPrompt':
        return { ...event, event: 'prompt' };
      case 'stop':
        // "aborted" means the user stopped it: they are at the computer.
        if (p.status === 'completed') return { ...event, event: 'finished' };
        if (p.status === 'error') return { ...event, event: 'finished', failed: true };
        return event;
      default:
        return event;
    }
  }

  const event = {
    ...base,
    project: projectName(p.cwd),
    transcriptPath: typeof p.transcript_path === 'string' ? p.transcript_path : null,
  };
  switch (p.hook_event_name) {
    case 'UserPromptSubmit':
      return { ...event, event: 'prompt' };
    case 'Stop':
      return { ...event, event: 'finished' };
    case 'PermissionRequest': // Codex
      return agent === 'codex' ? { ...event, event: 'decision' } : event;
    case 'Notification': {
      const type = p.notification_type;
      if (DECISION_NOTIFICATIONS.has(type)) return { ...event, event: 'decision' };
      // Versions without notification_type: only the permission prompt says "permission".
      if (type === undefined && /permission/i.test(String(p.message ?? ''))) return { ...event, event: 'decision' };
      return event;
    }
    default:
      return event; // SubagentStop and others: intermediate steps, never an alert
  }
}

function minutes(ms) {
  return ms / 60_000;
}

export function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 60_000));
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Whether `now` (local time) falls in "HH:MM-HH:MM"; the range may cross midnight. */
export function inQuietHours(quietHours, now) {
  const range = parseQuietHours(quietHours);
  if (!range) return false;
  const m = now.getHours() * 60 + now.getMinutes();
  return range.start < range.end ? m >= range.start && m < range.end : m >= range.start || m < range.end;
}

function titleFor(event, where) {
  if (event.event === 'decision') return `${event.label} needs your decision${where}`;
  if (event.failed) return `${event.label}: task stopped with an error${where}`;
  return `${event.label}: task finished${where}`;
}

/**
 * The decision, before the idle check: {send: false, reason} or {send: true, alarm, reason}.
 * Pure: everything it needs is passed in (`now` is a Date, times in ms).
 */
export function evaluate({ event, settings, session = {}, pausedUntil = null, now, durationMs = null }) {
  const t = now.getTime();
  if (event.event !== 'finished' && event.event !== 'decision') return { send: false, reason: 'not an alert event' };

  const paused = pausedUntil ? Date.parse(pausedUntil) : NaN;
  if (Number.isFinite(paused) && paused > t) return { send: false, reason: `paused until ${new Date(paused).toISOString()}` };

  if (event.event === 'finished') {
    if (durationMs === null) return { send: false, reason: 'turn start unknown' };
    if (minutes(durationMs) < settings.minTaskMinutes) {
      return { send: false, reason: `task took ${formatDuration(durationMs)} (< ${settings.minTaskMinutes} min)` };
    }
  }

  const last = Number(session.lastAlertAt);
  if (Number.isFinite(last) && t - last < settings.cooldownMinutes * 60_000 && t >= last) {
    return { send: false, reason: `cooldown: alerted ${formatDuration(t - last)} ago` };
  }

  let type = event.event === 'decision' && settings.ringOnDecision ? 'urgent' : 'normal';
  let reason = event.event;
  if (type === 'urgent' && settings.quietHours && inQuietHours(settings.quietHours, now)) {
    type = 'normal';
    reason += ', quiet hours: notification instead of a ring';
  }

  const where = event.project ? ` in ${event.project}` : '';
  // A notification now (no fire_at): the app's feed, quiet unless it rings.
  const alarm = { type, title: cleanText(titleFor(event, where), 120) };
  if (event.event === 'finished') {
    alarm.body = `Took ${formatDuration(durationMs)}.`;
    alarm.icon = event.failed ? 'exclamationmark.triangle' : 'checkmark.circle';
  }
  return { send: true, alarm, reason };
}

/** onlyWhenAway: idle below awayAfterMinutes means the user is at the computer. Unknown idle counts as away. */
export function awayCheck(settings, idle) {
  if (!settings.onlyWhenAway) return { away: true, reason: 'onlyWhenAway is off' };
  if (idle === null || idle === undefined) return { away: true, reason: 'idle time unknown' };
  if (minutes(idle) < settings.awayAfterMinutes) {
    return { away: false, reason: `user active (idle ${Math.round(idle / 1000)} s < ${settings.awayAfterMinutes} min)` };
  }
  return { away: true, reason: `idle ${formatDuration(idle)}` };
}

// ---------------------------------------------------------------------------------------------------------------
// Session state: one small JSON file per agent session, so concurrent sessions never share a file.

const STATE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export class SessionStore {
  constructor(dir) {
    this.dir = path.join(dir, 'sessions');
  }

  file(agent, sessionId) {
    const id = createHash('sha256').update(`${agent}\0${sessionId}`).digest('hex').slice(0, 32);
    return path.join(this.dir, `${id}.json`);
  }

  read(agent, sessionId) {
    try {
      const data = JSON.parse(fs.readFileSync(this.file(agent, sessionId), 'utf8'));
      return data && typeof data === 'object' ? data : {};
    } catch {
      return {};
    }
  }

  write(agent, sessionId, data) {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const file = this.file(agent, sessionId);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  /** Drops state of sessions untouched for a week. */
  prune(now) {
    let names;
    try {
      names = fs.readdirSync(this.dir);
    } catch {
      return;
    }
    for (const name of names) {
      const file = path.join(this.dir, name);
      try {
        if (now - fs.statSync(file).mtimeMs > STATE_MAX_AGE_MS) fs.unlinkSync(file);
      } catch {
        // Another hook removed it first.
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Fallback turn start from the transcript, for sessions whose prompt hook did not run (e.g. installed mid-session).

const TRANSCRIPT_TAIL_BYTES = 2 * 1024 * 1024;

function isUserPrompt(entry) {
  // Claude Code: {type: "user", message: {content}, timestamp}; tool results are "user" entries too.
  if (entry.type === 'user' && !entry.isMeta && entry.message) {
    const content = entry.message.content;
    if (typeof content === 'string') return true;
    if (Array.isArray(content)) return content.some((part) => part && part.type === 'text');
    return false;
  }
  // Codex: {type: "event_msg", payload: {type: "user_message"}, timestamp}.
  return entry.type === 'event_msg' && entry.payload && entry.payload.type === 'user_message';
}

/** The time of the last user prompt in a JSONL transcript, in ms; null when it cannot be found. */
export function lastPromptTime(transcriptPath) {
  if (!transcriptPath) return null;
  let fd;
  try {
    fd = fs.openSync(transcriptPath, 'r');
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, TRANSCRIPT_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, size - length);
    const lines = buffer.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"timestamp"')) continue;
      let entry;
      try {
        entry = JSON.parse(lines[i]);
      } catch {
        continue; // the first line of the tail is usually cut
      }
      if (entry && isUserPrompt(entry)) {
        const time = Date.parse(entry.timestamp);
        return Number.isFinite(time) ? time : null;
      }
    }
  } catch {
    // No transcript or unreadable: unknown.
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------

/** What the agent expects on stdout from this hook (nothing for Claude Code and Codex). */
export function hookOutput(agent, payload) {
  if (agent !== 'cursor') return '';
  return payload && payload.hook_event_name === 'beforeSubmitPrompt' ? '{"continue":true}\n' : '{}\n';
}

/**
 * Runs one hook: state, decision, idle check, delivery. Never throws; returns {sent, reason} for logs and tests.
 * deps: {store, now, settings, pausedUntil, hasKey, idle: async () => ms|null, deliver: async (alarm) => void}
 */
export async function handleHook(agent, payload, deps) {
  const now = deps.now();
  const t = now.getTime();
  const event = normalizeEvent(agent, payload);

  if (event.event === 'prompt') {
    const session = deps.store.read(agent, event.sessionId);
    deps.store.write(agent, event.sessionId, { ...session, turnStart: t });
    deps.store.prune(t);
    return { sent: false, reason: 'turn started' };
  }
  if (event.event === 'ignore') return { sent: false, reason: 'not an alert event' };
  if (!deps.hasKey) return { sent: false, reason: 'not logged in' };

  const session = deps.store.read(agent, event.sessionId);
  let durationMs = null;
  if (event.event === 'finished') {
    const start = Number.isFinite(session.turnStart) ? session.turnStart : lastPromptTime(event.transcriptPath);
    durationMs = start !== null && start <= t ? t - start : null;
  }

  const verdict = evaluate({ event, settings: deps.settings, session, pausedUntil: deps.pausedUntil, now, durationMs });
  if (!verdict.send) return { sent: false, reason: verdict.reason };

  const away = awayCheck(deps.settings, deps.settings.onlyWhenAway ? await deps.idle() : null);
  if (!away.away) return { sent: false, reason: away.reason };

  // Recorded before delivery, so a second event right after cannot alert twice.
  deps.store.write(agent, event.sessionId, { ...session, lastAlertAt: t });
  await deps.deliver(verdict.alarm);
  return { sent: true, reason: `${verdict.reason}; ${away.reason}`, alarm: verdict.alarm };
}
