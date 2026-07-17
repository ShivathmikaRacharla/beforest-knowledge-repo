import OpenAI from "openai";
import { getActiveModelConfig } from "@/lib/db";

export function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  return new OpenAI({ apiKey });
}

export function getVectorStoreId() {
  const id = process.env.OPENAI_VECTOR_STORE_ID?.trim();
  if (!id) throw new Error("OPENAI_VECTOR_STORE_ID is not configured.");
  return id;
}

export function getModel() {
  const active = getActiveModelConfig() as { generationModel?: string } | undefined;
  return active?.generationModel || process.env.OPENAI_MODEL?.trim() || "gpt-5-mini";
}

export function getSystemPrompt() {
  const active = getActiveModelConfig() as { systemPrompt?: string } | undefined;
  return active?.systemPrompt || "You are Beforest AI. Answer using only evidence retrieved from the connected knowledge base. Cite the source filenames naturally. If the evidence is insufficient, say so clearly and do not guess.";
}

export function publicOpenAIError(error: unknown, fallback: string) {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: number }).status) || 500
      : 500;
  if (status === 401) {
    return {
      status,
      message:
        "OpenAI authentication failed. Update OPENAI_API_KEY with the original API key and restart the app.",
    };
  }
  if (status === 404) {
    return {
      status,
      message:
        "The configured OpenAI vector store or model was not found. Check OPENAI_VECTOR_STORE_ID and OPENAI_MODEL.",
    };
  }
  if (status === 429) {
    return {
      status,
      message:
        "OpenAI rate or usage limits were reached. Check the API project limits and try again.",
    };
  }
  if (status === 400) {
    return {
      status,
      message: "OpenAI rejected this request. Check the configured model, vector store, and query format.",
    };
  }
  const detail = error instanceof Error ? error.message : "";
  return { status, message: detail ? `${fallback} (${detail})` : fallback };
}
