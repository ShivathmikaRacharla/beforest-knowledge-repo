import { listKnowledgeDocuments } from "./kms";
import { buildKnowledgeHealth, HEALTH_STAGES, type HealthDocument, type HealthStageId, type WindmillFlowJob } from "./knowledge-health";

const FLOW_PATH = "f/kms/process_approved_document_pipeline";
const CACHE_MS = 20_000;
const HISTORY_PAGE_SIZE = 100;
let cached: { expiresAt: number; value: { documents: HealthDocument[]; warning?: string } } | null = null;
const completedFlowJobs = new Map<string, WindmillFlowJob>();

type WindmillStepJob = {
  id?: string;
  started_at?: string;
  completed_at?: string;
  success?: boolean;
  args?: { chunk_count?: number };
  result?: { element_count?: number; chunk_count?: number; point_count?: number };
};

function config() {
  const base = (process.env.BASE_URL || process.env.WINDMILL_BASE_URL || "").replace(/\/$/, "");
  const workspace = process.env.WM_WORKSPACE || process.env.WINDMILL_WORKSPACE;
  const token = process.env.WM_TOKEN || process.env.WINDMILL_TOKEN;
  if (!base || !workspace || !token) throw new Error("Windmill connection is not configured.");
  return { base, workspace, token };
}

async function windmillGet<T>(path: string): Promise<T> {
  const { base, workspace, token } = config();
  const response = await fetch(`${base}/api/w/${encodeURIComponent(workspace)}/${path}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Windmill health read failed: HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

async function readFlowJob(id: string) {
  return windmillGet<WindmillFlowJob>(`jobs_u/get/${encodeURIComponent(id)}`);
}

async function allFlowJobs() {
  const summaries: WindmillFlowJob[] = [];
  const seen = new Set<string>();
  const seenCursors = new Set<string>();
  let before: string | undefined;
  let historyComplete = true;
  while (true) {
    // This Windmill instance repeats page=1 for page=2; a timestamp cursor returns older jobs.
    const query = `jobs/list?per_page=${HISTORY_PAGE_SIZE}&script_path_exact=${encodeURIComponent(FLOW_PATH)}`
      + (before ? `&created_or_started_before=${encodeURIComponent(before)}` : "");
    let page: WindmillFlowJob[];
    try {
      page = await windmillGet<WindmillFlowJob[]>(query);
    } catch (error) {
      if (!summaries.length) throw error;
      historyComplete = false;
      break;
    }
    if (!Array.isArray(page)) throw new Error("Windmill returned an unexpected job list.");
    let added = 0;
    for (const summary of page) {
      if (!summary.id || seen.has(summary.id)) continue;
      seen.add(summary.id);
      summaries.push(summary);
      added++;
    }
    if (page.length < HISTORY_PAGE_SIZE) break;
    const nextBefore = page.at(-1)?.created_at;
    if (!added || !nextBefore || seenCursors.has(nextBefore)) {
      historyComplete = false;
      break;
    }
    seenCursors.add(nextBefore);
    before = nextBefore;
  }

  const runs: WindmillFlowJob[] = [];
  // Bound concurrent reads so an admin refresh does not flood Windmill.
  for (let offset = 0; offset < summaries.length; offset += 8) {
    const batch = await Promise.allSettled(summaries.slice(offset, offset + 8).map(async (summary) => {
      const id = summary.id!;
      const previous = completedFlowJobs.get(id);
      const job = previous || await readFlowJob(id);
      if (job.completed_at) completedFlowJobs.set(id, job);
      return job;
    }));
    for (const result of batch) {
      if (result.status === "fulfilled" && result.value.script_path === FLOW_PATH) runs.push(result.value);
      else historyComplete = false;
    }
  }
  for (const id of completedFlowJobs.keys()) {
    if (!seen.has(id)) completedFlowJobs.delete(id);
  }
  return { runs, historyComplete };
}

export async function getKnowledgeHealth(forceRefresh = false) {
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.value;
  const [catalogResult, flowResult] = await Promise.allSettled([listKnowledgeDocuments(), allFlowJobs()]);
  if (catalogResult.status === "rejected" && flowResult.status === "rejected") {
    throw new Error("Document catalog and processing history are unavailable.");
  }
  const catalog = catalogResult.status === "fulfilled" ? catalogResult.value.documents : [];
  const runs = flowResult.status === "fulfilled" ? flowResult.value.runs : [];
  const warning = flowResult.status === "rejected"
    ? "Processing history is temporarily unavailable; indexed documents are still listed."
    : catalogResult.status === "rejected"
      ? "The indexed document catalog is temporarily unavailable; processing runs are shown."
      : !flowResult.value.historyComplete
        ? "Some processing history could not be loaded; stage history may be incomplete."
        : undefined;
  const value = { documents: buildKnowledgeHealth(catalog, runs), ...(warning ? { warning } : {}) };
  cached = { expiresAt: Date.now() + CACHE_MS, value };
  return value;
}

export async function getKnowledgeHealthTrace(runId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(runId)) throw new Error("Invalid processing run ID.");
  const run = await readFlowJob(runId);
  if (run.script_path !== FLOW_PATH) throw new Error("Not a knowledge document processing run.");
  const modules = new Map((run.flow_status?.modules || []).map((stepModule) => [stepModule.id, stepModule]));
  const stepResults = await Promise.allSettled(HEALTH_STAGES.map(async (stage) => {
    const jobId = modules.get(stage)?.job;
    return jobId ? windmillGet<WindmillStepJob>(`jobs_u/get/${encodeURIComponent(jobId)}`) : null;
  }));
  const stages = HEALTH_STAGES.map((id: HealthStageId, index) => {
    const stepModule = modules.get(id);
    const step = stepResults[index].status === "fulfilled" ? stepResults[index].value : null;
    const count = id === "extract" ? step?.result?.element_count
      : id === "chunk" ? step?.result?.chunk_count
        : id === "index" ? step?.result?.point_count
          : step?.args?.chunk_count;
    const countLabel = id === "extract" ? "elements" : id === "index" ? "vectors" : "chunks";
    return {
      id,
      state: stepModule?.type || "WaitingForPriorSteps",
      jobId: stepModule?.job || null,
      startedAt: step?.started_at || null,
      completedAt: step?.completed_at || null,
      count: typeof count === "number" ? count : null,
      countLabel,
    };
  });
  return { runId, fileName: run.args?.file_name || "Document", stages };
}
