# Prompts Please

## Language

**Resume queue**: the module in `packages/core/src/resume-queue.ts` that guarantees one resume per session at a time and sequences what follows a stamp (stamp, hand the resume to the queue, summary refresh; the refresh happens when the resume is queued or started, not when it finishes). It takes the Claude runner as a parameter, so its seam is the runner: the real runner is the closure in `server.ts` that calls `claude.resumeSession`, tests use a fake. `server.ts` only wires it up.
