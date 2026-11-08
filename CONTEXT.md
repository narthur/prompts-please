# Prompts Please

## Language

**Resume queue**: the module in `packages/core/src/resume-queue.ts` that guarantees one resume per session at a time and sequences what follows a stamp (stamp, resume, summary refresh). It takes the Claude runner as a parameter, so its seam is the runner: the real adapter is `claude.resumeSession`, tests use a fake. `server.ts` only wires it up.
