import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { HOOK_DEFAULTS } from '../src/config.js';
import {
  SessionStore,
  awayCheck,
  cleanText,
  evaluate,
  formatDuration,
  handleHook,
  hookOutput,
  inQuietHours,
  lastPromptTime,
  normalizeEvent,
} from '../src/hook.js';
import { tempEnv } from '../test-support/env.js';

const MIN = 60_000;
const NOW = new Date(2026, 9, 27, 14, 0, 0); // local time
const settings = (over = {}) => ({ ...HOOK_DEFAULTS, ...over });

const claude = (event, extra = {}) => ({
  session_id: 'sess-1',
  transcript_path: '/nonexistent/transcript.jsonl',
  cwd: '/Users/alex/projects/my-project',
  hook_event_name: event,
  ...extra,
});

describe('normalizeEvent', () => {
  test('Claude Code', () => {
    assert.equal(normalizeEvent('claude-code', claude('UserPromptSubmit', { prompt: 'secret stuff' })).event, 'prompt');
    const stop = normalizeEvent('claude-code', claude('Stop', { last_assistant_message: 'API_KEY=123' }));
    assert.deepEqual([stop.event, stop.project, stop.label, stop.sessionId], ['finished', 'my-project', 'Claude Code', 'sess-1']);
    assert.equal(normalizeEvent('claude-code', claude('Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' })).event, 'decision');
    assert.equal(normalizeEvent('claude-code', claude('Notification', { notification_type: 'elicitation_dialog' })).event, 'decision');
    assert.equal(normalizeEvent('claude-code', claude('Notification', { notification_type: 'idle_prompt' })).event, 'ignore');
    assert.equal(normalizeEvent('claude-code', claude('Notification', { notification_type: 'auth_success' })).event, 'ignore');
    assert.equal(normalizeEvent('claude-code', claude('Notification', { message: 'Claude needs your permission to use Bash' })).event, 'decision');
    assert.equal(normalizeEvent('claude-code', claude('SubagentStop')).event, 'ignore');
    assert.equal(normalizeEvent('claude-code', claude('PermissionRequest')).event, 'ignore');
  });

  test('Cursor', () => {
    const base = { conversation_id: 'c1', workspace_roots: ['/home/me/shop/'] };
    assert.equal(normalizeEvent('cursor', { ...base, hook_event_name: 'beforeSubmitPrompt' }).event, 'prompt');
    const done = normalizeEvent('cursor', { ...base, hook_event_name: 'stop', status: 'completed' });
    assert.deepEqual([done.event, done.project, done.sessionId, done.label], ['finished', 'shop', 'c1', 'Cursor']);
    assert.equal(normalizeEvent('cursor', { ...base, hook_event_name: 'stop', status: 'error' }).failed, true);
    assert.equal(normalizeEvent('cursor', { ...base, hook_event_name: 'stop', status: 'aborted' }).event, 'ignore');
  });

  test('Codex', () => {
    assert.equal(normalizeEvent('codex', claude('UserPromptSubmit')).event, 'prompt');
    assert.equal(normalizeEvent('codex', claude('Stop')).event, 'finished');
    assert.equal(normalizeEvent('codex', claude('PermissionRequest', { tool_name: 'shell' })).event, 'decision');
  });

  test('garbage input is ignored', () => {
    assert.equal(normalizeEvent('claude-code', null).event, 'ignore');
    assert.equal(normalizeEvent('cursor', 'x').event, 'ignore');
  });
});

