import { NextResponse } from "next/server";
import type {
  ResponseFileSearchToolCall,
  ResponseOutputText,
} from "openai/resources/responses/responses";
import {
  getModel,
  getSystemPrompt,
  getOpenAI,
  getVectorStoreId,
  publicOpenAIError,
} from "@/lib/openai";
import { requireRole } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

type Citation = {
  fileId: string;
  filename: string;
  score?: number;
  excerpt?: string;
};

type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

export async function POST(request: Request) {
  try {
    const auth = requireRole(request, ["Admin", "User"]);
    if ("response" in auth) return auth.response;
    const body = (await request.json()) as {
      message?: string;
      history?: ChatTurn[];
      projectName?: string;
    };
    const message = body.message?.trim();
    if (!message)
      return NextResponse.json(
        { error: "Please enter a question." },
        { status: 400 },
      );

    const client = getOpenAI();
    const history = Array.isArray(body.history)
      ? body.history
          .filter(
            (turn): turn is ChatTurn =>
              (turn?.role === "user" || turn?.role === "assistant") &&
              typeof turn.content === "string" &&
              turn.content.trim().length > 0,
          )
          .slice(-12)
          .map((turn) => ({ role: turn.role, content: turn.content }))
      : [];
    const response = await client.responses.create({
      model: getModel(),
      instructions: `${getSystemPrompt()}${body.projectName ? `\n\nThe user is working inside the project “${body.projectName}”. Keep the conversation focused on that project and use the existing conversation history to maintain continuity.` : ""}\n\nFormat the answer in clean Markdown. Use short descriptive headings, concise paragraphs, and bullet points where they improve readability. Use tables only for genuine comparisons. Avoid dense walls of text.`,
      input: [
        ...history,
        { role: "user", content: message },
      ],
      tools: [
        {
          type: "file_search",
          vector_store_ids: [getVectorStoreId()],
          max_num_results: 10,
          ranking_options: {
            ranker: "auto",
            score_threshold: 0.15,
            hybrid_search: {
              embedding_weight: 0.65,
              text_weight: 0.35,
            },
          },
        },
      ],
      include: ["file_search_call.results"],
    });

    const citations = new Map<string, Citation>();
    for (const item of response.output) {
      if (item.type === "file_search_call") {
        for (const result of (item as ResponseFileSearchToolCall).results ??
          []) {
          if (!result.file_id || !result.filename) continue;
          citations.set(result.file_id, {
            fileId: result.file_id,
            filename: result.filename,
            score: result.score,
            excerpt: result.text,
          });
        }
      }
      if (item.type === "message") {
        for (const content of item.content) {
          if (content.type !== "output_text") continue;
          for (const annotation of ((content as ResponseOutputText).annotations ?? [])) {
            if (annotation.type !== "file_citation") continue;
            const existing = citations.get(annotation.file_id);
            citations.set(annotation.file_id, {
              fileId: annotation.file_id,
              filename: annotation.filename,
              score: existing?.score,
              excerpt: existing?.excerpt,
            });
          }
        }
      }
    }

    return NextResponse.json({
      answer: response.output_text,
      citations: Array.from(citations.values()).sort(
        (a, b) => (b.score ?? 0) - (a.score ?? 0),
      ),
      responseId: response.id,
      model: getModel(),
    });
  } catch (error) {
    console.error("Chat request failed", error);
    const result = publicOpenAIError(error, "Unable to query the knowledge base.");
    return NextResponse.json({ error: result.message }, { status: result.status });
  }
}
