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

/**
 * Reverts on cwd's current branch and the commits each names in its "This reverts commit <sha>" lines.
 * A revert that was itself reverted (the work was restored) is left out.
 */
// ponytail: synchronous, so a scan of many large repos blocks the bureau for its duration; go async if it shows.
export function reverts(cwd: string): { sha: string; reverted: string[] }[] {
  let log: string
  try { log = git(cwd, 'log', 'HEAD', '--grep=This reverts commit', '--format=%H%x00%B%x1e') } catch { return [] }
  const found = log.split('\x1e').flatMap((record) => {
    const [sha, body = ''] = record.trim().split('\0')
    const reverted = [...body.matchAll(/This reverts commit ([0-9a-f]{7,40})/g)].map((m) => m[1])
    return sha && reverted.length ? [{ sha, reverted }] : []
  })
  const undone = found.flatMap((r) => r.reverted)
  return found.filter((r) => !undone.some((u) => r.sha.startsWith(u)))
}
