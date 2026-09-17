import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import {
  generateGroundedAnswer,
  isApprovedDocumentCountQuestion,
  retrieveKnowledge,
  type KmsAnswer,
  type KmsCitation,
} from "@/lib/kms";
import { getSettingValue, saveQueryEvent } from "@/lib/db";
import { DEFAULT_KNOWLEDGE_SYSTEM_PROMPT } from "@/lib/prompts";

export const runtime = "nodejs";
export const maxDuration = 60;

type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

function isGreetingOnly(message: string) {
  const normalized = message.toLowerCase().replace(/[^a-z\s]/g, " ").trim();
  return /^(hi|hello|hey|good morning|good afternoon|good evening|namaste|thanks|thank you)(\s+(there|beforest|ai|team|seshu))*$/.test(normalized);
}

function citationFileName(citation: KmsCitation) {
  return citation.file_name || citation.dropbox_path?.split("/").filter(Boolean).pop() || "Approved knowledge source";
}

function sourceKey(source?: string | null) {
  return (source || "")
    .replaceAll("\\", "/")
    .split("/")
    .filter(Boolean)
    .pop()
    ?.toLowerCase()
    .trim() || "";
}

function selectRelevantCitations(
  citations: KmsCitation[],
  retrieval: Awaited<ReturnType<typeof retrieveKnowledge>>,
) {
  const retrievalScores = new Map<string, number>();
  for (const match of retrieval.matches || []) {
    const key = sourceKey(match.dropbox_path || match.file_name);
    if (!key) continue;
    const score = typeof match.score === "number" ? match.score : 0;
    retrievalScores.set(key, Math.max(retrievalScores.get(key) || 0, score));
  }

  const matched = citations.filter((citation) => {
    const key = sourceKey(citation.dropbox_path || citation.file_name);
    return !retrievalScores.size || retrievalScores.has(key);
  }).map((citation) => {
    if (typeof citation.score === "number") return citation;
    const key = sourceKey(citation.dropbox_path || citation.file_name);
    const score = retrievalScores.get(key);
    return typeof score === "number" ? { ...citation, score } : citation;
  });
  if (matched.length <= 1) return matched;

  // Keep the one document with the strongest evidence so unrelated retrieved
  // documents do not appear as if they supported the answer.
  return [
    [...matched].sort((left, right) => {
      const leftKey = sourceKey(left.dropbox_path || left.file_name);
      const rightKey = sourceKey(right.dropbox_path || right.file_name);
      const leftScore = typeof left.score === "number" ? left.score : retrievalScores.get(leftKey) || 0;
      const rightScore = typeof right.score === "number" ? right.score : retrievalScores.get(rightKey) || 0;
      return rightScore - leftScore;
    })[0],
  ];
}

function uiCitations(citations: KmsCitation[]) {
  const seen = new Set<string>();
  return citations.flatMap((citation, index) => {
    const sourceId = citation.dropbox_path || citation.file_name || `source-${index + 1}`;
    const dedupeKey = sourceId.toLowerCase();
    if (seen.has(dedupeKey)) return [];
    seen.add(dedupeKey);
    return [{
      fileId: sourceId,
      filename: citationFileName(citation),
      score: citation.score,
      excerpt: [
        citation.section ? `Section: ${citation.section}` : "",
        citation.page_number ? `Page: ${citation.page_number}` : "",
        citation.dropbox_path ? `Path: ${citation.dropbox_path}` : "",
      ].filter(Boolean).join(" | ") || "This source was cited in the generated answer.",
      dropboxPath: citation.dropbox_path,
      url: citation.url,
    }];
  });
}

function publicKnowledgeError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unable to query the knowledge base.";
  if (message.includes("qdrant") || message.includes("Qdrant") || message.includes("dns error")) {
    return "Knowledge retrieval is unavailable because the indexed document service cannot be reached. Please check the live backend configuration.";
  }
  if (message.includes("503") || /high demand|temporarily|unavailable/i.test(message)) {
    return "Answer generation is temporarily busy. Please try again in a moment.";
  }
  if (message.includes("429") || /quota|rate.?limit|embedding/i.test(message)) {
    return "Knowledge retrieval is unavailable because the live retrieval service is rate-limited or out of quota.";
  }
  if (message.includes("Gemini") || message.includes("GEMINI")) {
    return "Answer generation is unavailable. Please check the live model configuration.";
  }
  return "Unable to query the approved knowledge base right now.";
}

function isTransientAnswerError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return message.includes("503") || /high demand|temporarily|unavailable|timed out/i.test(message);
}

