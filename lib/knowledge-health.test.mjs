import assert from "node:assert/strict";
import test from "node:test";
import { buildKnowledgeHealth, buildMonthlyProcessing, buildMonthlySuccessRates, matchesApprovedDocument } from "./knowledge-health.ts";

const document = { file_name: "BI_BULLETIN_September.pdf", dropbox_path: "/Apps/KMS/BI/BI_BULLETIN_September.pdf" };
const modules = ["download", "extract", "chunk", "index", "status_ready"];

test("completed flow stages make a document ready without inventing retrieval checks", () => {
  const run = {
    id: "run-1", script_path: "f/kms/process_approved_document_pipeline", created_at: "2026-10-13T08:00:00Z", success: true,
    args: { file_name: document.file_name, dropbox_path: document.dropbox_path },
    flow_status: { modules: modules.map((id) => ({ id, type: "Success", job: `${id}-job` })) },
  };
  const [health] = buildKnowledgeHealth([document], [run]);
  assert.equal(health.status, "ready");
  assert.deepEqual(health.stages.map((stage) => stage.state), ["complete", "complete", "complete", "complete"]);
  assert.equal(health.stages[2].label, "Embedded & indexed");
});

test("latest failed run is shown even when a previous version is indexed", () => {
  const oldRun = { id: "old", created_at: "2026-10-12T08:00:00Z", success: true, args: document, flow_status: { modules: modules.map((id) => ({ id, type: "Success" })) } };
  const newRun = { id: "new", created_at: "2026-10-13T08:00:00Z", success: false, args: document, flow_status: { modules: [{ id: "extract", type: "Failure" }] } };
  const [health] = buildKnowledgeHealth([document], [oldRun, newRun]);
  assert.equal(health.runId, "new");
  assert.equal(health.status, "failed");
  assert.match(health.note, /older indexed version/i);
});

test("catalog-only documents do not receive fabricated stage history", () => {
  const [health] = buildKnowledgeHealth([document], []);
  assert.equal(health.status, "indexed");
  assert.ok(health.stages.every((stage) => stage.state === "unknown"));
});

test("all 100 catalog documents remain visible with available run histories", () => {
  const documents = Array.from({ length: 100 }, (_, index) => ({
    file_name: `document-${index}.pdf`,
    dropbox_path: `/kms/document-${index}.pdf`,
  }));
  const runs = documents.slice(0, 60).map((item, index) => ({
    id: `run-${index}`,
    created_at: "2026-10-13T08:00:00Z",
    success: true,
    args: item,
    flow_status: { modules: modules.map((id) => ({ id, type: "Success" })) },
  }));
  const health = buildKnowledgeHealth(documents, runs);
  assert.equal(health.length, 100);
  assert.equal(health.filter((item) => item.status === "ready").length, 60);
  assert.equal(health.filter((item) => item.status === "indexed").length, 40);
});

test("retrieval verification requires the approved document source", () => {
  assert.equal(matchesApprovedDocument({ ...document, text: "Excerpt" }, document), true);
  assert.equal(matchesApprovedDocument({ file_name: document.file_name, dropbox_path: "/Other/BI_BULLETIN_September.pdf" }, document), false);
});

test("monthly processing uses verified stage dates and counts each document once per stage", () => {
  const runs = [
    { id: "old", args: document, flow_status: { modules: [{ id: "chunk", type: "Success", job: "chunk-old" }] } },
    { id: "new", args: document, flow_status: { modules: [{ id: "chunk", type: "Success", job: "chunk-new" }, { id: "index", type: "Success", job: "index-new" }] } },
    { id: "failed", args: { file_name: "Other.pdf" }, flow_status: { modules: [{ id: "index", type: "Failure", job: "index-failed" }] } },
  ];
  const dates = new Map([
    ["chunk-old", "2026-09-29T10:00:00Z"],
    ["chunk-new", "2026-10-01T01:00:00Z"],
    ["index-new", "2026-10-02T01:00:00Z"],
    ["index-failed", "2026-10-02T01:00:00Z"],
  ]);
  assert.deepEqual(buildMonthlyProcessing(runs, dates), [{ year: 2026, month: 10, chunked: 1, embedded: 1 }]);
});

test("monthly processing excludes legacy documents and stages without a completion timestamp", () => {
  const runs = [
    { id: "legacy", args: document, flow_status: { modules: [] } },
    { id: "incomplete", args: { file_name: "Other.pdf" }, flow_status: { modules: [{ id: "chunk", type: "Success", job: "no-date" }] } },
  ];
  assert.deepEqual(buildMonthlyProcessing(runs, new Map()), []);
});

test("monthly processing assigns a completed stage to its Asia/Kolkata month", () => {
  const runs = [{ id: "run", args: document, flow_status: { modules: [{ id: "chunk", type: "Success", job: "chunk" }] } }];
  assert.deepEqual(buildMonthlyProcessing(runs, new Map([["chunk", "2026-09-30T23:59:59Z"]])),
    [{ year: 2026, month: 10, chunked: 1, embedded: 0 }]);
});

test("success rate uses completed successful and failed runs, not distinct documents", () => {
  const runs = [
    { id: "success-1", args: document, completed_at: "2026-10-02T10:00:00Z", success: true, canceled: false },
    { id: "success-2", args: document, completed_at: "2026-10-03T10:00:00Z", success: true, canceled: false },
    { id: "failed", args: document, completed_at: "2026-10-04T10:00:00Z", success: false, canceled: false },
  ];
  const [result] = buildMonthlySuccessRates(runs);
  assert.deepEqual({ year: result.year, month: result.month, successful: result.successful, failed: result.failed },
    { year: 2026, month: 10, successful: 2, failed: 1 });
  assert.ok(Math.abs(result.rate - 200 / 3) < 0.000001);
});

test("success rate excludes canceled, active, queued, and unknown-status runs", () => {
  const completed = { completed_at: "2026-10-04T10:00:00Z", canceled: false };
  assert.deepEqual(buildMonthlySuccessRates([
    { ...completed, success: true },
    { ...completed, success: false, canceled: true },
    { ...completed, success: false, canceled: undefined },
    { ...completed, success: undefined },
    { success: false, canceled: false },
    { ...completed, success: false, completed_at: "invalid" },
  ]), [{ year: 2026, month: 10, successful: 1, failed: 0, rate: 100 }]);
});

test("success rate uses completion month in Asia/Kolkata, not creation month", () => {
  const runs = [{ created_at: "2026-09-01T00:00:00Z", completed_at: "2026-09-30T23:59:59Z", success: false, canceled: false }];
  assert.deepEqual(buildMonthlySuccessRates(runs), [{ year: 2026, month: 10, successful: 0, failed: 1, rate: 0 }]);
});
