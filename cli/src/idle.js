import { execFile } from 'node:child_process';

const IDLE_CHECK_TIMEOUT_MS = 700;

function run(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: IDLE_CHECK_TIMEOUT_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) =>
      error ? reject(error) : resolve(String(stdout)),
    );
  });
}

/** Milliseconds since the last keyboard or mouse input at `ioreg -c IOHIDSystem` (HIDIdleTime is in ns). */
export function parseIoregIdle(output) {
  const match = String(output).match(/"HIDIdleTime"\s*=\s*(\d+)/);
  return match ? Math.floor(Number(match[1]) / 1e6) : null;
}

/** `xprintidle` prints milliseconds. */
export function parseXprintidle(output) {
  const value = String(output).trim();
  return /^\d+$/.test(value) ? Number(value) : null;
}

/**
 * How long this computer has had no keyboard or mouse input, in ms; null when unknown (Windows, Linux without
 * xprintidle or a display, any error). Never throws and never takes longer than ~0.7 s.
 */
export async function idleMs({ platform = process.platform, exec = run } = {}) {
  try {
    if (platform === 'darwin') return parseIoregIdle(await exec('ioreg', ['-c', 'IOHIDSystem', '-d', '4', '-r']));
    if (platform === 'linux') return parseXprintidle(await exec('xprintidle', []));
  } catch {
    // Unknown counts as away: better one alert too many than a missed one.
  }
  return null;
}
