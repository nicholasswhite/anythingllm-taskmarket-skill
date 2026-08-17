import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { runtime } = require("../taskmarket-browser/handler.js");
const DEFAULT_DEMO_TASK_ID =
  "0x8e416ba0f3e473d2dddc7f7afc03ca35ab12b95972818808e9eff0d1e98e31fb";

function compactDescription(value, maxLength = 180) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

function compactTask(task) {
  return {
    id: task.id,
    webUrl: task.webUrl,
    description: compactDescription(task.description),
    status: task.status,
    phase: task.phase,
    mode: task.mode,
    rewardUsdc: task.rewardUsdc,
    netRewardUsdc: task.netRewardUsdc,
    expiryTime: task.expiryTime,
    submissionCount: task.submissionCount,
  };
}

function compactSubmission(submission) {
  return {
    id: submission.id,
    workerAddress: submission.workerAddress,
    submittedAt: submission.submittedAt,
    deliverableHash: submission.deliverableHash,
    artifacts: submission.artifacts.map((artifact) => ({
      fileName: artifact.fileName,
      role: artifact.role,
      mediaKind: artifact.mediaKind,
      sizeBytes: artifact.sizeBytes,
      sha256Hash: artifact.sha256Hash,
    })),
  };
}

const requestedTaskId = process.argv[2] || DEFAULT_DEMO_TASK_ID;
const events = [];
const runtimeContext = {
  config: { name: "Taskmarket Browser", version: "1.0.0" },
  introspect(message) {
    events.push({ type: "introspect", message });
  },
  logger(message) {
    events.push({ type: "logger", message });
  },
};

async function invokeSkill(params) {
  const output = await runtime.handler.call(runtimeContext, params);
  const payload = JSON.parse(output);
  if (!payload.ok) {
    const error = new Error(payload.error.message);
    error.code = payload.error.code;
    throw error;
  }
  return payload;
}

try {
  const discovery = await invokeSkill({
    operation: "list_tasks",
    status: "open",
    phase: "active",
    mode: "bounty",
    sort: "reward_desc",
    limit: 2,
  });
  const taskResult = await invokeSkill({
    operation: "get_task",
    task_id: requestedTaskId,
  });
  const submissionResult = await invokeSkill({
    operation: "list_submissions",
    task_id: requestedTaskId,
  });

  console.log(
    JSON.stringify(
      {
        demo: "AnythingLLM Taskmarket Browser live read-only demo",
        generatedAt: new Date().toISOString(),
        integrationSurface: "taskmarket-browser/handler.js",
        anythingLlmRuntimeEvents: events,
        safety: {
          httpMethod: "GET",
          fixedApiOrigin: "https://api.taskmarket.dev",
          credentialsSent: false,
          walletUsed: false,
          stateChanged: false,
          artifactBodiesFetched: false,
        },
        discovery: {
          source: discovery.source,
          hasMore: discovery.hasMore,
          nextCursor: discovery.nextCursor,
          tasks: discovery.tasks.map(compactTask),
        },
        inspectedTask: compactTask(taskResult.task),
        publicSubmissions: {
          source: submissionResult.source,
          taskUrl: submissionResult.taskUrl,
          count: submissionResult.submissionCount,
          sample: submissionResult.submissions.slice(0, 3).map(compactSubmission),
        },
      },
      null,
      2
    )
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        readOnly: true,
        code: error && error.code ? error.code : "DEMO_ERROR",
        message: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exitCode = 1;
}
