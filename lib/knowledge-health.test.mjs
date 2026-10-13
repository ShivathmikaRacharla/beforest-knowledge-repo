import assert from "node:assert/strict";
import test from "node:test";
import { buildKnowledgeHealth, matchesApprovedDocument } from "./knowledge-health.ts";

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
