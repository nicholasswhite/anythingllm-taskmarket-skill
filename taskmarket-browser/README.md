# Taskmarket Browser

This AnythingLLM custom agent skill provides three public, read-only Taskmarket operations:

- `list_tasks` — discover tasks with validated filters
- `get_task` — inspect one task by ID
- `list_submissions` — review public submission and artifact metadata

It cannot create, claim, bid, submit, accept, reject, fund, rate, or pay for a task. It has no setup arguments and never asks for a wallet or credential.

## Install

Copy this entire folder, without renaming it, to:

```text
$STORAGE_DIR/plugins/agent-skills/taskmarket-browser
```

Reload AnythingLLM. If an agent session is open, run `/exit` before starting a new one so the skill is reloaded.

## Example prompts

- “Find ten open Taskmarket bounties, newest first.”
- “Show Taskmarket task `0x8e416ba0f3e473d2dddc7f7afc03ca35ab12b95972818808e9eff0d1e98e31fb`.”
- “List public submissions for that Taskmarket task.”

The handler always returns a JSON string. Successful results include `ok: true` and `readOnly: true`; failures include a stable error code and never trigger a write fallback.

See the [project README](../README.md) for all filters, tests, live-demo instructions, safeguards, and limitations.
