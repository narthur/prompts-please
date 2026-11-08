// The "one resume per session" queue and the steps that follow a stamp. Takes the Claude runner as a
// parameter so it can be exercised with a fake; server.ts only wires the real one in.
import type { Decision, Resume } from './bureau.ts'

// Starts one resume and must call onExit exactly once-ish when it ends ('error' and 'exit' may both fire).
export type RunResume = (resume: Resume, onExit: () => void) => void

// One resume per session at a time: two at once would interleave turns in one transcript.
// Stamps that land meanwhile queue up and run in order as each resume exits; one plain resume
// picks up every parked call stamped by then, so plain resumes aren't queued twice.
// ponytail: in memory, so a bureau restart forgets running and queued resumes; persist if restarts mid-run matter.
export function createResumeQueue(run: RunResume): (resume: Resume) => void {
  const running = new Set<string>()
  const queued = new Map<string, Resume[]>()
  function resumeOnce(r: Resume) {
    if (running.has(r.sessionId)) {
      const queue = queued.get(r.sessionId) ?? []
      if (r.prompt !== undefined || !queue.some((q) => q.prompt === undefined)) queue.push(r)
      queued.set(r.sessionId, queue)
      return
    }
    running.add(r.sessionId)
    let done = false // 'error' and 'exit' can both fire
    const onExit = () => {
      if (done) return
      done = true
      running.delete(r.sessionId)
      const next = queued.get(r.sessionId)?.shift()
      if (!queued.get(r.sessionId)?.length) queued.delete(r.sessionId)
      if (next) resumeOnce(next)
    }
    // A synchronous throw (e.g. the log can't be opened) must not leave the session locked.
    try { run(r, onExit) } catch (e) {
      console.error(`resume of ${r.sessionId} failed to start: ${(e as Error).message}`)
      onExit()
    }
  }
  return resumeOnce
}

// Stamp, then hand any resulting resume to the queue, then refresh the summary. The summary is
// refreshed once the resume is queued or started, not once it finishes. A stamp that throws
// (unknown id, already stamped) propagates and queues nothing and leaves the summary alone.
export function createStamper(deps: {
  stamp: (id: string, decision: Decision, now: Date) => Resume | null
  run: RunResume
  refreshSummary: (now: Date) => void
}): (id: string, decision: Decision, now: Date) => void {
  const resumeOnce = createResumeQueue(deps.run)
  return (id, decision, now) => {
    const resume = deps.stamp(id, decision, now)
    if (resume) resumeOnce(resume)
    deps.refreshSummary(now)
  }
}
