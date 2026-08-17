"use strict";

const API_ORIGIN = "https://api.taskmarket.dev";
const API_BASE_URL = `${API_ORIGIN}/api/`;
const WEB_TASK_BASE_URL = "https://taskmarket.dev/tasks/";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const DEFAULT_TIMEOUT_MS = 10_000;
const TASK_ID_PATTERN = /^0x[0-9a-fA-F]{64}$/;

const TASK_STATUSES = new Set([
  "open",
  "claimed",
  "worker_selected",
  "pending_approval",
  "review",
  "appealing",
  "disputed",
  "completed",
  "expired",
  "cancelled",
  "ALL",
]);
const TASK_PHASES = new Set([
  "active",
  "in_review",
  "awaiting_settlement",
  "resolved",
]);
const TASK_MODES = new Set([
  "ALL",
  "bounty",
  "claim",
  "pitch",
  "benchmark",
  "auction",
]);
const SORT_ORDERS = new Set([
  "newest",
  "reward_desc",
  "reward_asc",
  "deadline_asc",
]);

class TaskmarketClientError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "TaskmarketClientError";
    this.code = code;
  }
}

function optionalString(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized === "" ? null : normalized;
}

function normalizeEnum(name, value, allowed, fallback = null) {
  const normalized = optionalString(value);
  if (normalized === null) return fallback;
  const candidate = normalized.toLowerCase() === "all"
    ? "ALL"
    : normalized.toLowerCase();
  if (!allowed.has(candidate)) {
    throw new TaskmarketClientError(
      "INVALID_FILTER",
      `${name} must be one of: ${Array.from(allowed).join(", ")}.`
    );
  }
  return candidate;
}

function validateTaskId(taskId) {
  const normalized = optionalString(taskId);
  if (!normalized || !TASK_ID_PATTERN.test(normalized)) {
    throw new TaskmarketClientError(
      "INVALID_TASK_ID",
      "task_id must be 0x followed by exactly 64 hexadecimal characters."
    );
  }
  return normalized.toLowerCase();
}

function clampLimit(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return DEFAULT_LIMIT;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new TaskmarketClientError(
      "INVALID_FILTER",
      "limit must be a finite number."
    );
  }
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(parsed)));
}

function normalizeDeadlineHours(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TaskmarketClientError(
      "INVALID_FILTER",
      "deadline_hours must be a positive whole number."
    );
  }
  return parsed;
}

function normalizeTags(value) {
  if (value === undefined || value === null || value === "") return [];
  const input = Array.isArray(value) ? value : String(value).split(",");
  // Taskmarket's public tag filter is case-sensitive and published tags are
  // normalized to lowercase. Normalize human/LLM input so prompts such as
  // "tagged AI" resolve the same way as `ai` in the public API.
  const tags = input
    .map((tag) => String(tag).trim().toLowerCase())
    .filter(Boolean);

  if (tags.length > 10) {
    throw new TaskmarketClientError(
      "INVALID_FILTER",
      "tags may contain at most 10 values."
    );
  }
  if (tags.some((tag) => tag.length > 64)) {
    throw new TaskmarketClientError(
      "INVALID_FILTER",
      "each tag must be 64 characters or fewer."
    );
  }
  return [...new Set(tags)];
}

