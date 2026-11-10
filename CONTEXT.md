# Prompts Please

## Language

**Resume queue**: the module in `packages/core/src/resume-queue.ts` that guarantees one resume per session at a time and sequences what follows a stamp (stamp, hand the resume to the queue, summary refresh; the refresh happens when the resume is queued or started, not when it finishes). It takes the Claude runner as a parameter, so its seam is the runner: the real runner is the closure in `server.ts` that calls `claude.resumeSession`, tests use a fake. `server.ts` only wires it up.

**Hook entry**: `packages/core/src/hook.ts` (PreToolUse) and `session-hook.ts` (SessionStart/Stop) are the files the agent settings point at, and they stay thin shims that wire real stdin, env, stateDir, git and exit codes. The behaviour is in `preToolUse` (`pretooluse.ts`, the fail-closed gate: malformed or unsafe payloads exit 2, a corrupt stamp denies) and `sessionHook` (`session-bookkeeping.ts`, the per-session base and the finished-work filing). Their seam is the injected inputs (payload, stateDir, job, and for `sessionHook` a `Git` adapter: real in `services/git`, fake in tests); `preToolUse` returns an exit code and output instead of exiting; `sessionHook` returns only an optional stderr message (the shim exits 0 on it) and throws on unparseable stdin. Every id that becomes a file name goes through the one `isSafeId` in `bureau.ts`.
