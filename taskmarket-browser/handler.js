"use strict";

const VALID_OPERATIONS = new Set([
  "list_tasks",
  "get_task",
  "list_submissions",
]);

function normalizeOperation(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return "list_tasks";
  }

  const normalized = String(value).trim().toLowerCase().replaceAll("-", "_");
  if (!VALID_OPERATIONS.has(normalized)) {
    throw new Error(
      `Unsupported operation "${String(value)}". Use list_tasks, get_task, or list_submissions.`
    );
  }

  return normalized;
}

function notify(context, method, message) {
  if (!context || typeof context[method] !== "function") return;
  try {
    context[method](message);
  } catch {
    // Observability hooks must never prevent the handler from returning a string.
  }
}

function errorPayload(operation, error) {
  return {
    ok: false,
    readOnly: true,
    operation,
    error: {
      code: error && error.code ? error.code : "INVALID_REQUEST",
      message: error instanceof Error ? error.message : String(error),
    },
    guidance:
      "Taskmarket Browser only performs public read operations. It will not request credentials, use a wallet, or retry with a write operation.",
  };
}

module.exports.runtime = {
  handler: async function (params = {}) {
    let operation = "list_tasks";

    try {
      operation = normalizeOperation(params.operation);
      notify(
        this,
        "introspect",
        `Taskmarket Browser is performing the public read-only operation ${operation}.`
      );

      // AnythingLLM recommends loading bundled modules only after invocation.
      const { createClient } = require("./lib/taskmarket-client.js");
      const client = createClient();
      let result;

      if (operation === "list_tasks") {
        result = await client.listTasks({
          status: params.status,
          phase: params.phase,
          mode: params.mode,
          tags: params.tags,
          minRewardUsdc: params.min_reward_usdc,
          maxRewardUsdc: params.max_reward_usdc,
          deadlineHours: params.deadline_hours,
          sort: params.sort,
          limit: params.limit,
          cursor: params.cursor,
        });
      } else if (operation === "get_task") {
        result = await client.getTask(params.task_id);
      } else {
        result = await client.listSubmissions(params.task_id);
      }

      return JSON.stringify(
        {
          ok: true,
          integration: "anythingllm-taskmarket-skill",
          operation,
          ...result,
        },
        null,
        2
      );
    } catch (error) {
      const payload = errorPayload(operation, error);
      notify(
        this,
        "introspect",
        `Taskmarket Browser could not complete ${operation}: ${payload.error.message}`
      );
      notify(
        this,
        "logger",
        `Taskmarket Browser ${operation} failed (${payload.error.code}): ${payload.error.message}`
      );
      return JSON.stringify(payload, null, 2);
    }
  },
};
