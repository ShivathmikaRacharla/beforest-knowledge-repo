import assert from "node:assert/strict";
import test from "node:test";
import { buildFollowUpContext, matchesReferencedDocument } from "./chat-context.ts";

const history = [
  { role: "user", content: "Can you summarise the guidance of the Content and Storytelling team?" },
  { role: "assistant", content: "The guide covers voice, story structure, and review.", citations: [
    { filename: "CONTENT-STORYTELLING_GUIDE.pdf", dropboxPath: "/Knowledge/Content/CONTENT-STORYTELLING_GUIDE.pdf" },
  ] },
];

test("follow-up carries the prior answer and cited document into retrieval and generation", () => {
  const context = buildFollowUpContext("What are the key points covered in the document?", history);
  assert.equal(context?.documentKey, "/knowledge/content/content-storytelling_guide.pdf");
  assert.match(context?.retrievalQuestion || "", /CONTENT-STORYTELLING_GUIDE\.pdf/);
  assert.match(context?.retrievalQuestion || "", /guidance of the Content and Storytelling team/);
  assert.match(context?.answerQuestion || "", /The guide covers voice/);
  assert.match(context?.answerQuestion || "", /not evidence/);
});

test("follow-up matches the cited path, not an identically named file elsewhere", () => {
  const key = buildFollowUpContext("What are the key points in the document?", history)?.documentKey || "";
  assert.equal(matchesReferencedDocument({ file_name: "CONTENT-STORYTELLING_GUIDE.pdf", dropbox_path: "/Knowledge/Content/CONTENT-STORYTELLING_GUIDE.pdf" }, key), true);
  assert.equal(matchesReferencedDocument({ file_name: "CONTENT-STORYTELLING_GUIDE.pdf", dropbox_path: "/Other/CONTENT-STORYTELLING_GUIDE.pdf" }, key), false);
});

test("a new topic does not inherit the previous document", () => {
  assert.equal(buildFollowUpContext("What is the September BI bulletin about?", history), null);
});

test("an uncited previous answer does not pin an unrelated document", () => {
  assert.equal(buildFollowUpContext("What are the key points in the document?", [
    ...history,
    { role: "user", content: "Different topic" },
    { role: "assistant", content: "No supported answer.", citations: [] },
  ]), null);
});
