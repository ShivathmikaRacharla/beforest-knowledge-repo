import assert from "node:assert/strict";
import test from "node:test";
import { addFuzzyTitleLookup, findFuzzyDocumentCandidate } from "./fuzzy-retrieval.ts";

const inventory = {
  file_name: "BI_DATA-INVENTORY_Supabase-Audience-Data-Buckets_V1_2026-08-28.pdf",
  dropbox_path: "/Apps/KMS-Documents/Business Intelligence/BI_DATA-INVENTORY_Supabase-Audience-Data-Buckets_V1_2026-08-28.pdf",
};
const bulletin = {
  file_name: "BUSINESS-INTELLIGENCE_BULLETIN_Monthly-Updates-September_V1_2026-10-07.pdf",
  dropbox_path: "/Apps/KMS-Documents/Business Intelligence/BUSINESS-INTELLIGENCE_BULLETIN_Monthly-Updates-September_V1_2026-10-07.pdf",
};
const question = "can you goive me last month monthly bulliten data for BI team";
const now = new Date("2026-10-13T12:00:00Z");

test("matches a title typo and compares month and team metadata without rewriting the query", () => {
  const original = question;
  const candidate = findFuzzyDocumentCandidate(question, [inventory, bulletin], now);
  assert.equal(candidate?.document.file_name, bulletin.file_name);
  assert.deepEqual(candidate?.matchedTypo, { queryTerm: "bulliten", titleTerm: "bulletin" });
  assert.equal(question, original);
});

test("uses an exact-title lookup while keeping the original retrieval and question intact", async () => {
  const original = { documents: [inventory, bulletin], matches: [{ ...inventory, text: "Unrelated inventory", score: 0.721 }] };
  const calls = [];
  const result = await addFuzzyTitleLookup(question, original, async (title) => {
    calls.push(title);
    return { matches: [
      { ...bulletin, text: "September BI bulletin updates", score: 0.628 },
      { ...inventory, text: "Unrelated inventory", score: 0.7 },
    ] };
  }, now);
  assert.deepEqual(calls, [bulletin.file_name]);
  assert.deepEqual(result.retrieval.matches?.map((match) => match.file_name), [bulletin.file_name]);
  assert.equal(original.matches[0].file_name, inventory.file_name);
  assert.equal(question, "can you goive me last month monthly bulliten data for BI team");
});

test("does not alter or look up correctly spelled internal names", async () => {
  const original = { documents: [{ file_name: "Beforest_Project_Guide.pdf" }], matches: [] };
  const result = await addFuzzyTitleLookup("Show the Beforest project guide", original, async () => {
    assert.fail("no supplemental lookup expected");
  }, now);
  assert.equal(result.retrieval, original);
  assert.equal(result.candidate, null);
});

test("does not choose between equally plausible documents", () => {
  const other = { file_name: "BUSINESS-INTELLIGENCE_BULLETIN_Monthly-Updates-August_V1_2026-09-07.pdf", dropbox_path: "/Apps/KMS-Documents/Business Intelligence/BUSINESS-INTELLIGENCE_BULLETIN_Monthly-Updates-August_V1_2026-09-07.pdf" };
  assert.equal(findFuzzyDocumentCandidate("show BI monthly bulliten", [bulletin, other], now), null);
});

test("does not promote an older monthly document for a last-month question", () => {
  const old = { file_name: "BUSINESS-INTELLIGENCE_BULLETIN_Monthly-Updates-February_V1_2026-03-07.pdf", dropbox_path: "/Apps/KMS-Documents/Business Intelligence/BUSINESS-INTELLIGENCE_BULLETIN_Monthly-Updates-February_V1_2026-03-07.pdf" };
  assert.equal(findFuzzyDocumentCandidate(question, [inventory, old], now), null);
});

test("falls back to the unchanged results when exact-title lookup has no matching chunks", async () => {
  const original = { documents: [inventory, bulletin], matches: [{ ...inventory, text: "Inventory text" }] };
  const result = await addFuzzyTitleLookup(question, original, async () => ({ matches: [{ ...inventory, text: "Inventory text" }] }), now);
  assert.equal(result.retrieval, original);
  assert.equal(result.candidate, null);
});
