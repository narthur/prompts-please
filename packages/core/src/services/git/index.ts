// git, behind domain-shaped functions.
import { execFileSync } from 'node:child_process'

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()

/** The commit checked out in cwd, or null outside a repo or before the first commit. */
export function head(cwd: string): string | null {
  try { return git(cwd, 'rev-parse', 'HEAD') } catch { return null }
}

/** Commits reachable from HEAD but not from base, oldest first. Empty when base is unknown. */
// ponytail: no base (run started outside a repo, or before its first commit) means no commits listed.
export function commitsSince(cwd: string, base: string | null): string[] {
  if (!base) return []
  try { return git(cwd, 'rev-list', '--reverse', `${base}..HEAD`).split('\n').filter(Boolean) } catch { return [] }
}
