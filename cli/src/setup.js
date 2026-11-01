import { HOOK_DEFAULTS, parseHookOption } from './config.js';

/**
 * `agentalarm setup`: asks when the hooks should alert, with the current values as defaults (Enter keeps them).
 * `ask(question)` returns the typed answer ('' for Enter). Returns the new `hooks` settings.
 */
export async function askHookSettings(ask, current = {}, print = () => {}) {
  const now = { ...HOOK_DEFAULTS, ...current };
  const yesNo = (value) => (value ? 'Y/n' : 'y/N');

  async function question(text, fallback, parse) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const answer = String(await ask(text)).trim();
      if (answer === '') return fallback;
      const value = parse(answer);
      if (value !== undefined) return value;
      print('  Please answer again (Enter keeps the default).');
    }
    return fallback;
  }
  const option = (name) => (answer) => parseHookOption(name, answer);

  print('Finished tasks and "needs your decision" arrive as quiet notifications; only what you mark urgent rings.');
  const settings = { ...now };

  settings.onlyWhenAway = await question(
    `Alert only when you are away from this computer? [${yesNo(now.onlyWhenAway)}] `,
    now.onlyWhenAway,
    option('onlyWhenAway'),
  );
  if (settings.onlyWhenAway) {
    settings.awayAfterMinutes = await question(
      `Away = no keyboard or mouse for how many minutes? [${now.awayAfterMinutes}] `,
      now.awayAfterMinutes,
      option('awayAfterMinutes'),
    );
  }
  settings.minTaskMinutes = await question(
    `Alert when a task finishes only if it ran at least how many minutes? [${now.minTaskMinutes}] `,
    now.minTaskMinutes,
    option('minTaskMinutes'),
  );
  settings.ringOnDecision = await question(
    `Ring (instead of a quiet notification) when the agent needs your decision? [${yesNo(now.ringOnDecision)}] `,
    now.ringOnDecision,
    option('ringOnDecision'),
  );
  if (settings.ringOnDecision) {
    const quiet = now.quietHours ?? '';
    settings.quietHours = await question(
      `Quiet hours, when rings become notifications (e.g. 23:00-08:00, "off" for none)? [${quiet || 'off'}] `,
      now.quietHours,
      option('quietHours'),
    );
  }
  return settings;
}
