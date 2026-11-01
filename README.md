# AI Builder — 0.1.0 preview

Independent Windows local-first coding assistant. It is separate from adap2us.

Chat with a local Qwen3.5 4B model through llama.cpp and Pi. Optional ChatGPT subscription sign-in supports manual model switching and Auto mode: a tool-free ChatGPT planner hands an execution brief to the local worker. Auto makes one initial planning consultation and at most one repair consultation per request. Provider retries and token use are not a fixed monetary budget. Cloud use consumes your account allowance.

## Install

Run `AI-Builder-Setup-0.1.0-preview.exe`. It installs per user, without administrator rights, and adds AI Builder to the desktop and Start menu. Node.js, Pi and llama.cpp CPU binaries are included in the installer. Model weights are separate: supply a compatible Qwen3.5 4B GGUF at first launch. Git for Windows with Bash is required for command execution; GitHub CLI is optional. Existing model, settings, chats and projects are preserved.

This is an unsigned early preview, not a production-ready autonomous agent. The installer may receive Windows reputation warnings because it has no signing certificate. Do not bypass warnings you do not understand. Source is provided for inspection.

The agent can execute commands with your user permissions. A project folder is its working directory, **not an operating-system sandbox**. Use isolated test projects and inspect changes before publishing. No untrusted GitHub inbox jobs are automatically executed. Do not give an unreviewed task access to confidential material.

## Memory and connections

Conversations and project metadata: `AI-Builder/state/interface.json`. Pi sessions and private sign-ins: `AI-Builder/pi-state/`. Projects: `USERPROFILE/AI-Projects`. These are local and must not be uploaded as source. Uninstall removes installed program files while retaining user-generated data and model files. Keep independent project backups.

ChatGPT account authorization is optional and personal. GitHub CLI access works when separately installed and signed in. Dedicated GitHub UI and Copilot sign-in are **not implemented in this preview**. Speech and computer control are also not implemented.

## Source and build

`app/ui/` contains the dependency-free web interface and Node backend. `app/Start-Builder-UI.ps1` launches the runtime and app window. `packaging/Launcher.cs` builds the desktop launcher with the Windows .NET Framework compiler. `packaging/setup.iss` builds the installer with Inno Setup 7.1.1. Packaging expects a `payload/` containing the app, `runtime/node.exe`, `pi/node_modules`, and `bin/llama`.

Pinned core versions: Pi 1.4.0 (see lockfile), llama.cpp b11960. Runtime licenses are included with the installer; dependencies retain their bundled licenses. Inno Setup's compiler licensing must be reviewed before commercial distribution. AI Builder's original code is MIT licensed.

See `docs/RELEASE_READINESS.md` for verified tests and remaining limits. No claim of clean-machine verification or general autonomous software completion is made.