describe('evaluate', () => {
  const finished = normalizeEvent('claude-code', claude('Stop'));
  const decision = normalizeEvent('claude-code', claude('Notification', { notification_type: 'permission_prompt', message: 'needs permission for rm -rf secrets/' }));

  test('a finished task is a quiet notification with a short title and no agent text', () => {
    const r = evaluate({ event: finished, settings: settings(), now: NOW, durationMs: 42 * MIN });
    assert.equal(r.send, true);
    // No fire_at: a notification now, in the app's feed.
    assert.deepEqual(r.alarm, { type: 'normal', title: 'Claude Code: task finished in my-project', body: 'Took 42 min.', icon: 'checkmark.circle' });
  });

  test('a long task still only notifies: hooks never ring by default', () => {
    assert.equal(evaluate({ event: finished, settings: settings(), now: NOW, durationMs: 5 * 60 * MIN }).alarm.type, 'normal');
  });

  test('short tasks and unknown durations do not alert', () => {
    assert.match(evaluate({ event: finished, settings: settings(), now: NOW, durationMs: 2 * MIN }).reason, /< 3 min/);
    assert.equal(evaluate({ event: finished, settings: settings(), now: NOW, durationMs: 3 * MIN }).send, true);
    assert.equal(evaluate({ event: finished, settings: settings({ minTaskMinutes: 10 }), now: NOW, durationMs: 9 * MIN }).send, false);
    assert.equal(evaluate({ event: finished, settings: settings(), now: NOW, durationMs: null }).send, false);
  });

  test('needs your decision: a notification by default, without the message text, whatever the duration', () => {
    const r = evaluate({ event: decision, settings: settings(), now: NOW });
    assert.deepEqual(r.alarm, { type: 'normal', title: 'Claude Code needs your decision in my-project' });
    assert.ok(!JSON.stringify(r.alarm).includes('rm -rf'));
  });

  test('ringOnDecision makes it ring, except in quiet hours', () => {
    assert.equal(evaluate({ event: decision, settings: settings({ ringOnDecision: true }), now: NOW }).alarm.type, 'urgent');
    const night = new Date(2026, 9, 27, 23, 30);
    const quiet = evaluate({ event: decision, settings: settings({ ringOnDecision: true, quietHours: '23:00-08:00' }), now: night });
    assert.equal(quiet.alarm.type, 'normal');
    assert.match(quiet.reason, /quiet hours/);
    assert.equal(evaluate({ event: decision, settings: settings({ ringOnDecision: true, quietHours: '23:00-08:00' }), now: NOW }).alarm.type, 'urgent');
  });

  test('cooldown: one alert per session per cooldownMinutes', () => {
    const session = { lastAlertAt: NOW.getTime() - 4 * MIN };
    assert.match(evaluate({ event: decision, settings: settings(), session, now: NOW }).reason, /cooldown/);
    assert.equal(evaluate({ event: decision, settings: settings(), session: { lastAlertAt: NOW.getTime() - 5 * MIN }, now: NOW }).send, true);
    assert.equal(evaluate({ event: decision, settings: settings({ cooldownMinutes: 0 }), session, now: NOW }).send, true);
  });

  test('pause', () => {
    const pausedUntil = new Date(NOW.getTime() + 30 * MIN).toISOString();
    assert.match(evaluate({ event: decision, settings: settings(), pausedUntil, now: NOW }).reason, /paused until/);
    const ended = new Date(NOW.getTime() - MIN).toISOString();
    assert.equal(evaluate({ event: decision, settings: settings(), pausedUntil: ended, now: NOW }).send, true);
  });

  test('Cursor error and missing project', () => {
    const failed = normalizeEvent('cursor', { conversation_id: 'c', hook_event_name: 'stop', status: 'error' });
    assert.equal(evaluate({ event: failed, settings: settings(), now: NOW, durationMs: 10 * MIN }).alarm.title, 'Cursor: task stopped with an error');
    assert.equal(evaluate({ event: failed, settings: settings(), now: NOW, durationMs: 10 * MIN }).alarm.icon, 'exclamationmark.triangle');
  });
});

describe('awayCheck', () => {
  test('active user: no alert; idle or unknown: alert', () => {
    assert.equal(awayCheck(settings(), 30_000).away, false);
    assert.equal(awayCheck(settings(), 2 * MIN).away, true);
    assert.equal(awayCheck(settings(), null).away, true);
    assert.equal(awayCheck(settings({ onlyWhenAway: false }), 0).away, true);
    assert.equal(awayCheck(settings({ awayAfterMinutes: 10 }), 5 * MIN).away, false);
  });
});

test('quiet hours across midnight and within a day', () => {
  assert.equal(inQuietHours('23:00-08:00', new Date(2026, 0, 1, 23, 0)), true);
  assert.equal(inQuietHours('23:00-08:00', new Date(2026, 0, 1, 7, 59)), true);
  assert.equal(inQuietHours('23:00-08:00', new Date(2026, 0, 1, 8, 0)), false);
  assert.equal(inQuietHours('12:00-13:00', new Date(2026, 0, 1, 12, 30)), true);
  assert.equal(inQuietHours('12:00-13:00', new Date(2026, 0, 1, 13, 30)), false);
  assert.equal(inQuietHours(null, new Date()), false);
});

test('text helpers', () => {
  assert.equal(cleanText('a‮b\n  c', 50), 'ab c');
  assert.equal(cleanText('x'.repeat(10), 5), 'xxxx…');
  assert.equal(formatDuration(3 * MIN), '3 min');
  assert.equal(formatDuration(135 * MIN), '2 h 15 min');
  assert.equal(formatDuration(120 * MIN), '2 h');
});

test('hook output: Cursor gets JSON, the others nothing', () => {
  assert.equal(hookOutput('cursor', { hook_event_name: 'beforeSubmitPrompt' }), '{"continue":true}\n');
  assert.equal(hookOutput('cursor', { hook_event_name: 'stop' }), '{}\n');
  assert.equal(hookOutput('claude-code', { hook_event_name: 'Stop' }), '');
});