function usdcToMicros(value, name = "reward") {
  const normalized = optionalString(value);
  if (normalized === null) return null;
  if (!/^\d+(?:\.\d{1,6})?$/.test(normalized)) {
    throw new TaskmarketClientError(
      "INVALID_FILTER",
      `${name} must be a non-negative USDC amount with at most six decimal places.`
    );
  }

  const [whole, fraction = ""] = normalized.split(".");
  return (BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"))).toString();
}

function formatMicroUsdc(value) {
  const normalized = optionalString(value);
  if (normalized === null) return null;
  if (!/^\d+$/.test(normalized)) {
    throw new TaskmarketClientError(
      "INVALID_RESPONSE",
      "Taskmarket returned a non-integer micro-USDC value."
    );
  }

  const micros = BigInt(normalized);
  const whole = micros / 1_000_000n;
  const fraction = (micros % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function maybeFormatMicroUsdc(value) {
  if (value === undefined || value === null) return null;
  try {
    return formatMicroUsdc(value);
  } catch {
    return null;
  }
}

function buildListTasksUrl(filters = {}) {
  const url = new URL("tasks", API_BASE_URL);
  const status = normalizeEnum("status", filters.status, TASK_STATUSES, "open");
  const phase = normalizeEnum("phase", filters.phase, TASK_PHASES);
  const mode = normalizeEnum("mode", filters.mode, TASK_MODES);
  const sort = normalizeEnum("sort", filters.sort, SORT_ORDERS, "newest");
  const tags = normalizeTags(filters.tags);
  const minReward = usdcToMicros(filters.minRewardUsdc, "min_reward_usdc");
  const maxReward = usdcToMicros(filters.maxRewardUsdc, "max_reward_usdc");
  const deadlineHours = normalizeDeadlineHours(filters.deadlineHours);
  const cursor = optionalString(filters.cursor);

  if (cursor && cursor.length > 512) {
    throw new TaskmarketClientError(
      "INVALID_FILTER",
      "cursor must be 512 characters or fewer."
    );
  }
  if (
    minReward !== null &&
    maxReward !== null &&
    BigInt(minReward) > BigInt(maxReward)
  ) {
    throw new TaskmarketClientError(
      "INVALID_FILTER",
      "min_reward_usdc cannot be greater than max_reward_usdc."
    );
  }

  url.searchParams.set("limit", String(clampLimit(filters.limit)));
  url.searchParams.set("status", status);
  url.searchParams.set("sort", sort);
  if (phase) url.searchParams.set("phase", phase);
  if (mode) url.searchParams.set("mode", mode);
  for (const tag of tags) url.searchParams.append("tags", tag);
  if (minReward !== null) url.searchParams.set("minReward", minReward);
  if (maxReward !== null) url.searchParams.set("maxReward", maxReward);
  if (deadlineHours !== null) {
    url.searchParams.set("deadlineHours", String(deadlineHours));
  }
  if (cursor) url.searchParams.set("cursor", cursor);
  return url;
}

function buildTaskUrl(taskId, suffix = "") {
  const normalized = validateTaskId(taskId);
  return new URL(`tasks/${normalized}${suffix}`, API_BASE_URL);
}

function assertReadOnlyUrl(url) {
  const parsed = url instanceof URL ? url : new URL(url);
  if (
    parsed.origin !== API_ORIGIN ||
    !/^\/api\/tasks(?:\/|$)/.test(parsed.pathname)
  ) {
    throw new TaskmarketClientError(
      "UNSAFE_URL",
      "The client refused a URL outside Taskmarket's public task API."
    );
  }
  return parsed;
}

async function requestJson(url, { fetchImpl, timeoutMs }) {
  const safeUrl = assertReadOnlyUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(safeUrl.toString(), {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "error",
      signal: controller.signal,
    });

    if (!response || typeof response.ok !== "boolean") {
      throw new TaskmarketClientError(
        "INVALID_RESPONSE",
        "Taskmarket returned an invalid HTTP response."
      );
    }

    const bodyText = await response.text();
    let data = null;
    if (bodyText) {
      try {
        data = JSON.parse(bodyText);
      } catch {
        throw new TaskmarketClientError(
          "INVALID_RESPONSE",
          "Taskmarket returned a response that was not valid JSON."
        );
      }
    }

    if (!response.ok) {
      const apiMessage =
        data && typeof data === "object"
          ? optionalString(data.message || data.error)
          : null;
      throw new TaskmarketClientError(
        "HTTP_ERROR",
        `Taskmarket request failed with HTTP ${response.status}${
          apiMessage ? `: ${apiMessage.slice(0, 200)}` : "."
        }`
      );
    }

    return data;
  } catch (error) {
    if (controller.signal.aborted || (error && error.name === "AbortError")) {
      throw new TaskmarketClientError(
        "TIMEOUT",
        `Taskmarket did not respond within ${timeoutMs} ms.`
      );
    }
    if (error instanceof TaskmarketClientError) throw error;
    throw new TaskmarketClientError(
      "NETWORK_ERROR",
      `Taskmarket request failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  } finally {
    clearTimeout(timer);
  }
}

function normalizeTask(task) {
  if (!task || typeof task !== "object" || typeof task.id !== "string") {
    throw new TaskmarketClientError(
      "INVALID_RESPONSE",
      "Taskmarket returned malformed task data."
    );
  }

  return {
    id: task.id,
    webUrl: `${WEB_TASK_BASE_URL}${task.id}`,
    description: typeof task.description === "string" ? task.description : "",
    status: task.status ?? null,
    phase: task.phase ?? null,
    mode: task.mode ?? null,
    tags: Array.isArray(task.tags) ? task.tags : [],
    rewardMicroUsdc: task.reward ?? null,
    rewardUsdc: maybeFormatMicroUsdc(task.reward),
    netRewardMicroUsdc: task.netReward ?? null,
    netRewardUsdc: maybeFormatMicroUsdc(task.netReward),
    maxPriceMicroUsdc: task.maxPrice ?? null,
    maxPriceUsdc: maybeFormatMicroUsdc(task.maxPrice),
    createdAt: task.createdAt ?? null,
    expiryTime: task.expiryTime ?? null,
    submissionCount:
      typeof task.submissionCount === "number" ? task.submissionCount : 0,
    submissionWindowOpen:
      typeof task.submissionWindowOpen === "boolean"
        ? task.submissionWindowOpen
        : null,
    requesterActorType: task.requesterActorType ?? null,
    taskVisibility: task.taskVisibility ?? null,
    submissionVisibility: task.submissionVisibility ?? null,
  };
}

function normalizeArtifact(artifact) {
  return {
    id: artifact && artifact.id ? artifact.id : null,
    role: artifact && artifact.role ? artifact.role : null,
    fileName: artifact && artifact.fileName ? artifact.fileName : null,
    mimeType: artifact && artifact.mimeType ? artifact.mimeType : null,
    mediaKind: artifact && artifact.mediaKind ? artifact.mediaKind : null,
    sizeBytes:
      artifact && typeof artifact.sizeBytes === "number"
        ? artifact.sizeBytes
        : null,
    sha256Hash: artifact && artifact.sha256Hash ? artifact.sha256Hash : null,
    keccak256Hash:
      artifact && artifact.keccak256Hash ? artifact.keccak256Hash : null,
  };
}

function normalizeSubmission(submission) {
  if (!submission || typeof submission !== "object") {
    throw new TaskmarketClientError(
      "INVALID_RESPONSE",
      "Taskmarket returned malformed submission data."
    );
  }

  return {
    id: submission.id ?? null,
    taskId: submission.taskId ?? null,
    workerAddress: submission.workerAddress ?? null,
    workerAgentId: submission.workerAgentId ?? null,
    submittedAt: submission.submittedAt ?? null,
    rejectedAt: submission.rejectedAt ?? null,
    deliverableHash: submission.deliverableHash ?? null,
    submitTxHash: submission.submitTxHash ?? null,
    artifacts: Array.isArray(submission.artifacts)
      ? submission.artifacts.map(normalizeArtifact)
      : [],
    workerStats:
      submission.workerStats && typeof submission.workerStats === "object"
        ? {
            completedTasks: submission.workerStats.completedTasks ?? null,
            ratedTasks: submission.workerStats.ratedTasks ?? null,
            totalStars: submission.workerStats.totalStars ?? null,
            averageRating: submission.workerStats.averageRating ?? null,
          }
        : null,
  };
}

function createClient(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (typeof fetchImpl !== "function") {
    throw new TaskmarketClientError(
      "UNSUPPORTED_RUNTIME",
      "A Fetch API implementation is required (Node.js 18 or newer)."
    );
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) {
    throw new TaskmarketClientError(
      "INVALID_CONFIGURATION",
      "timeoutMs must be a positive whole number no greater than 60000."
    );
  }

  return Object.freeze({
    async listTasks(filters = {}) {
      const url = buildListTasksUrl(filters);
      const data = await requestJson(url, { fetchImpl, timeoutMs });
      if (!data || typeof data !== "object" || !Array.isArray(data.tasks)) {
        throw new TaskmarketClientError(
          "INVALID_RESPONSE",
          "Taskmarket returned malformed task-list data."
        );
      }
      return {
        readOnly: true,
        source: url.toString(),
        tasks: data.tasks.map(normalizeTask),
        nextCursor: data.nextCursor ?? null,
        hasMore: Boolean(data.hasMore),
      };
    },

    async getTask(taskId) {
      const normalizedTaskId = validateTaskId(taskId);
      const url = buildTaskUrl(normalizedTaskId);
      const data = await requestJson(url, { fetchImpl, timeoutMs });
      return {
        readOnly: true,
        source: url.toString(),
        task: normalizeTask(data),
      };
    },

    async listSubmissions(taskId) {
      const normalizedTaskId = validateTaskId(taskId);
      const url = buildTaskUrl(normalizedTaskId, "/submissions");
      url.searchParams.set("includePreviewUrls", "none");
      const data = await requestJson(url, { fetchImpl, timeoutMs });
      if (!Array.isArray(data)) {
        throw new TaskmarketClientError(
          "INVALID_RESPONSE",
          "Taskmarket returned malformed submission-list data."
        );
      }
      return {
        readOnly: true,
        source: url.toString(),
        taskId: normalizedTaskId,
        taskUrl: `${WEB_TASK_BASE_URL}${normalizedTaskId}`,
        submissionCount: data.length,
        submissions: data.map(normalizeSubmission),
      };
    },
  });
}

module.exports = {
  API_ORIGIN,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  TASK_ID_PATTERN,
  TaskmarketClientError,
  buildListTasksUrl,
  clampLimit,
  createClient,
  formatMicroUsdc,
  normalizeTask,
  usdcToMicros,
  validateTaskId,
};