function canFallbackToRetrievedAnswer(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return isTransientAnswerError(error) || message.includes("429") || /quota|rate.?limit|resource_exhausted/i.test(message);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateGroundedAnswerWithRetry(
  message: string,
  retrieval: Awaited<ReturnType<typeof retrieveKnowledge>>,
  systemPrompt: string,
) {
  try {
    return await generateGroundedAnswer(message, retrieval, { systemPrompt, timeoutMs: 45_000 });
  } catch (error) {
    if (!isTransientAnswerError(error)) throw error;
    await delay(600);
    return generateGroundedAnswer(message, retrieval, { systemPrompt, timeoutMs: 8_000 });
  }
}

function fallbackAnswerFromRetrieval(retrieval: Awaited<ReturnType<typeof retrieveKnowledge>>) {
  const matches = (retrieval.matches || []).filter((match) => match.text);
  if (!matches.length) {
    return {
      answered: false,
      answer:
        "I found the approved knowledge base, but the answer service is temporarily busy. Please try again in a moment.",
      citations: [],
    };
  }

  const sourceGroups = new Map<
    string,
    {
      match: (typeof matches)[number];
      chunks: string[];
    }
  >();
  for (const match of matches) {
    const sourceId = match.dropbox_path || match.file_name || `source-${sourceGroups.size + 1}`;
    const dedupeKey = sourceId.toLowerCase();
    const group = sourceGroups.get(dedupeKey) || { match, chunks: [] };
    const text = String(match.text || "").replace(/\s+/g, " ").trim();
    if (text && group.chunks.length < 3) group.chunks.push(text);
    sourceGroups.set(dedupeKey, group);
  }

  const groups = Array.from(sourceGroups.values()).slice(0, 3);
  const citations = groups.map(({ match }, index) => ({
    source: index + 1,
    file_name: match.file_name,
    dropbox_path: match.dropbox_path,
    page_number: match.page_number,
    section: match.section,
    score: match.score,
  }));
  const excerpts = groups.map(({ match, chunks }, index) => {
    const source = match.file_name || match.dropbox_path || `Source ${index + 1}`;
    const combined = chunks.join(" ");
    return `${index + 1}. ${source}: ${combined.slice(0, 1200)}${combined.length > 1200 ? "..." : ""}`;
  });
  return {
    answered: true,
    answer: [
      "The answer service is temporarily busy, but I found these relevant approved knowledge excerpts:",
      "",
      ...excerpts,
    ].join("\n"),
    citations,
  };
}

export async function POST(request: Request) {
  try {
    const auth = await requireRole(request, ["Admin", "User"]);
    if ("response" in auth) return auth.response;
    const body = (await request.json()) as {
      message?: string;
      history?: ChatTurn[];
      projectName?: string;
      sessionId?: string;
      stream?: boolean;
    };
    const message = body.message?.trim();
    if (!message) {
      return NextResponse.json({ error: "Please enter a question." }, { status: 400 });
    }

    if (isGreetingOnly(message)) {
      const greeting = "Hi! I’m ready. Ask me anything from your approved Beforest knowledge base.";
      if (body.stream) {
        const encoder = new TextEncoder();
        return new globalThis.Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode(`event: delta\ndata: ${JSON.stringify({ delta: greeting })}\n\n`));
              controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ answer: greeting, citations: [], responseId: null, model: "knowledge-backend", skippedRetrieval: true })}\n\n`));
              controller.close();
            },
          }),
          {
            headers: {
              "Content-Type": "text/event-stream; charset=utf-8",
              "Cache-Control": "no-cache, no-transform",
              Connection: "keep-alive",
            },
          },
        );
      }
      return NextResponse.json({ answer: greeting, citations: [], model: "knowledge-backend", skippedRetrieval: true });
    }

    const startedAt = Date.now();
    const systemPrompt = await getSettingValue("knowledge.systemPrompt", DEFAULT_KNOWLEDGE_SYSTEM_PROMPT);
    const retrieval = await retrieveKnowledge(message, { limit: 5 });
    let answer: KmsAnswer | null = isApprovedDocumentCountQuestion(message)
      ? {
          answered: true,
          answer: `There are ${
            retrieval.document_count ?? retrieval.documents?.length ?? 0
          } approved documents available in the knowledge base.`,
          citations: [],
        }
      : null;
    if (!answer) {
      try {
        answer = await generateGroundedAnswerWithRetry(message, retrieval, systemPrompt);
      } catch (error) {
        if (!canFallbackToRetrievedAnswer(error)) throw error;
        console.warn("Using retrieval fallback because answer generation is unavailable", error);
        answer = fallbackAnswerFromRetrieval(retrieval);
      }
    }
    const citations = uiCitations(selectRelevantCitations(answer.citations || [], retrieval));
    const responseText = answer.answer || "I could not find an answer in the approved knowledge base.";
    const scores = (retrieval.matches || [])
      .map((match) => match.score)
      .filter((score): score is number => typeof score === "number");

    const conversationHistoryEnabled = (await getSettingValue("conversationHistory", "true")) !== "false";
    if (body.sessionId && conversationHistoryEnabled) {
      await saveQueryEvent({
        sessionId: body.sessionId,
        userName: auth.user.name,
        query: message,
        model: "knowledge-backend",
        latencyMs: Date.now() - startedAt,
        chunks: retrieval.matches?.length || 0,
        topScore: scores.length ? Math.max(...scores) : null,
        sources: citations.map((citation) => citation.filename),
        responseId: null,
        filterUsed: { provider: "knowledge-backend", documentCount: retrieval.document_count ?? null },
        maxNumResults: 5,
        traces: (retrieval.matches || []).map((match, index) => ({
          documentId: match.dropbox_path || match.file_name || null,
          fileId: match.dropbox_path || match.file_name || null,
          filename: match.file_name || match.dropbox_path || `source-${index + 1}`,
          retrievedText: match.text || null,
          retrievalScore: match.score ?? null,
          citation: match.file_name || match.dropbox_path || null,
        })),
      });
    }

    if (body.stream) {
      const encoder = new TextEncoder();
      return new globalThis.Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`event: delta\ndata: ${JSON.stringify({ delta: responseText })}\n\n`));
            controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ answer: responseText, citations, responseId: null, model: "knowledge-backend" })}\n\n`));
            controller.close();
          },
        }),
        {
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          },
        },
      );
    }

    return NextResponse.json({
      answer: responseText,
      citations,
      responseId: null,
      model: "knowledge-backend",
    });
  } catch (error) {
    console.error("Chat request failed", error);
    return NextResponse.json({ error: publicKnowledgeError(error) }, { status: 503 });
  }
}
