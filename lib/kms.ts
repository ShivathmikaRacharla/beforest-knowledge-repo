export type KmsCitation = {
  source?: number;
  file_name?: string;
  dropbox_path?: string;
  page_number?: string | number | null;
  section?: string | null;
  url?: string | null;
  score?: number;
};

export type KmsMatch = {
  score?: number;
  text?: string;
  file_name?: string;
  dropbox_path?: string;
  page_number?: string | number | null;
  section?: string | null;
};

export type KmsDocument = {
  file_name?: string;
  dropbox_path?: string;
  dropbox_file_id?: string;
  owner_name?: string | null;
  uploaded_by?: string | null;
  uploader?: string | null;
  created_by?: string | null;
};

export type KmsRetrieval = {
  retrieved?: boolean;
  question?: string;
  department?: string | null;
  document_count?: number;
  documents?: KmsDocument[];
  matches?: KmsMatch[];
};

export type KmsAnswer = {
  answered?: boolean;
  answer?: string;
  citations?: KmsCitation[];
};

type KnowledgeDocumentsResult = {
  documents: KmsDocument[];
  documentCount: number;
};

const DOCUMENT_LIST_TTL_MS = 60_000;
const DOCUMENT_LIST_STALE_MS = 10 * 60_000;

let documentListCache:
  | (KnowledgeDocumentsResult & { fetchedAt: number })
  | null = null;
let documentListRequest: Promise<KnowledgeDocumentsResult> | null = null;

function getWindmillConfig() {
  const windmillBase = (process.env.BASE_URL || process.env.WINDMILL_BASE_URL || "").replace(/\/$/, "");
  const workspace = process.env.WM_WORKSPACE || process.env.WINDMILL_WORKSPACE;
  const token = process.env.WM_TOKEN || process.env.WINDMILL_TOKEN;
  if (!windmillBase || !workspace || !token) {
    throw new Error("Knowledge backend connection variables are not configured.");
  }
  return { windmillBase, workspace, token };
}

export async function runWindmillScript<T>(
  scriptPath: string,
  body: Record<string, unknown>,
  options?: { timeoutMs?: number },
) {
  const { windmillBase, workspace, token } = getWindmillConfig();
  const controller = options?.timeoutMs ? new AbortController() : null;
  const timeout = controller
    ? setTimeout(() => controller.abort(), options?.timeoutMs)
    : null;
  let response: Response;
  try {
    response = await fetch(`${windmillBase}/api/w/${workspace}/jobs/run_wait_result/p/${scriptPath}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller?.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Knowledge backend request timed out.");
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const detail = typeof data?.error?.message === "string"
      ? data.error.message
      : typeof data?.message === "string"
        ? data.message
        : text;
    throw new Error(detail || `Knowledge backend request failed (${response.status}).`);
  }
  return data as T;
}

export function documentType(fileName?: string) {
  const extension = fileName?.split(".").pop()?.trim().toUpperCase();
  return extension && extension !== fileName?.toUpperCase() ? extension : "Document";
}

export function spaceFromDropboxPath(dropboxPath?: string) {
  if (!dropboxPath) return "Approved documents";
  const normalized = dropboxPath.replaceAll("\\", "/");
  const approvedRoot = process.env.DROPBOX_APPROVED_FOLDER || "/KMS/Approved";
  if (normalized.startsWith(approvedRoot)) return "Approved documents";
  const parts = normalized.split("/").filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 2] : "Approved documents";
}

export function isApprovedDocumentCountQuestion(question: string) {
  return /\b(how many|number of|count)\b/i.test(question)
    && /\b(approved|indexed|available|retrievable)?\s*documents?\b/i.test(question);
}

export async function retrieveKnowledge(question: string, options?: { department?: string; limit?: number }) {
  const retrieval = await runWindmillScript<KmsRetrieval>("f/kms/retrieve_qdrant_chunks", {
    question,
    department: options?.department,
    limit: options?.limit ?? 5,
  }, { timeoutMs: 25_000 });
  if (retrieval.documents?.length || typeof retrieval.document_count === "number") {
    documentListCache = {
      documents: retrieval.documents || documentListCache?.documents || [],
      documentCount:
        retrieval.document_count
        ?? retrieval.documents?.length
        ?? documentListCache?.documentCount
        ?? 0,
      fetchedAt: Date.now(),
    };
  }
  return retrieval;
}

export async function generateGroundedAnswer(
  question: string,
  retrieval: KmsRetrieval,
  options?: { systemPrompt?: string; timeoutMs?: number },
) {
  return runWindmillScript<KmsAnswer>("f/kms/generate_grounded_answer_gemini", {
    question,
    matches: retrieval.matches || [],
    document_count: retrieval.document_count,
    system_prompt: options?.systemPrompt,
  }, { timeoutMs: options?.timeoutMs ?? 45_000 });
}

export async function listKnowledgeDocuments() {
  const now = Date.now();
  if (documentListCache && now - documentListCache.fetchedAt < DOCUMENT_LIST_TTL_MS) {
    return {
      documents: documentListCache.documents,
      documentCount: documentListCache.documentCount,
    };
  }

  if (!documentListRequest) {
    documentListRequest = retrieveKnowledge("how many approved documents are retrievable?", { limit: 1 })
      .then((retrieval) => {
        const result = {
          documents: retrieval.documents || [],
          documentCount: retrieval.document_count ?? retrieval.documents?.length ?? 0,
        };
        documentListCache = { ...result, fetchedAt: Date.now() };
        return result;
      })
      .finally(() => {
        documentListRequest = null;
      });
  }

  try {
    return await documentListRequest;
  } catch (error) {
    if (documentListCache && now - documentListCache.fetchedAt < DOCUMENT_LIST_STALE_MS) {
      return {
        documents: documentListCache.documents,
        documentCount: documentListCache.documentCount,
      };
    }
    throw error;
  }
}

export async function deleteKnowledgeDocument(document: {
  dropboxPath?: string;
  fileName?: string;
  dropboxFileId?: string;
}) {
  const dropboxPath = document.dropboxPath?.trim();
  const fileName = document.fileName?.trim();
  const dropboxFileId = document.dropboxFileId?.trim();
  if (!dropboxPath && !fileName && !dropboxFileId) {
    throw new Error("Document identifier is required.");
  }
  const result = await runWindmillScript<{
    deleted?: boolean;
    points_deleted?: number;
    postgres_updated?: number;
  }>("f/kms/delete_document_from_knowledge_base", {
    dropbox_path: dropboxPath,
    file_name: fileName,
    dropbox_file_id: dropboxFileId,
  }, { timeoutMs: 30_000 });
  documentListCache = null;
  return result;
}
