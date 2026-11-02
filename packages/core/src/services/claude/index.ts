// The claude CLI, behind domain-shaped functions.
import { spawn } from 'node:child_process'
import { mkdirSync, openSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Resume a headless session: with no prompt, a parked tool call's hook fires again and finds the stamp;
 * with a prompt (returned finished work), the agent gets the note as its next instruction.
 * The job label is passed on so the resumed run stays the same character.
 * Runs detached; output goes to a log under the state directory.
 * ponytail: resumes with default flags; the original run's --model etc. aren't recorded yet.
 */
export function resumeSession(opts: { sessionId: string; cwd: string; prompt?: string; job?: string; settingsPath: string; stateDir: string }): void {
  const logDir = join(opts.stateDir, 'runs')
  mkdirSync(logDir, { recursive: true })
  const log = openSync(join(logDir, `${opts.sessionId}-${Date.now()}.json`), 'a')
  const child = spawn(
    'claude',
    ['-p', '--resume', opts.sessionId, '--settings', opts.settingsPath, '--output-format', 'json'],
    {
      cwd: opts.cwd,
      env: { ...process.env, PROMPTS_PLEASE_JOB: opts.job }, // undefined drops the server's own value
      // The prompt goes in on stdin, so a note starting with "-" can't be read as a flag.
      stdio: [opts.prompt === undefined ? 'ignore' : 'pipe', log, log],
      detached: true,
    },
  )
  child.stdin?.on('error', (e) => console.error(`prompt for ${opts.sessionId} not delivered: ${e.message}`))
  child.stdin?.end(opts.prompt)
  // Without this, a missing `claude` on PATH (ENOENT) would crash the whole bureau.
  child.on('error', (e) => console.error(`resume of ${opts.sessionId} failed to start: ${e.message}`))
  child.unref()
}
