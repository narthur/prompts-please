// The claude CLI, behind domain-shaped functions.
import { spawn } from 'node:child_process'
import { mkdirSync, openSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Resume a parked headless session so its PreToolUse hook fires again and finds the stamp.
 * Runs detached; output goes to a log under the state directory.
 * ponytail: resumes with default flags; the original run's --model etc. aren't recorded yet.
 */
export function resumeSession(opts: { sessionId: string; cwd: string; settingsPath: string; stateDir: string }): void {
  const logDir = join(opts.stateDir, 'runs')
  mkdirSync(logDir, { recursive: true })
  const log = openSync(join(logDir, `${opts.sessionId}-${Date.now()}.json`), 'a')
  const child = spawn(
    'claude',
    ['-p', '--resume', opts.sessionId, '--settings', opts.settingsPath, '--output-format', 'json'],
    { cwd: opts.cwd, stdio: ['ignore', log, log], detached: true },
  )
  // Without this, a missing `claude` on PATH (ENOENT) would crash the whole bureau.
  child.on('error', (e) => console.error(`resume of ${opts.sessionId} failed to start: ${e.message}`))
  child.unref()
}