test('turn start from a Claude Code transcript skips tool results', (t) => {
  const { dir, cleanup } = tempEnv();
  t.after(cleanup);
  const file = path.join(dir, 't.jsonl');
  const lines = [
    { type: 'user', message: { role: 'user', content: 'first' }, timestamp: '2026-10-27T10:00:00.000Z' },
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'second' }] }, timestamp: '2026-10-27T11:00:00.000Z' },
    { type: 'assistant', message: { role: 'assistant', content: [] }, timestamp: '2026-10-27T11:01:00.000Z' },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] }, timestamp: '2026-10-27T11:05:00.000Z' },
  ];
  fs.writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  assert.equal(lastPromptTime(file), Date.parse('2026-10-27T11:00:00.000Z'));
  assert.equal(lastPromptTime(path.join(dir, 'missing.jsonl')), null);
  assert.equal(lastPromptTime(null), null);
});

test('turn start from a Codex transcript', (t) => {
  const { dir, cleanup } = tempEnv();
  t.after(cleanup);
  const file = path.join(dir, 'rollout.jsonl');
  fs.writeFileSync(file, `${JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'go' }, timestamp: '2026-10-27T09:00:00Z' })}\n`);
  assert.equal(lastPromptTime(file), Date.parse('2026-10-27T09:00:00Z'));
});

describe('handleHook', () => {
  function harness(over = {}) {
    const { dir, cleanup } = tempEnv();
    let now = NOW.getTime();
    const delivered = [];
    let idleCalls = 0;
    const deps = {
      store: new SessionStore(dir),
      now: () => new Date(now),
      settings: settings(),
      pausedUntil: null,
      hasKey: true,
      idle: async () => {
        idleCalls++;
        return 10 * MIN;
      },
      deliver: async (alarm) => delivered.push(alarm),
      ...over,
    };
    return { deps, delivered, cleanup, advance: (ms) => (now += ms), idleCalls: () => idleCalls };
  }

  test('prompt, long task, stop: one quiet notification; a repeat within the cooldown is collapsed', async (t) => {
    const h = harness();
    t.after(h.cleanup);
    await handleHook('claude-code', claude('UserPromptSubmit'), h.deps);
    h.advance(4 * MIN);
    const r = await handleHook('claude-code', claude('Stop'), h.deps);
    assert.equal(r.sent, true);
    assert.deepEqual(h.delivered, [{ type: 'normal', title: 'Claude Code: task finished in my-project', body: 'Took 4 min.', icon: 'checkmark.circle' }]);

    h.advance(MIN);
    await handleHook('claude-code', claude('Notification', { notification_type: 'permission_prompt' }), h.deps);
    assert.equal(h.delivered.length, 1);
  });

  test('a quick task: no alert and no idle check', async (t) => {
    const h = harness();
    t.after(h.cleanup);
    await handleHook('claude-code', claude('UserPromptSubmit'), h.deps);
    h.advance(MIN);
    assert.equal((await handleHook('claude-code', claude('Stop'), h.deps)).sent, false);
    assert.equal(h.idleCalls(), 0);
  });

  test('the user is at the computer: no alert, and no cooldown is used up', async (t) => {
    let idle = 20_000;
    const h = harness({ idle: async () => idle });
    t.after(h.cleanup);
    const r = await handleHook('claude-code', claude('Notification', { notification_type: 'permission_prompt' }), h.deps);
    assert.deepEqual([r.sent, h.delivered.length], [false, 0]);
    assert.match(r.reason, /user active/);
    idle = 3 * MIN;
    assert.equal((await handleHook('claude-code', claude('Notification', { notification_type: 'permission_prompt' }), h.deps)).sent, true);
  });

  test('sessions are independent', async (t) => {
    const h = harness();
    t.after(h.cleanup);
    await handleHook('claude-code', claude('Notification', { notification_type: 'permission_prompt' }), h.deps);
    await handleHook('claude-code', claude('Notification', { notification_type: 'permission_prompt', session_id: 'sess-2' }), h.deps);
    assert.equal(h.delivered.length, 2);
  });

  test('not logged in or paused: nothing is sent', async (t) => {
    const h = harness({ hasKey: false });
    t.after(h.cleanup);
    assert.match((await handleHook('claude-code', claude('Notification', { notification_type: 'permission_prompt' }), h.deps)).reason, /not logged in/);
    const p = harness({ pausedUntil: new Date(NOW.getTime() + MIN).toISOString() });
    t.after(p.cleanup);
    assert.equal((await handleHook('claude-code', claude('Notification', { notification_type: 'permission_prompt' }), p.deps)).sent, false);
    assert.equal(h.delivered.length + p.delivered.length, 0);
  });

  test('Cursor: beforeSubmitPrompt then a completed stop', async (t) => {
    const h = harness();
    t.after(h.cleanup);
    const base = { conversation_id: 'c1', workspace_roots: ['/w/shop'] };
    await handleHook('cursor', { ...base, hook_event_name: 'beforeSubmitPrompt', prompt: 'x' }, h.deps);
    h.advance(6 * MIN);
    await handleHook('cursor', { ...base, hook_event_name: 'stop', status: 'completed', loop_count: 0 }, h.deps);
    assert.deepEqual(h.delivered, [{ type: 'normal', title: 'Cursor: task finished in shop', body: 'Took 6 min.', icon: 'checkmark.circle' }]);
  });
});
