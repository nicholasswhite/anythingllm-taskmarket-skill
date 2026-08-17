# Taskmarket Browser for AnythingLLM

A standalone, read-only custom agent skill that lets an AnythingLLM agent discover Taskmarket work, inspect a task, and review public submission metadata.

This project integrates with [AnythingLLM](https://anythingllm.com/), an established MIT-licensed local-first AI agent product, through its documented [custom agent skill extension point](https://docs.anythingllm.com/agent/custom/developer-guide). It is an independent compatibility project and is not affiliated with or endorsed by Mintplex Labs or Taskmarket.

## What it does

- Lists public tasks with allowlisted filters for status, phase, mode, tags, reward, deadline, and sort order.
- Retrieves a public task by its 32-byte Taskmarket ID.
- Lists public submission metadata for a task, including artifact names, hashes, sizes, and worker statistics.
- Converts Taskmarket's integer micro-USDC values to exact human-readable USDC strings.
- Returns structured JSON strings, as required by the AnythingLLM custom-skill runtime.

## Safety boundary

This integration is intentionally discovery-only.

- Every network request is an HTTP `GET` to the fixed origin `https://api.taskmarket.dev` under `/api/tasks`.
- The client does not accept a custom base URL, HTTP method, headers, API key, wallet, token, cookie, seed phrase, or private key.
- It has no create, claim, bid, submit, accept, reject, rate, fund, or payment operation.
- It requests submission metadata with `includePreviewUrls=none`; it does not fetch artifact bodies or signed preview URLs.
- Redirects are rejected, request timeouts are enforced, task IDs and filters are validated, and list limits are clamped to the public API's `1..100` range.

Because the skill cannot write, spend, or change external state, it never asks AnythingLLM for destructive-tool approval. If write capabilities are added in a future version, they should be implemented as a separate skill with fresh user authorization and wallet-enforced spending controls.

## Requirements

- AnythingLLM with custom agent skills enabled
- Node.js 18 or newer (this skill uses Node's built-in Fetch API)
- Network access to `https://api.taskmarket.dev`

No Taskmarket account, wallet, API key, or other service credential is required for the public read operations used here.

## Install in AnythingLLM

1. Locate AnythingLLM's `STORAGE_DIR` for your Desktop, Docker, or local-development installation.
2. Create `plugins/agent-skills` inside that storage directory if it does not exist.
3. Copy the entire [`taskmarket-browser`](./taskmarket-browser) folder to:

   ```text
   $STORAGE_DIR/plugins/agent-skills/taskmarket-browser
   ```

4. Reload the AnythingLLM page so the skill appears. If an agent session is already active, run `/exit` and start a new session so changes are hot-loaded.
5. Enable **Taskmarket Browser** for the workspace agent.

The folder name must remain `taskmarket-browser` because AnythingLLM requires it to match the manifest's `hubId`.

## Example prompts

- “Find five open Taskmarket bounties tagged AI, highest reward first.”
- “Show Taskmarket task `0x8e416ba0f3e473d2dddc7f7afc03ca35ab12b95972818808e9eff0d1e98e31fb`.”
- “List the public submissions for that Taskmarket task.”

The handler supports three operations:

| Operation | Required input | Result |
| --- | --- | --- |
| `list_tasks` | None | Filtered public tasks and pagination cursor |
| `get_task` | `task_id` | One normalized public task |
| `list_submissions` | `task_id` | Public submission and artifact metadata |

For `list_tasks`, optional inputs are `status`, `phase`, `mode`, comma-separated `tags`, `min_reward_usdc`, `max_reward_usdc`, `deadline_hours`, `sort`, `limit`, and `cursor`. Omitted status defaults to `open`; omitted sort defaults to `newest`.

## Develop and test

There are no runtime or development dependencies.

```bash
npm test
npm run check
npm run demo
```

`npm test` uses Node's built-in test runner and mocked `fetch` responses. The tests cover URL encoding, enum and ID validation, reward conversion, response normalization, errors and timeouts, the AnythingLLM manifest contract, and the GET-only/no-credential safety boundary.

`npm run demo` drives the same `handler.js` entry point that AnythingLLM invokes and performs a live, read-only reproduction against Taskmarket's public API. It lists two open bounties, retrieves a known public integration bounty, and lists its public submission metadata. To inspect a different task:

```bash
npm run demo -- 0xYOUR_64_HEX_CHARACTER_TASK_ID
```

The demo prints compact JSON suitable for logs or a screenshot. It never sends credentials and never changes Taskmarket state.

## Project layout

```text
taskmarket-browser/
  plugin.json                 AnythingLLM skill manifest
  handler.js                  AnythingLLM runtime entry point
  lib/taskmarket-client.js    Validated, fixed-origin GET client
  README.md                   In-product installation and usage notes
demo/live-readonly-demo.mjs   Reproducible live public-API demo
test/                         Node unit and contract tests
```

## Data and limitations

The skill returns only data made available by Taskmarket's public task and submission endpoints. A task's visibility rules can still cause a `401`, `403`, or `404`; the handler returns that failure as structured JSON rather than retrying or seeking credentials. Artifact content is deliberately out of scope.

Taskmarket task links use `https://taskmarket.dev/tasks/{taskId}`. API behavior is based on the public OpenAPI document at `https://api.taskmarket.dev/openapi.json`.

Development disclosure: this project was created with AI-assisted tooling and manually reviewed and tested before publication.

## License

[MIT](./LICENSE)
