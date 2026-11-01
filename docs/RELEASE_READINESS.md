# Release readiness

Version: 0.1.0 preview. Release status: IN_PROGRESS.

VERIFIED before packaging: local file generation and read-back; real ChatGPT subscription response; return-to-local switching; one live Auto planning/local-write/read-back flow; saved chat persistence. GitHub CLI signed-in access works through the agent's shell.

IMPLEMENTED_UNTESTED: packaged desktop launcher; installer upgrade/uninstall behavior until installer tests complete.

NOT_STARTED: full GitHub UI, Copilot sign-in, speech, computer control, parallel subagents, robust continuous task queue.

Release blockers for a stable release: clean Windows machine testing, authenticated cloud regression testing, Stop/repair-escalation/crash recovery coverage, security review, code signing, guided model download, Git dependency setup, model compatibility validation. Local commands have full user privileges. No enforced filesystem sandbox exists.

This preview must never bundle auth.json, private state, keys, logs, project data, or personal model weights. Per-user setup generates a new local model key and keeps existing credentials outside the payload. Public source is allowlisted by copying only release source files into this repository.
