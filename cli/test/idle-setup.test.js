import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HOOK_DEFAULTS } from '../src/config.js';
import { idleMs, parseIoregIdle, parseXprintidle } from '../src/idle.js';
import { askHookSettings } from '../src/setup.js';

test('idle time parsers', () => {
  assert.equal(parseIoregIdle('  |   "HIDIdleTime" = 3265831458\n'), 3265);
  assert.equal(parseIoregIdle('nothing'), null);
  assert.equal(parseXprintidle('12345\n'), 12345);
  assert.equal(parseXprintidle('error'), null);
});

test('idle check per platform; failures and unknown platforms are null (away)', async () => {
  const calls = [];
  const exec = async (cmd, args) => {
    calls.push([cmd, ...args]);
    return cmd === 'ioreg' ? '"HIDIdleTime" = 120000000000' : '5000';
  };
  assert.equal(await idleMs({ platform: 'darwin', exec }), 120_000);
  assert.equal(await idleMs({ platform: 'linux', exec }), 5000);
  assert.equal(await idleMs({ platform: 'win32', exec }), null);
  assert.deepEqual(calls.map((c) => c[0]), ['ioreg', 'xprintidle']);
  assert.equal(await idleMs({ platform: 'linux', exec: async () => Promise.reject(new Error('ENOENT')) }), null);
});

function scripted(answers) {
  const asked = [];
  return {
    asked,
    ask: async (question) => {
      asked.push(question);
      return answers.shift() ?? '';
    },
  };
}

test('setup: Enter everywhere keeps the defaults; ringOnDecision is asked last and defaults to No', async () => {
  const s = scripted([]);
  assert.deepEqual(await askHookSettings(s.ask), { ...HOOK_DEFAULTS });
  assert.equal(s.asked.length, 4);
  assert.match(s.asked.at(-1), /Ring .*decision\? \[y\/N\]/);
});

test('setup: custom answers, quiet hours only when decisions ring, bad answers asked again', async () => {
  const s = scripted(['n', 'ten', '10', 'y', '22:00-07:30']);
  const settings = await askHookSettings(s.ask);
  assert.equal(settings.onlyWhenAway, false);
  assert.equal(settings.minTaskMinutes, 10);
  assert.equal(settings.ringOnDecision, true);
  assert.equal(settings.quietHours, '22:00-07:30');
  assert.equal(s.asked.length, 5);
});

test('setup: current values are the defaults', async () => {
  const s = scripted([]);
  const settings = await askHookSettings(s.ask, { minTaskMinutes: 7, ringOnDecision: true, quietHours: '23:00-08:00' });
  assert.equal(settings.minTaskMinutes, 7);
  assert.equal(settings.quietHours, '23:00-08:00');
  assert.match(s.asked[2], /\[7\]/);
});
