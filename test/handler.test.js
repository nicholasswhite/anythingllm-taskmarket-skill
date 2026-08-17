"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { runtime } = require("../taskmarket-browser/handler.js");

const TASK_ID =
  "0x8e416ba0f3e473d2dddc7f7afc03ca35ab12b95972818808e9eff0d1e98e31fb";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function runtimeContext() {
  const messages = [];
  return {
    messages,
    config: { name: "Taskmarket Browser", version: "1.0.0" },
    introspect(message) {
      messages.push({ type: "introspect", message });
    },
    logger(message) {
      messages.push({ type: "logger", message });
    },
  };
}

test("AnythingLLM manifest is loadable, credential-free, and folder-compatible", () => {
  const pluginDirectory = path.join(__dirname, "..", "taskmarket-browser");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(pluginDirectory, "plugin.json"), "utf8")
  );

  assert.equal(manifest.schema, "skill-1.0.0");
  assert.equal(manifest.imported, true);
  assert.equal(manifest.active, true);
  assert.equal(manifest.hubId, path.basename(pluginDirectory));
  assert.equal(manifest.entrypoint.file, "handler.js");
  assert.deepEqual(manifest.setup_args, {});

  const parameterNames = Object.keys(manifest.entrypoint.params).join(" ");
  assert.doesNotMatch(
    parameterNames,
    /api.?key|authorization|cookie|password|private.?key|seed|token|wallet/i
  );
});

test("handler returns an AnythingLLM-compatible JSON string for discovery", async (t) => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return jsonResponse({ tasks: [], nextCursor: null, hasMore: false });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const context = runtimeContext();
  const output = await runtime.handler.call(context, {
    operation: "list_tasks",
    status: "open",
    tags: "AI,agent",
    limit: 5,
  });
  const payload = JSON.parse(output);

  assert.equal(typeof output, "string");
  assert.equal(payload.ok, true);
  assert.equal(payload.readOnly, true);
  assert.equal(payload.operation, "list_tasks");
  assert.deepEqual(payload.tasks, []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, "GET");
  assert.deepEqual(calls[0].init.headers, { accept: "application/json" });
  assert.match(context.messages[0].message, /public read-only/);
});

test("handler validates operations and task IDs before any network request", async (t) => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls += 1;
    return jsonResponse({});
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const context = runtimeContext();
  const invalidOperation = JSON.parse(
    await runtime.handler.call(context, { operation: "create_task" })
  );
  const missingId = JSON.parse(
    await runtime.handler.call(context, { operation: "get_task" })
  );

  assert.equal(invalidOperation.ok, false);
  assert.equal(invalidOperation.readOnly, true);
  assert.equal(invalidOperation.error.code, "INVALID_REQUEST");
  assert.match(invalidOperation.error.message, /Unsupported operation/);
  assert.equal(missingId.ok, false);
  assert.equal(missingId.error.code, "INVALID_TASK_ID");
  assert.equal(calls, 0);
});

test("handler still returns a string when optional runtime hooks fail", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    jsonResponse({ tasks: [], nextCursor: null, hasMore: false });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const output = await runtime.handler.call(
    {
      introspect() {
        throw new Error("UI hook unavailable");
      },
      logger() {
        throw new Error("logger unavailable");
      },
    },
    { operation: "list_tasks" }
  );

  assert.equal(typeof output, "string");
  assert.equal(JSON.parse(output).ok, true);
});

test("handler exposes public submission metadata without artifact locations", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(init.method, "GET");
    assert.equal(new URL(url).searchParams.get("includePreviewUrls"), "none");
    return jsonResponse([
      {
        id: "submission-1",
        taskId: TASK_ID,
        workerAddress: "0x1111111111111111111111111111111111111111",
        fileUrl: "s3://private-location",
        signature: "0xsig",
        submittedAt: "2026-08-10T00:00:00.000Z",
        artifacts: [
          {
            id: "artifact-1",
            role: "final",
            fileName: "deliverable.md",
            mimeType: "text/markdown",
            mediaKind: "text",
            storageUri: "s3://private-location",
            sizeBytes: 100,
            sha256Hash: "sha256",
            keccak256Hash: "keccak",
          },
        ],
      },
    ]);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const output = await runtime.handler.call(runtimeContext(), {
    operation: "list-submissions",
    task_id: TASK_ID,
  });
  const payload = JSON.parse(output);

  assert.equal(payload.ok, true);
  assert.equal(payload.submissionCount, 1);
  assert.equal(payload.submissions[0].artifacts[0].fileName, "deliverable.md");
  assert.equal("fileUrl" in payload.submissions[0], false);
  assert.equal("storageUri" in payload.submissions[0].artifacts[0], false);
});
