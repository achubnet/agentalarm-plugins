import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** A throwaway HOME-like environment: config and state go to a temp dir, nothing from the real user leaks in. */
export function tempEnv(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentalarm-test-'));
  return {
    dir,
    env: {
      PATH: process.env.PATH,
      HOME: dir,
      XDG_CONFIG_HOME: path.join(dir, 'config'),
      XDG_STATE_HOME: path.join(dir, 'state'),
      ...extra,
    },
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
