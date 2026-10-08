export type ConversationTurn = {
  role: "user" | "assistant";
  content: string;
  citations?: Array<{ filename?: string; dropboxPath?: string; fileId?: string }>;
};

function documentKey(value?: string) {
  return (value || "").replaceAll("\\", "/").toLowerCase().trim();
}

export function matchesReferencedDocument(match: { file_name?: string; dropbox_path?: string }, key: string) {
  if (!key) return false;
  if (key.includes("/")) return documentKey(match.dropbox_path) === key;
  return documentKey(match.file_name || match.dropbox_path?.split("/").pop()) === key;
}

export function buildFollowUpContext(question: string, history: ConversationTurn[] | undefined) {
  if (!Array.isArray(history) || !/\b(?:it|its|them|those|these|the document|that document|the file|that file|the source|that source|the answer|above|previous|earlier|tell me more|key points|main takeaways)\b/i.test(question)) {
    return null;
  }

  const turns = history.filter((turn) =>
    (turn.role === "user" || turn.role === "assistant") && typeof turn.content === "string" && turn.content.trim(),
  ).slice(-8);
  const lastAssistantIndex = turns.findLastIndex((turn) => turn.role === "assistant");
  if (lastAssistantIndex < 0) return null;
  const lastAssistant = turns[lastAssistantIndex];
  const lastUser = [...turns.slice(0, lastAssistantIndex)].reverse().find((turn) => turn.role === "user");
  const sources = (Array.isArray(lastAssistant.citations) ? lastAssistant.citations : [])
    .filter((citation) => citation && typeof citation.filename === "string" && citation.filename.trim())
    .slice(0, 3);
  if (!lastUser || !sources.length) return null;

  const referencedDocument = sources.length === 1 ? sources[0] : null;
  const recentTurns = turns.map((turn) => {
    const citationNames = turn.role === "assistant" && Array.isArray(turn.citations)
      ? turn.citations.filter((citation) => typeof citation?.filename === "string").map((citation) => citation.filename).slice(0, 3)
      : [];
    return `${turn.role === "user" ? "User" : "Assistant"}: ${turn.content.trim().slice(0, 1000)}${citationNames.length ? `\nCited documents: ${citationNames.join(", ")}` : ""}`;
  }).join("\n");

  return {
    retrievalQuestion: `${question} ${lastUser.content.trim().slice(0, 300)} ${referencedDocument?.filename || sources.map((source) => source.filename).join(" ")}`,
    answerQuestion: [
      `Current question: ${question}`,
      `Recent conversation (for resolving references only, not evidence):\n${recentTurns}`,
      `Answer using only retrieved excerpts from the referenced document${referencedDocument ? ` ${referencedDocument.filename}` : "s"}. Do not treat earlier answers as evidence.`,
    ].join("\n\n"),
    documentKey: referencedDocument ? documentKey(referencedDocument.dropboxPath || referencedDocument.filename) : null,
  };
}
