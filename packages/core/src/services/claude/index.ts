// The claude CLI, behind domain-shaped functions.
import { execFile, spawn } from 'node:child_process'
import { mkdirSync, openSync } from 'node:fs'
import { join } from 'node:path'
import { matcher } from '../../config.ts'

/** The claude CLI failed or gave no usable answer (HTTP 502). */
export class Upstream extends Error {}

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

/**
 * Ask a forked copy of a session a question and return its answer; the original session is untouched.
 * Runs without the bureau's hooks (so the fork files no visitors), without the tools the bureau parks
 * (so a tool call still parked in the original can't run in the fork), and without saving the fork.
 * Each question gets a fresh fork: it doesn't see earlier questions.
 */
export function forkAndAsk(q: { sessionId: string; cwd: string; question: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'claude',
      ['-p', '--resume', q.sessionId, '--fork-session', '--no-session-persistence',
        '--disallowedTools', matcher.split('|').join(','), '--output-format', 'json'],
      { cwd: q.cwd, timeout: 5 * 60_000, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(new Upstream(`interrogation failed: ${err.message}`))
        let out: { is_error?: boolean; result?: unknown } = {}
        try { out = JSON.parse(stdout) } catch {}
        if (out.is_error || typeof out.result !== 'string') return reject(new Upstream(`interrogation returned no answer${out.is_error ? `: ${String(out.result ?? '')}` : ''}`))
        resolve(out.result)
      },
    )
    // The question goes in on stdin, so one starting with "-" can't be read as a flag.
    child.stdin?.on('error', () => {})
    child.stdin?.end(q.question)
  })
}
