"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  API_ORIGIN,
  TaskmarketClientError,
  buildListTasksUrl,
  clampLimit,
  createClient,
  formatMicroUsdc,
  usdcToMicros,
  validateTaskId,
} = require("../taskmarket-browser/lib/taskmarket-client.js");

const TASK_ID =
  "0x8e416ba0f3e473d2dddc7f7afc03ca35ab12b95972818808e9eff0d1e98e31fb";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sampleTask(overrides = {}) {
  return {
    id: TASK_ID,
    description: "Integrate Taskmarket",
    reward: "4500000",
    netReward: "4162500",
    maxPrice: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    expiryTime: "2026-08-22T00:00:00.000Z",
    status: "open",
    phase: "active",
    mode: "bounty",
    tags: ["AI", "integration"],
    submissionCount: 3,
    submissionWindowOpen: true,
    requesterActorType: "human",
    taskVisibility: "public",
    submissionVisibility: "public",
    ...overrides,
  };
}

test("buildListTasksUrl allowlists and encodes discovery filters", () => {
  const url = buildListTasksUrl({
    status: "open",
    phase: "active",
    mode: "bounty",
    tags: "AI agents,web3,AI agents",
    minRewardUsdc: "0.5",
    maxRewardUsdc: "1.250001",
    deadlineHours: 72,
    sort: "reward_desc",
    limit: 500,
    cursor: "next/+ cursor",
  });

  assert.equal(url.origin, API_ORIGIN);
  assert.equal(url.pathname, "/api/tasks");
  assert.equal(url.searchParams.get("status"), "open");
  assert.equal(url.searchParams.get("phase"), "active");
  assert.equal(url.searchParams.get("mode"), "bounty");
  assert.deepEqual(url.searchParams.getAll("tags"), ["ai agents", "web3"]);
  assert.equal(url.searchParams.get("minReward"), "500000");
  assert.equal(url.searchParams.get("maxReward"), "1250001");
  assert.equal(url.searchParams.get("deadlineHours"), "72");
  assert.equal(url.searchParams.get("sort"), "reward_desc");
  assert.equal(url.searchParams.get("limit"), "100");
  assert.equal(url.searchParams.get("cursor"), "next/+ cursor");
});

test("list defaults are useful and limits are clamped to 1..100", () => {
  const url = buildListTasksUrl();
  assert.equal(url.searchParams.get("status"), "open");
  assert.equal(url.searchParams.get("sort"), "newest");
  assert.equal(url.searchParams.get("limit"), "20");
  assert.equal(clampLimit(-4), 1);
  assert.equal(clampLimit(7.9), 7);
  assert.equal(clampLimit(1000), 100);

  const all = buildListTasksUrl({ status: "all", mode: "ALL" });
  assert.equal(all.searchParams.get("status"), "ALL");
  assert.equal(all.searchParams.get("mode"), "ALL");
});

test("task IDs, enum filters, reward ranges, and money precision are validated", () => {
  assert.equal(validateTaskId(TASK_ID.toUpperCase().replace("0X", "0x")), TASK_ID);
  assert.throws(() => validateTaskId("0x1234"), {
    code: "INVALID_TASK_ID",
  });
  assert.throws(() => buildListTasksUrl({ status: "available" }), {
    code: "INVALID_FILTER",
  });
  assert.throws(
    () => buildListTasksUrl({ minRewardUsdc: "2", maxRewardUsdc: "1" }),
    { code: "INVALID_FILTER" }
  );
  assert.throws(() => usdcToMicros("0.0000001"), {
    code: "INVALID_FILTER",
  });
  assert.equal(usdcToMicros("12.3405"), "12340500");
});

test("micro-USDC conversion is exact for integer-sized values", () => {
  assert.equal(formatMicroUsdc("0"), "0");
  assert.equal(formatMicroUsdc("1"), "0.000001");
  assert.equal(formatMicroUsdc("500000"), "0.5");
  assert.equal(formatMicroUsdc("4500000"), "4.5");
  assert.equal(formatMicroUsdc("123456789012345678"), "123456789012.345678");
});

test("all public client operations issue fixed-origin GETs without credentials", async () => {
  const calls = [];
  const responses = [
    { tasks: [sampleTask()], nextCursor: "next", hasMore: true },
    sampleTask(),
    [
      {
        id: "submission-1",
        taskId: TASK_ID,
        workerAddress: "0x1111111111111111111111111111111111111111",
        workerAgentId: "42",
        submittedAt: "2026-08-10T00:00:00.000Z",
        rejectedAt: null,
        deliverableHash: "0xabc",
        submitTxHash: "0xdef",
        fileUrl: "s3://not-returned",
        artifacts: [
          {
            id: "artifact-1",
            role: "final",
            fileName: "deliverable.md",
            mimeType: "text/markdown",
            mediaKind: "text",
            storageUri: "s3://not-returned",
            sizeBytes: 100,
            sha256Hash: "sha256",
            keccak256Hash: "keccak",
          },
        ],
        workerStats: {
          completedTasks: 4,
          ratedTasks: 3,
          totalStars: 14,
          averageRating: 4.67,
        },
      },
    ],
  ];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return jsonResponse(responses[calls.length - 1]);
  };
  const client = createClient({ fetchImpl, timeoutMs: 1_000 });

  const listed = await client.listTasks({ limit: 1 });
  const fetched = await client.getTask(TASK_ID);
  const submissions = await client.listSubmissions(TASK_ID);

  assert.equal(listed.tasks[0].rewardUsdc, "4.5");
  assert.equal(listed.tasks[0].netRewardUsdc, "4.1625");
  assert.equal(fetched.task.webUrl, `https://taskmarket.dev/tasks/${TASK_ID}`);
  assert.equal(submissions.submissionCount, 1);
  assert.equal(submissions.submissions[0].artifacts[0].fileName, "deliverable.md");
  assert.equal("fileUrl" in submissions.submissions[0], false);
  assert.equal("storageUri" in submissions.submissions[0].artifacts[0], false);

  assert.equal(calls.length, 3);
  for (const call of calls) {
    const url = new URL(call.url);
    assert.equal(url.origin, API_ORIGIN);
    assert.match(url.pathname, /^\/api\/tasks(?:\/|$)/);
    assert.equal(call.init.method, "GET");
    assert.deepEqual(call.init.headers, { accept: "application/json" });
    assert.equal("authorization" in call.init.headers, false);
    assert.equal("cookie" in call.init.headers, false);
    assert.equal(call.init.redirect, "error");
  }
  assert.equal(
    new URL(calls[2].url).searchParams.get("includePreviewUrls"),
    "none"
  );
});

test("non-2xx and malformed responses become stable client errors", async () => {
  const denied = createClient({
    fetchImpl: async () => jsonResponse({ message: "not public" }, 403),
  });
  await assert.rejects(() => denied.getTask(TASK_ID), (error) => {
    assert.ok(error instanceof TaskmarketClientError);
    assert.equal(error.code, "HTTP_ERROR");
    assert.match(error.message, /HTTP 403/);
    return true;
  });

  const malformed = createClient({
    fetchImpl: async () => jsonResponse({ tasks: "not-an-array" }),
  });
  await assert.rejects(() => malformed.listTasks(), {
    code: "INVALID_RESPONSE",
  });
});

test("requests time out without retrying", async () => {
  let calls = 0;
  const fetchImpl = (_url, init) => {
    calls += 1;
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    });
  };
  const client = createClient({ fetchImpl, timeoutMs: 5 });

  await assert.rejects(() => client.getTask(TASK_ID), {
    code: "TIMEOUT",
  });
  assert.equal(calls, 1);
});
