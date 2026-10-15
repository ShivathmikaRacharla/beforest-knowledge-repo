import type { KmsDocument, KmsMatch } from "./kms";

export const HEALTH_STAGES = ["extract", "chunk", "index", "status_ready"] as const;
export type HealthStageId = typeof HEALTH_STAGES[number];
export type HealthStageState = "complete" | "active" | "failed" | "pending" | "unknown";
export type HealthStage = { id: HealthStageId; label: string; state: HealthStageState; jobId?: string };
export type HealthDocument = {
  id: string;
  fileName: string;
  dropboxPath: string;
  runId?: string;
  updatedAt?: string;
  status: "ready" | "processing" | "failed" | "indexed";
  stages: HealthStage[];
  chunkCount?: number;
  note?: string;
};

export type WindmillFlowJob = {
  id?: string;
  script_path?: string;
  created_at?: string;
  completed_at?: string;
  success?: boolean;
  args?: { file_name?: string; dropbox_path?: string; dropbox_file_id?: string };
  flow_status?: { modules?: Array<{ id?: string; type?: string; job?: string; skipped?: boolean }> };
};

export type MonthlyProcessing = { year: number; month: number; chunked: number; embedded: number };

export function buildMonthlyProcessing(
  runs: WindmillFlowJob[],
  completedAtByJob: Map<string, string>,
): MonthlyProcessing[] {
  const latest = new Map<string, string>();
  for (const run of runs) {
    const source = documentKey(run.args || {});
    if (!source) continue;
    for (const [stage, metric] of [["chunk", "chunked"], ["index", "embedded"]] as const) {
      const stageModule = run.flow_status?.modules?.find((item) => item.id === stage);
      const completedAt = stageModule?.type === "Success" && stageModule.job ? completedAtByJob.get(stageModule.job) : undefined;
      if (!completedAt || !Number.isFinite(Date.parse(completedAt))) continue;
      const key = `${source}\0${metric}`;
      if (!latest.has(key) || Date.parse(completedAt) > Date.parse(latest.get(key)!)) latest.set(key, completedAt);
    }
  }
  const monthly = new Map<string, MonthlyProcessing>();
  for (const [key, completedAt] of latest) {
    const metric = key.split("\0")[1] as "chunked" | "embedded";
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", year: "numeric", month: "numeric" })
      .formatToParts(new Date(completedAt));
    const year = Number(parts.find((part) => part.type === "year")?.value);
    const month = Number(parts.find((part) => part.type === "month")?.value);
    const bucketKey = `${year}-${month}`;
    const bucket = monthly.get(bucketKey) || { year, month, chunked: 0, embedded: 0 };
    bucket[metric]++;
    monthly.set(bucketKey, bucket);
  }
  return [...monthly.values()].sort((left, right) => left.year - right.year || left.month - right.month);
}

const STAGE_LABELS: Record<HealthStageId, string> = {
  extract: "Extracted",
  chunk: "Chunked",
  index: "Embedded & indexed",
  status_ready: "Ready",
};

function normalizedPath(path?: string) {
  return (path || "").replaceAll("\\", "/").toLowerCase().trim();
}

function documentKey(value: { dropbox_path?: string; file_name?: string }) {
  return normalizedPath(value.dropbox_path) || value.file_name?.toLowerCase().trim() || "";
}

function stageState(type?: string): HealthStageState {
  if (type === "Success") return "complete";
  if (type === "Failure") return "failed";
  if (type === "InProgress" || type === "WaitingForExecutor" || type === "WaitingForEvents") return "active";
  return "pending";
}

function stagesForRun(run: WindmillFlowJob): HealthStage[] {
  const modules = new Map((run.flow_status?.modules || []).map((stepModule) => [stepModule.id, stepModule]));
  return HEALTH_STAGES.map((id) => {
    const stepModule = modules.get(id);
    return {
      id,
      label: STAGE_LABELS[id],
      state: stepModule?.skipped ? "unknown" : stageState(stepModule?.type),
      ...(stepModule?.job ? { jobId: stepModule.job } : {}),
    };
  });
}

export function buildKnowledgeHealth(documents: KmsDocument[], runs: WindmillFlowJob[]): HealthDocument[] {
  const latestRuns = new Map<string, WindmillFlowJob>();
  for (const run of runs) {
    const key = documentKey(run.args || {});
    if (!key || !run.id) continue;
    const existing = latestRuns.get(key);
    if (!existing || (run.created_at || "") > (existing.created_at || "")) latestRuns.set(key, run);
  }

  const catalog = new Map<string, KmsDocument>();
  for (const document of documents) {
    const key = documentKey(document);
    if (key) catalog.set(key, document);
  }

  const keys = new Set([...catalog.keys(), ...latestRuns.keys()]);
  return [...keys].map((key): HealthDocument => {
    const document = catalog.get(key);
    const run = latestRuns.get(key);
    const fileName = run?.args?.file_name || document?.file_name || key.split("/").pop() || "Untitled document";
    const dropboxPath = run?.args?.dropbox_path || document?.dropbox_path || "";
    if (!run) {
      return {
        id: key,
        fileName,
        dropboxPath,
        status: "indexed" as const,
        stages: HEALTH_STAGES.map((id) => ({ id, label: STAGE_LABELS[id], state: "unknown" as const })),
        note: "Indexed document; stage history unavailable.",
      };
    }
    const stages = stagesForRun(run);
    const ready = stages.find((stage) => stage.id === "status_ready")?.state === "complete" && run.success === true;
    const failed = run.success === false || stages.some((stage) => stage.state === "failed");
    return {
      id: key,
      fileName,
      dropboxPath,
      runId: run.id,
      updatedAt: run.completed_at || run.created_at,
      status: ready ? "ready" as const : failed ? "failed" as const : "processing" as const,
      stages,
      ...(failed && catalog.has(key) ? { note: "Latest processing attempt failed; an older indexed version may still be searchable." } : {}),
    };
  }).sort((left, right) => (right.updatedAt || "").localeCompare(left.updatedAt || "") || left.fileName.localeCompare(right.fileName));
}

export function matchesApprovedDocument(match: KmsMatch, document: KmsDocument) {
  const expectedPath = normalizedPath(document.dropbox_path);
  const actualPath = normalizedPath(match.dropbox_path);
  if (expectedPath && actualPath) return expectedPath === actualPath;
  return Boolean(document.file_name && match.file_name && document.file_name.toLowerCase() === match.file_name.toLowerCase());
}
