"use client";

import {
  ArrowRight,
  Bell,
  BookOpen,
  ChevronDown,
  Clock3,
  Download,
  ExternalLink,
  FileCheck2,
  FileText,
  Filter,
  Folder,
  FolderOpen,
  Globe2,
  Leaf,
  Menu,
  MessageSquareText,
  MoreHorizontal,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  ThumbsDown,
  ThumbsUp,
  Upload,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Role = "Admin" | "Contributor" | "User";
type View = "knowledge" | "ask" | "web" | "admin";
type AuthUser = {
  id: number;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  lastActiveAt?: string | null;
  createdAt: string;
};
type Project = {
  id: number;
  name: string;
  description: string;
  createdBy: string;
  createdAt: string;
  threadCount: number;
};
type ConversationSummary = {
  id: string;
  title: string;
  projectId?: number | null;
};

function createConversationId() {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function evidenceBand(score?: number | null) {
  if (typeof score !== "number") return "No evidence";
  if (score >= 0.6) return "High";
  if (score >= 0.35) return "Medium";
  return "Low";
}

function isNeedsReview(row: { topScore?: number | null; chunks?: number; feedback?: "up" | "down"; resolution?: string | null }) {
  if (row.resolution) return false;
  if (row.feedback === "down") return true;
  if (!row.chunks) return true;
  if (typeof row.topScore !== "number") return true;
  return row.topScore < 0.35;
}

function retrievalIssueReason(row: { topScore?: number | null; chunks?: number; feedback?: "up" | "down"; sources?: string[] }) {
  if (row.feedback === "down") return "User gave thumbs down";
  if (!row.chunks || !row.sources?.length) return "No selected chunks or source";
  if (typeof row.topScore !== "number") return "No evidence score";
  if (row.topScore < 0.35) return "Low confidence score";
  return "Optional review";
}

function retrievalSuggestion(row: { topScore?: number | null; chunks?: number; feedback?: "up" | "down"; sources?: string[] }) {
  if (row.feedback === "down") return "Review answer quality and source match.";
  if (!row.chunks || !row.sources?.length) return "Check whether the document is indexed in the vector store.";
  if (typeof row.topScore === "number" && row.topScore < 0.35 && row.sources?.length) return "If the source is correct, improve chunking or metadata. If the source is wrong, add clearer filename/folder metadata or improve query expansion.";
  return "Confirm whether the retrieved source answers the query.";
}

type KnowledgeDocument = {
  id: string;
  name: string;
  type: string;
  folder: string;
  owner: string;
  updated: string;
  status: string;
  size: string;
  rawFolder?: string;
};

const legacyFolderNames = new Set(["Policies", "Operations", "Research", "Community"]);

function displayKnowledgeFolder(folder?: string, owner?: string) {
  if (owner === "OpenAI vector store") return "Vector store imports";
  if (!folder || folder === "Knowledge base") return "Uploaded documents";
  if (legacyFolderNames.has(folder)) return "Uploaded documents";
  return folder;
}

const searchRows: string[][] = [];

function Brand() {
  return (
    <div className="brand" aria-label="Beforest â€” Nature at Work">
      <span className="brand-logo" role="img" aria-label="Beforest â€” Nature at Work" />
    </div>
  );
}

function Sidebar({
  view,
  setView,
  role,
  mobileOpen,
  closeMobile,
  onNewChat,
  onSelectChat,
  selectedChatId,
  recentChats,
  projects,
  projectChatCounts,
  selectedProjectId,
  onAddProject,
  onSelectProject,
}: {
  view: View;
  setView: (v: View) => void;
  role: Role;
  mobileOpen: boolean;
  closeMobile: () => void;
  onNewChat: () => void;
  onSelectChat: (chat: ConversationSummary) => void;
  selectedChatId: string;
  recentChats: ConversationSummary[];
  projects: Project[];
  projectChatCounts: Record<number, number>;
  selectedProjectId: number | null;
  onAddProject: () => void;
  onSelectProject: (project: Project) => void;
}) {
  const items = [
    { id: "knowledge" as View, label: "Knowledge", icon: BookOpen },
    ...(role === "Contributor"
      ? []
      : [{ id: "ask" as View, label: "Ask Beforest", icon: MessageSquareText }]),
    ...(role === "Admin"
      ? [{ id: "admin" as View, label: "Admin", icon: Settings }]
      : []),
  ];
  return (
    <>
      {mobileOpen && (
        <button
          className="scrim"
          aria-label="Close navigation"
          onClick={closeMobile}
        />
      )}
      <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
        <Brand />
        <nav>
          {items.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={view === id ? "active" : ""}
              onClick={() => {
                setView(id);
                closeMobile();
              }}
            >
              <Icon size={19} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        {role !== "Contributor" && <div className="chat-sidebar-tools">
          <button className="new-chat-button" onClick={onNewChat}>
            <MessageSquareText size={17} />
            <span>New chat</span>
            <span className="new-chat-plus">+</span>
          </button>
          <div className="chat-sidebar-heading">
            <span>Projects</span>
            <button type="button" aria-label="Add project" title="Create project" onClick={onAddProject}>+</button>
          </div>
          {projects.map((project) => (
            <button
              type="button"
              className={`chat-sidebar-row project-row ${selectedProjectId === project.id ? "selected" : ""}`}
              key={project.id}
              onClick={() => {
                onSelectProject(project);
                closeMobile();
              }}
              title={`${project.description || project.name} - ${projectChatCounts[project.id] ?? 0} thread${(projectChatCounts[project.id] ?? 0) === 1 ? "" : "s"}`}
            >
              <Folder size={16} />
              <span>{project.name}</span>
              <small className="project-thread-count">
                {projectChatCounts[project.id] ?? 0} thread{(projectChatCounts[project.id] ?? 0) === 1 ? "" : "s"}
              </small>
            </button>
          ))}
          <div className="chat-sidebar-heading recent-heading">Recent chats</div>
          {recentChats.map((chat) => <button className={`chat-sidebar-row chat-history ${selectedChatId === chat.id ? "selected" : ""}`} key={chat.id} onClick={() => onSelectChat(chat)}><Clock3 size={15} /><span>{chat.title}</span></button>)}
        </div>}
      </aside>
    </>
  );
}

function Header({
  title,
  user,
  onLogout,
  openMobile,
}: {
  title: string;
  user: AuthUser;
  onLogout: () => void;
  openMobile: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [stats, setStats] = useState<{ queries?: number; positive?: number; negative?: number } | null>(null);
  const [vectorStatus, setVectorStatus] = useState<{ fileCounts?: { completed?: number; in_progress?: number; failed?: number; cancelled?: number } } | null>(null);
  const notificationRef = useRef<HTMLDivElement | null>(null);
  const profileRef = useRef<HTMLDivElement | null>(null);
  const notifications = useMemo(() => {
    const completed = vectorStatus?.fileCounts?.completed ?? 0;
    const processing = vectorStatus?.fileCounts?.in_progress ?? 0;
    const failed = vectorStatus?.fileCounts?.failed ?? 0;
    const totalFeedback = (stats?.positive ?? 0) + (stats?.negative ?? 0);
    return [
      {
        title: completed ? `${completed} documents indexed` : "Vector store is connected",
        detail: processing ? `${processing} documents are still processing.` : "Document pipeline is ready for retrieval.",
        tone: failed ? "warning" : "success",
      },
      {
        title: `${stats?.queries ?? 0} queries this month`,
        detail: "Recent search activity is being tracked in Admin.",
        tone: "info",
      },
      {
        title: totalFeedback ? `${totalFeedback} feedback signals captured` : "No new feedback yet",
        detail: totalFeedback ? "Review thumbs-up and thumbs-down signals in Feedback." : "User feedback will appear here after responses are rated.",
        tone: "info",
      },
    ];
  }, [stats, vectorStatus]);

  useEffect(() => {
    void Promise.all([
      fetch("/api/admin/stats").then((response) => response.json()),
      fetch("/api/openai/status").then((response) => response.json()),
    ])
      .then(([statsData, statusData]) => {
        setStats(statsData);
        setVectorStatus(statusData);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (notificationRef.current && !notificationRef.current.contains(target)) {
        setNotificationsOpen(false);
      }
      if (profileRef.current && !profileRef.current.contains(target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  return (
    <header className="header">
      <div className="header-title">
        <button
          className="mobile-menu icon-btn"
          onClick={openMobile}
          aria-label="Open navigation"
        >
          <Menu size={20} />
        </button>
        <h1>{title}</h1>
      </div>
      <div className="header-actions">
        <div className="notification-wrap" ref={notificationRef}>
          <button
            className="icon-btn notification"
            aria-label="Notifications"
            aria-expanded={notificationsOpen}
            onClick={() => setNotificationsOpen((current) => !current)}
          >
            <Bell size={19} />
            <i />
          </button>
          {notificationsOpen && (
            <div className="notification-panel" role="dialog" aria-label="Notifications">
              <div className="notification-head">
                <strong>Notifications</strong>
                <span>{notifications.length} updates</span>
              </div>
              <div className="notification-list">
                {notifications.map((item) => (
                  <div className="notification-item" key={item.title}>
                    <span className={`notification-status ${item.tone}`} />
                    <span>
                      <strong>{item.title}</strong>
                      <small>{item.detail}</small>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="profile-wrap" ref={profileRef}>
          <button className="profile" onClick={() => setOpen(!open)}>
            <span className="avatar">S</span>
            <span className="profile-copy">
              <strong>{user.name}</strong>
              <small>{user.role}</small>
            </span>
            <ChevronDown size={15} />
          </button>
          {open && (
            <div className="role-menu">
              <p>{user.email}</p>
              <button onClick={() => { setOpen(false); onLogout(); }}>
                Sign out
                <span><ArrowRight size={15} /></span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function CreateProjectModal({
  close,
  onCreated,
}: {
  close: () => void;
  onCreated: (project: Project) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const create = async () => {
    const projectName = name.trim();
    if (!projectName) {
      setError("Enter a project name.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: projectName, description: description.trim() }),
      });
      const data = (await response.json()) as { project?: Project; error?: string };
      if (!response.ok || !data.project) throw new Error(data.error || "Unable to create the project.");
      onCreated(data.project);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create the project.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div className="modal project-modal" role="dialog" aria-modal="true" aria-labelledby="create-project-title">
        <div className="modal-head">
          <div>
            <h2 id="create-project-title">Create project</h2>
            <p>Organize a dedicated knowledge workspace for your team.</p>
          </div>
          <button className="icon-btn" type="button" aria-label="Close" onClick={close}><X size={20} /></button>
        </div>
        <div className="project-form">
          <label className="field-label">
            Project name
            <input autoFocus maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Forest research" onKeyDown={(event) => { if (event.key === "Enter") void create(); }} />
          </label>
          <label className="field-label">
            Description <small>Optional</small>
            <textarea rows={3} maxLength={240} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What knowledge will this project contain?" />
          </label>
          {error && <p className="form-error">{error}</p>}
        </div>
        <div className="modal-actions">
          <button className="secondary" type="button" onClick={close}>Cancel</button>
          <button className="primary" type="button" onClick={() => void create()} disabled={saving}>{saving ? "Creatingâ€¦" : "Create project"}</button>
        </div>
      </div>
    </div>
  );
}

function UploadModal({ close }: { close: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [folder, setFolder] = useState("Uploaded documents");
  const [accessGroup, setAccessGroup] = useState("all");
  const [chunkSize, setChunkSize] = useState(800);
  const [chunkOverlap, setChunkOverlap] = useState(160);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [error, setError] = useState("");

  const upload = async () => {
    if (!file) return setError("Choose a document before uploading.");
    setUploading(true);
    setError("");
    const form = new FormData();
    form.append("file", file);
    form.append("folder", folder);
    form.append("uploadedBy", "Seshu");
    form.append("accessGroup", accessGroup);
    form.append("chunkSize", String(chunkSize));
    form.append("chunkOverlap", String(chunkOverlap));
    try {
      const response = await fetch("/api/documents/upload", {
        method: "POST",
        body: form,
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Upload failed.");
      setUploaded(true);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : "Upload failed.",
      );
    } finally {
      setUploading(false);
    }
  };
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <div>
            <h2>Upload documents</h2>
            <p>Add files to your shared knowledge collection.</p>
          </div>
          <button className="icon-btn" onClick={close}>
            <X size={20} />
          </button>
        </div>
        {uploaded ? (
          <div className="upload-success">
            <span>
              <FileCheck2 size={28} />
            </span>
            <h3>Document indexed</h3>
            <p>
              {file?.name} is now available in the shared OpenAI vector store.
            </p>
            <button className="primary" onClick={close}>
              Done
            </button>
          </div>
        ) : (
          <>
            <label className="dropzone">
              <span>
                <Upload size={24} />
              </span>
              <strong>{file ? file.name : "Choose a file to upload"}</strong>
              <small>PDF, DOCX, XLSX, PPTX, TXT and images up to 50 MB</small>
              <input
                type="file"
                hidden
                onChange={(event) => {
                  const selected = event.target.files?.[0] ?? null;
                  setFile(selected);
                  const extension = selected?.name.split(".").pop()?.toLowerCase();
                  if (extension === "pptx") { setChunkSize(500); setChunkOverlap(100); }
                  else if (extension === "txt" || extension === "md") { setChunkSize(600); setChunkOverlap(120); }
                  else { setChunkSize(800); setChunkOverlap(160); }
                }}
              />
            </label>
            <label className="field-label">
              Destination collection
              <select value={folder} onChange={(event) => setFolder(event.target.value)}>
                <option>Uploaded documents</option>
              </select>
            </label>
            <label className="field-label">
              Permitted access
              <select value={accessGroup} onChange={(event) => setAccessGroup(event.target.value)}>
                <option value="all">All permitted users</option>
                <option value="contributors">Contributors and admins</option>
                <option value="admins">Admins only</option>
              </select>
            </label>
            <details className="indexing-options">
              <summary>Advanced indexing</summary>
              <p>Smaller chunks improve precise lookups; larger chunks retain more surrounding context.</p>
              <div>
                <label className="field-label">Chunk size (tokens)<input type="number" min="100" max="4096" value={chunkSize} onChange={(event) => setChunkSize(Number(event.target.value))} /></label>
                <label className="field-label">Chunk overlap<input type="number" min="0" max={Math.floor(chunkSize / 2)} value={chunkOverlap} onChange={(event) => setChunkOverlap(Number(event.target.value))} /></label>
              </div>
            </details>
            {error && <p className="form-error">{error}</p>}
            <div className="modal-actions">
              <button className="secondary" onClick={close}>
                Cancel
              </button>
              <button className="primary" onClick={upload} disabled={uploading}>
                {uploading ? "Uploading and indexingâ€¦" : "Upload file"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function KnowledgeView({ project }: { project: Project | null }) {
  const [upload, setUpload] = useState(false);
  const [filter, setFilter] = useState("");
  const [selectedCollection, setSelectedCollection] = useState("all");
  const [liveDocuments, setLiveDocuments] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const loadDocuments = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/documents/list");
      const data = (await response.json()) as {
        files?: Array<{ id: string; name: string; bytes: number; status: string; folder: string; owner: string; createdAt: number }>;
        error?: string;
        model?: string;
      };
      if (!response.ok) throw new Error(data.error || "Unable to load documents.");
      setLiveDocuments((data.files || []).map((file) => ({
        id: file.id,
        name: file.name,
        type: file.name.split(".").pop()?.toUpperCase() || "FILE",
        folder: displayKnowledgeFolder(file.folder, file.owner),
        rawFolder: file.folder,
        owner: file.owner,
        updated: new Date(file.createdAt * 1000).toLocaleDateString(),
        status: file.status === "completed" ? "Indexed" : file.status,
        size: file.bytes ? `${(file.bytes / 1024 / 1024).toFixed(1)} MB` : "-",
      })));
      setLoadError("");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Unable to load documents.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    const timer = window.setTimeout(() => { void loadDocuments(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const collectionCounts = useMemo(() => ({
    all: liveDocuments.length,
    uploaded: liveDocuments.filter((document) => document.folder === "Uploaded documents").length,
    mine: liveDocuments.filter((document) => document.owner === "Seshu").length,
    imports: liveDocuments.filter((document) => document.folder === "Vector store imports").length,
  }), [liveDocuments]);
  const collections = [
    { id: "all", label: "All knowledge", count: collectionCounts.all, icon: FolderOpen },
    { id: "uploaded", label: "Uploaded documents", count: collectionCounts.uploaded, icon: Folder },
    { id: "mine", label: "My uploads", count: collectionCounts.mine, icon: Folder },
    { id: "imports", label: "Vector store imports", count: collectionCounts.imports, icon: Folder },
  ].filter((collection) => collection.id === "all" || collection.count > 0);
  const filtered = liveDocuments.filter((document) => {
    if (!document.name.toLowerCase().includes(filter.toLowerCase())) return false;
    if (selectedCollection === "uploaded") return document.folder === "Uploaded documents";
    if (selectedCollection === "mine") return document.owner === "Seshu";
    if (selectedCollection === "imports") return document.folder === "Vector store imports";
    return true;
  });
  return (
    <div className="page knowledge-page">
      <div className="page-lead">
        <div>
          <h2>Knowledge explorer</h2>
          <p>
            Browse documents indexed in <strong>{project?.name || "your permitted knowledge"}</strong>.
          </p>
        </div>
        <button className="primary" onClick={() => setUpload(true)}>
          <Upload size={17} />
          Upload documents
        </button>
      </div>
      <div className="knowledge-layout">
        <aside className="folder-panel">
          <div className="panel-label">Collections</div>
          {collections.map(({ id, label, count, icon: Icon }) => (
            <button
              className={`folder-row ${selectedCollection === id ? "selected" : ""}`}
              key={id}
              onClick={() => setSelectedCollection(id)}
            >
              <Icon size={18} />
              <span>{label}</span>
              <small>{count}</small>
            </button>
          ))}
        </aside>
        <section className="document-panel">
          <div className="document-tools">
            <div className="search-input compact">
              <Search size={17} />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search documents"
              />
            </div>
            <button className="secondary">
              <Filter size={16} />
              Filter
            </button>
          </div>
          <div className="table document-table">
            <div className="tr th">
              <span>Name</span>
              <span>Collection</span>
              <span>Owner</span>
              <span>Updated</span>
              <span>Status</span>
              <span />
            </div>
            {loading && <div className="empty-knowledge">Loading documents from your vector store...</div>}
            {!loading && loadError && <div className="empty-knowledge error-state">{loadError}</div>}
            {!loading && !loadError && filtered.length === 0 && <div className="empty-knowledge">No documents found in this collection.</div>}
            {!loading && !loadError && filtered.map((doc) => (
              <div className="tr" key={doc.id}>
                <span className="file-name">
                  <i>
                    <FileText size={18} />
                  </i>
                  <span>
                    <strong>{doc.name}</strong>
                    <small>
                      {doc.type} | {doc.size}
                    </small>
                  </span>
                </span>
                <span>{doc.folder}</span>
                <span>{doc.owner}</span>
                <span>{doc.updated}</span>
                <span>
                  <em className={`status ${doc.status.toLowerCase()}`}>
                    {doc.status}
                  </em>
                </span>
                <button className="icon-btn">
                  <MoreHorizontal size={18} />
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>
      {upload && <UploadModal close={() => { setUpload(false); void loadDocuments(); }} />}
    </div>
  );
}

function AskView({ initialQuestion = "What is our approach to regenerative forestry?", conversationId, projectId, projectName, onChatStarted, fresh = false }: { initialQuestion?: string; conversationId: string; projectId: number | null; projectName?: string; onChatStarted: (title: string) => void; fresh?: boolean }) {
  const [history, setHistory] = useState<Array<{ role: "user" | "assistant"; content: string; citations?: Array<{ fileId: string; filename: string; score?: number; excerpt?: string }> }>>([]);
  const [query, setQuery] = useState("");
  const [askedQuestion, setAskedQuestion] = useState(initialQuestion);
  const [answer, setAnswer] = useState(
    "Ask a question to test the documents currently indexed in your OpenAI vector store.",
  );
  const [liveSources, setLiveSources] = useState<
    Array<{
      fileId: string;
      filename: string;
      score?: number;
      excerpt?: string;
    }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);
  const [details, setDetails] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const sessionId = conversationId;

  useEffect(() => {
    if (fresh) return;
    void fetch(`/api/conversations?id=${encodeURIComponent(sessionId)}&title=${encodeURIComponent(initialQuestion)}&projectId=${projectId ?? "unassigned"}`)
      .then((response) => response.json())
      .then((data) => {
        if (!data?.messages?.length) return;
        const restored = data.messages.map((message: { role: "user" | "assistant"; content: string; citations?: Array<{ fileId: string; filename: string; score?: number; excerpt?: string }> }) => ({ role: message.role, content: message.content, citations: message.citations || [] }));
        setHistory(restored);
        const lastWithCitations = [...restored].reverse().find((message) => message.citations?.length);
        if (lastWithCitations?.citations) { setLiveSources(lastWithCitations.citations); setSourcesOpen(true); }
        const lastUser = [...restored].reverse().find((message) => message.role === "user");
        const lastAssistant = [...restored].reverse().find((message) => message.role === "assistant");
        if (lastUser) setAskedQuestion(lastUser.content);
        if (lastAssistant) setAnswer(lastAssistant.content);
      })
      .catch(() => undefined);
  }, [sessionId, initialQuestion, fresh, projectId]);

  const submit = async (question = query) => {
    const message = question.trim();
    if (!message || loading) return;
    setQuery("");
    setAskedQuestion(message);
    const startedAt = performance.now();
    setLoading(true);
    setError("");
    setFeedback(null);
    setLiveSources([]);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history, projectName }),
      });
      const data = (await response.json()) as {
        answer?: string;
        citations?: Array<{
          fileId: string;
          filename: string;
          score?: number;
          excerpt?: string;
        }>;
        error?: string;
        model?: string;
      };
      if (!response.ok)
        throw new Error(data.error || "Unable to search the knowledge base.");
      setAnswer(data.answer || "No answer was returned.");
      const nextHistory = [
        ...history,
        { role: "user" as const, content: message },
        { role: "assistant" as const, content: data.answer || "No answer was returned.", citations: data.citations || [] },
      ].slice(-12);
      setHistory(nextHistory);
      void fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sessionId, title: initialQuestion === "What is our approach to regenerative forestry?" ? message : initialQuestion, projectId, messages: nextHistory }),
      }).catch(() => undefined);
      if (history.length === 0) onChatStarted(message);
      setLiveSources(data.citations || []);
      const citationScores = (data.citations || []).map((citation) => citation.score).filter((score): score is number => typeof score === "number");
      void fetch("/api/admin/telemetry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, query: message, model: data.model, latencyMs: Math.round(performance.now() - startedAt), chunks: (data.citations || []).length, topScore: citationScores.length ? Math.max(...citationScores) : null, sources: (data.citations || []).map((citation) => citation.filename) }) });
      setSourcesOpen(true);
    } catch (chatError) {
      setError(chatError instanceof Error ? chatError.message : "Chat failed.");
    } finally {
      setLoading(false);
    }
  };

  const displayedSources = liveSources.length
    ? liveSources.map((source) => ({
        title: source.filename,
        page: null as number | null,
        score: Math.round((source.score ?? 0) * 100),
        text: source.excerpt || "This file was cited in the generated answer.",
        id: source.fileId,
      }))
    : [];
  const evidenceScores = liveSources.map((source) => source.score).filter((score): score is number => typeof score === "number");
  const evidenceScore = evidenceScores.length ? Math.max(...evidenceScores) : null;
  const evidenceLevel = loading ? "Assessing evidenceâ€¦" : evidenceBand(evidenceScore);
  const evidenceTone = loading ? "assessing" : evidenceLevel.toLowerCase().replace(" ", "-");

  return (
    <div className={`ask-layout ${sourcesOpen ? "with-sources" : ""}`}>
      <main className="ask-main">
        <div className="ask-inner">
          {projectName && <div className="project-chat-context"><Folder size={16} /><span>Project</span><strong>{projectName}</strong></div>}
          <div className="ask-box">
            <div className="ask-input">
              <Leaf size={21} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void submit()}
                placeholder="Ask across your permitted knowledgeâ€¦"
              />
              <button
                onClick={() => void submit()}
                aria-label="Ask"
                disabled={loading}
              >
                <ArrowRight size={20} />
              </button>
            </div>
          </div>
          {history.length > 2 && (
            <div className="conversation-history">
              {history.slice(0, -2).map((message, index) => (
                <div className={`history-turn ${message.role}`} key={`${message.role}-${index}`}>
                  <span className={`avatar ${message.role === "user" ? "soft" : "ai-history-mark"}`}>{message.role === "user" ? "S" : <Leaf size={17} />}</span>
                  <div className="history-content">
                    <strong>{message.role === "user" ? "You" : "Beforest AI"}</strong>
                    <div className="markdown-answer"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown></div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <article className="answer">
            <div className="question-row">
              <span className="avatar soft">S</span>
              <h2>{askedQuestion}</h2>
              <time>Now</time>
            </div>
            <div className="answer-body">
              <span className="ai-mark">
                <Leaf size={19} />
              </span>
              <div>
                {loading ? (
                  <div className="answer-loading">
                    <i />
                    <span>Searching your knowledge baseâ€¦</span>
                  </div>
                ) : error ? (
                  <div className="chat-error">
                    <strong>Could not answer</strong>
                    <span>{error}</span>
                  </div>
                ) : (
                  <div className="live-answer markdown-answer"><ReactMarkdown remarkPlugins={[remarkGfm]}>{answer}</ReactMarkdown></div>
                )}
                {displayedSources.length > 0 && (
                  <>
                    <h3>Sources ({displayedSources.length})</h3>
                    <div className="citation-list">
                      {displayedSources.map((s) => (
                        <button key={s.id} onClick={() => setSourcesOpen(true)}>
                          <FileText size={16} />
                          <span>{s.title}</span>
                          <small>{s.score ? `${s.score}%` : "Cited"}</small>
                          <ExternalLink size={14} />
                        </button>
                      ))}
                    </div>
                  </>
                )}
                <div className="answer-meta">
                  <div>
                    <span>Evidence match</span>
                    <i className={`score-dots ${evidenceTone}`} aria-hidden="true">
                      {[0, 1, 2, 3, 4].map((dot) => <span key={dot} />)}
                    </i>
                    <strong className={`evidence-label ${evidenceTone}`}>{evidenceLevel}</strong>
                  </div>
                  <div>
                    <span>Was this helpful?</span>
                    <button
                      className={feedback === "up" ? "chosen" : ""}
                      onClick={() => { setFeedback("up"); void fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, rating: "up" }) }); }}
                    >
                      <ThumbsUp size={18} />
                    </button>
                    <button
                      className={feedback === "down" ? "chosen" : ""}
                      onClick={() => { setFeedback("down"); void fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, rating: "down" }) }); }}
                    >
                      <ThumbsDown size={18} />
                    </button>
                  </div>
                </div>
                <button
                  className="details-button"
                  onClick={() => setDetails(!details)}
                >
                  <ChevronDown className={details ? "rotated" : ""} size={16} />
                  Show retrieval details
                </button>
                {details && (
                  <div className="retrieval-details">
                    <div>
                      <span>Candidate chunks</span>
                      <strong>{displayedSources.length || "â€”"}</strong>
                    </div>
                    <div>
                      <span>Selected chunks</span>
                      <strong>{displayedSources.length || "â€”"}</strong>
                    </div>
                    <div>
                      <span>Provider</span>
                      <strong>OpenAI</strong>
                    </div>
                    <div>
                      <span>Mode</span>
                      <strong>Internal</strong>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </article>
        </div>
      </main>
      {sourcesOpen && (
        <aside className="sources">
          <div className="sources-head">
            <div>
              <h2>Sources</h2>
              <p>{displayedSources.length} selected Â· sorted by relevance</p>
            </div>
            <button className="icon-btn" onClick={() => setSourcesOpen(false)}>
              <X size={19} />
            </button>
          </div>
          {displayedSources.length ? (
            displayedSources.map((s) => (
              <article key={s.id}>
                <div>
                  <span>
                    <FileText size={17} />
                  </span>
                  <strong>{s.title}</strong>
                  <small>{s.score ? `${s.score}%` : "Cited"}</small>
                </div>
                <p>{s.text}</p>
                <footer>
                  {s.score ? `${s.score}% relevant` : "Cited source"}{" "}
                  <button>
                    Open <ExternalLink size={13} />
                  </button>
                </footer>
              </article>
            ))
          ) : (
            <div className="empty-sources">
              <FileText size={22} />
              <strong>No sources yet</strong>
              <span>
                Ask a question to retrieve evidence from your vector store.
              </span>
            </div>
          )}
        </aside>
      )}
    </div>
  );
}

function WebView() {
  const [query, setQuery] = useState("regenerative forestry policy India 2026");
  const [searched, setSearched] = useState(true);
  return (
    <div className="page web-page">
      <div className="page-lead">
        <div>
          <h2>Web search</h2>
          <p>Research current public information through SearXNG.</p>
        </div>
      </div>
      <div className="web-search">
        <Globe2 size={21} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the public web"
        />
        <button className="primary" onClick={() => setSearched(true)}>
          Search
        </button>
      </div>
      <div className="privacy-note">
        <ShieldCheck size={17} />
        <span>
          Internal document content is never included in external search
          queries.
        </span>
      </div>
      {searched && (
        <div className="web-results">
          <div className="results-head">
            <span>Results for â€œ{query}â€</span>
            <button className="secondary">
              <SlidersHorizontal size={16} />
              Search settings
            </button>
          </div>
          {[
            [
              "National Agroforestry Policy â€” Ministry of Agriculture",
              "agri.gov.in",
              "Policy guidance for expanding tree cover, improving rural livelihoods, and building climate resilience through agroforestry systems.",
            ],
            [
              "Principles for Ecosystem Restoration",
              "fao.org",
              "A practical framework for planning, implementing, monitoring, and sustaining forest and landscape restoration programmes.",
            ],
            [
              "Regenerative Forestry: Evidence Review 2026",
              "worldresourcesinstitute.org",
              "A review of biodiversity, carbon, water, and community outcomes across regenerative forestry projects.",
            ],
            [
              "India State of Forest Report",
              "fsi.nic.in",
              "Official assessment of forest cover, tree cover, growing stock, and carbon stock across India.",
            ],
          ].map(([title, domain, text]) => (
            <article key={title}>
              <div className="result-domain">
                <span>{domain.charAt(0).toUpperCase()}</span>
                {domain}
              </div>
              <h3>{title}</h3>
              <p>{text}</p>
              <button>
                Open source <ExternalLink size={14} />
              </button>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

const adminTabs = [
  "Overview",
  "Users",
  "Documents",
  "Search history",
  "Retrieval quality",
  "Feedback",
  "Models & prompts",
  "Settings",
  "Appearance",
];

function AdminOverview({ onViewAll }: { onViewAll?: () => void }) {
  const [stats, setStats] = useState<{ activeUsers: number; queries: number; positive: number; negative: number } | null>(null);
  const [telemetry, setTelemetry] = useState<{ rows: Array<{ query: string; model?: string; latencyMs?: number; chunks: number; topScore?: number | null; feedback?: "up" | "down"; resolution?: string | null }>; averageLatencyMs?: number | null } | null>(null);
  const [vectorStatus, setVectorStatus] = useState<{ fileCounts?: { completed?: number; in_progress?: number; failed?: number; cancelled?: number } } | null>(null);
  useEffect(() => { void fetch("/api/admin/stats").then((r) => r.json()).then(setStats).catch(() => undefined); }, []);
  useEffect(() => { void fetch("/api/admin/telemetry").then((r) => r.json()).then(setTelemetry).catch(() => undefined); }, []);
  useEffect(() => { void fetch("/api/openai/status").then((r) => r.json()).then(setVectorStatus).catch(() => undefined); }, []);
  const needsReviewCount = (telemetry?.rows || []).filter(isNeedsReview).length;
  return (
    <>
      <div className="metric-strip">
        {[
          ["Active users", "â€”", "Not connected"],
          ["Queries this month", "â€”", "Not connected"],
          ["Positive feedback", "â€”", "No feedback yet"],
          ["Avg. response time", "â€”", "Awaiting telemetry"],
          ["Documents", "â€”", "Vector store"],
          ["Needs review", "0", "Retrieval queue"],
        ].map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{stats ? (label === "Active users" ? stats.activeUsers : label === "Queries this month" ? stats.queries : label === "Positive feedback" ? stats.positive : label === "Documents" ? (vectorStatus?.fileCounts?.completed ?? value) : label === "Needs review" ? needsReviewCount : telemetry?.averageLatencyMs ? `${(telemetry.averageLatencyMs / 1000).toFixed(1)} s` : value) : value}</strong>
            <small>{""}</small>
          </div>
        ))}
      </div>
      <div className="admin-grid">
        <section className="admin-section wide">
          <div className="section-heading">
            <div>
              <h3>Recent search activity</h3>
              <p>Review retrieval quality and response performance.</p>
            </div>
            <button className="secondary" onClick={onViewAll}>View all</button>
          </div>
          <div className="table search-table">
            <div className="tr th">
              {[
                "User",
                "Query",
                "Mode",
                "Relevance",
                "Feedback",
                "Latency",
              ].map((x) => (
                <span key={x}>{x}</span>
              ))}
            </div>
            {!telemetry?.rows.length && <div className="empty-admin-row">No search activity has been recorded yet.</div>}
            {(telemetry?.rows || []).slice(0, 10).map((row, i) => (
              <div className="tr" key={i}>
                <span>Seshu</span><span>{row.query}</span><span>Internal</span><span>{evidenceBand(row.topScore)}</span><span className={row.feedback === "up" ? "positive" : row.feedback === "down" ? "negative" : ""}>{row.feedback === "up" ? "Positive" : row.feedback === "down" ? "Negative" : "No feedback"}</span><span>{row.latencyMs ? `${row.latencyMs} ms` : "—"}</span>
              </div>
            ))}
          </div>
        </section>
        <aside className="admin-section">
          <div className="section-heading">
            <div>
              <h3>Operational health</h3>
              <p>Document pipeline{vectorStatus ? ` Â· ${vectorStatus.fileCounts?.completed ?? 0} indexed` : ""}</p>
            </div>
          </div>
          <div className="health-list">
            {[
              ["Indexed", vectorStatus?.fileCounts?.completed ?? "â€”", "good"],
              ["Processing", vectorStatus?.fileCounts?.in_progress ?? "â€”", "wait"],
              ["Needs review", vectorStatus?.fileCounts?.cancelled ?? "â€”", "warn"],
              ["Failed", vectorStatus?.fileCounts?.failed ?? "â€”", "bad"],
            ].map(([name, count, tone]) => (
              <div key={name}>
                <span><i className={String(tone)} />{name}</span><strong>{count}</strong>
              </div>
            ))}
          </div>
          <div className="health-list legacy-health-hidden">
            {[
              ["Indexed", "â€”", "good"],
              ["Processing", "â€”", "wait"],
              ["Needs review", "â€”", "warn"],
              ["Failed", "â€”", "bad"],
            ].map(([name, count, tone]) => (
              <div key={name}>
                <span>
                  <i className={tone} />
                  {name}
                </span>
                <strong>{count}</strong>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </>
  );
}

function AdminUsers({ currentUser }: { currentUser: AuthUser }) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AuthUser | null>(null);
  const [menuOpen, setMenuOpen] = useState<number | null>(null);
  const [actionMessage, setActionMessage] = useState("");
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "User" as Role, active: true, mustChangePassword: true });
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const loadUsers = useCallback(() => {
    void fetch("/api/admin/users").then((r) => r.json()).then((data) => setUsers(data.users || [])).catch(() => setUsers([]));
  }, []);
  useEffect(() => { loadUsers(); }, [loadUsers]);
  useEffect(() => {
    if (!menuOpen) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (userMenuRef.current?.contains(event.target as Node)) return;
      setMenuOpen(null);
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [menuOpen]);
  const openCreate = () => {
    setEditingUser(null);
    setForm({ name: "", email: "", password: "", role: "User", active: true, mustChangePassword: true });
    setInviteOpen(true);
    setActionMessage("");
  };
  const openEdit = (user: AuthUser) => {
    setEditingUser(user);
    setForm({ name: user.name, email: user.email, password: "", role: user.role, active: user.active, mustChangePassword: false });
    setInviteOpen(true);
    setActionMessage("");
  };
  const saveUser = async () => {
    const payload = editingUser ? { id: editingUser.id, ...form, password: form.password || undefined } : form;
    const response = await fetch("/api/admin/users", { method: editingUser ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setActionMessage(data.error || "Unable to save user.");
      return;
    }
    setInviteOpen(false);
    setActionMessage(editingUser ? "User updated." : data.inviteEmail?.sent ? "User created and invite email sent." : `User created, but invite email was not sent${data.inviteEmail?.error ? `: ${data.inviteEmail.error}` : "."}`);
    loadUsers();
  };
  const toggleUser = async (user: AuthUser) => {
    const response = await fetch("/api/admin/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: user.id, active: !user.active }) });
    if (response.ok) {
      setActionMessage(user.active ? "User deactivated." : "User activated.");
      loadUsers();
    } else {
      setActionMessage("Unable to update user status.");
    }
    setMenuOpen(null);
  };
  const removeUser = async (user: AuthUser) => {
    if (user.id === currentUser.id) {
      setActionMessage("You cannot delete your own account.");
      setMenuOpen(null);
      return;
    }
    const confirmed = window.confirm(`Delete ${user.name}? This will remove their login access permanently.`);
    if (!confirmed) {
      setMenuOpen(null);
      return;
    }
    const response = await fetch("/api/admin/users", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: user.id }) });
    const data = await response.json().catch(() => ({}));
    if (response.ok) {
      setActionMessage("User deleted.");
      loadUsers();
    } else {
      setActionMessage(data.error || "Unable to delete user.");
    }
    setMenuOpen(null);
  };
  return (
    <section className="admin-section full">
      <div className="section-heading">
        <div>
          <h3>Users and roles</h3>
          <p>Manage access across Admin, Contributor, and User roles.</p>
        </div>
        <button className="primary" onClick={openCreate}>
          <Users size={16} />
          Invite user
        </button>
      </div>
      <div className="table users-table">
        <div className="tr th">
          <span>Name</span>
          <span>Email</span>
          <span>Role</span>
          <span>Status</span>
          <span>Last active</span>
          <span />
        </div>
        {users.map((user) => (
          <div className="tr" key={user.id}>
            <span>
              <span className="person">
                <i>{user.name[0]?.toUpperCase() || "U"}</i>
                <strong>{user.name}</strong>
              </span>
            </span>
            <span>{user.email}</span>
            <span>{user.role}</span>
            <span><span className="user-status"><i className={`status-dot ${user.active ? "active" : ""}`} />{user.active ? "Active" : "Inactive"}</span></span>
            <span>{user.lastActiveAt ? new Date(user.lastActiveAt).toLocaleString() : user.id === currentUser.id ? "Now" : "—"}</span>
            <div className="user-menu-wrap" ref={menuOpen === user.id ? userMenuRef : null}>
              <button className="icon-btn" onClick={() => setMenuOpen((open) => open === user.id ? null : user.id)}>
                <MoreHorizontal size={17} />
              </button>
              {menuOpen === user.id && <div className="user-action-menu"><button onClick={() => { openEdit(user); setMenuOpen(null); }}>Edit role</button><button onClick={() => void toggleUser(user)} disabled={user.id === currentUser.id}>{user.active ? "Deactivate user" : "Activate user"}</button><button className="danger-action" onClick={() => void removeUser(user)} disabled={user.id === currentUser.id}>Delete user</button></div>}
            </div>
          </div>
        ))}
      </div>
      {actionMessage && <p className="admin-action-message">{actionMessage}</p>}
      {inviteOpen && <div className="invite-panel"><div className="invite-head"><h3>{editingUser ? "Edit user" : "Create user credentials"}</h3><button className="icon-btn" onClick={() => setInviteOpen(false)}><X size={17} /></button></div><label>Name<input value={form.name} onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))} placeholder="Full name" /></label><label>Email / username<input type="email" value={form.email} onChange={(e) => setForm((current) => ({ ...current, email: e.target.value }))} placeholder="name@company.com" /></label><label>{editingUser ? "New password (optional)" : "Temporary password"}<input type="password" value={form.password} onChange={(e) => setForm((current) => ({ ...current, password: e.target.value }))} placeholder="Minimum 8 characters" /></label><label>Role<select value={form.role} onChange={(e) => setForm((current) => ({ ...current, role: e.target.value as Role }))}><option>User</option><option>Contributor</option><option>Admin</option></select></label><label>Status<select value={form.active ? "active" : "inactive"} onChange={(e) => setForm((current) => ({ ...current, active: e.target.value === "active" }))}><option value="active">Active</option><option value="inactive">Inactive</option></select></label><label className="checkbox-line"><input type="checkbox" checked={form.mustChangePassword} onChange={(e) => setForm((current) => ({ ...current, mustChangePassword: e.target.checked }))} />Require password change on first login</label><button className="primary" onClick={() => void saveUser()}>{editingUser ? "Save user" : "Create user"}</button></div>}
    </section>
  );
}

function AdminGeneric({ tab }: { tab: string }) {
  const content: Record<string, [string, string, React.ReactNode]> = {
    Documents: [
      "Document operations",
      "Review extraction, indexing, permissions, and publication status.",
      <AdminDocuments key="docs" />,
    ],
    "Search history": [
      "Search history",
      "Inspect user queries, selected evidence, feedback, and latency.",
      <><AdminSearchHistory key="history" />
      <div className="table simple-list legacy-history-hidden" key="history-legacy">
        {searchRows.map((r, i) => (
          <div className="tr" key={i}>
            <span>
              <strong>{r[1]}</strong>
              <small>
                {r[0]} Â· {r[2]}
              </small>
            </span>
            <span>{r[3]} relevance</span>
            <span>{r[5]}</span>
            <button className="secondary">Trace</button>
          </div>
        ))}
      </div></>,
    ],
    "Retrieval quality": [
      "Retrieval quality",
      "Calibrate evidence scores against reviewed searches and expected sources.",
      <RetrievalQuality key="retrieval-quality" />,
    ],
    Feedback: [
      "Feedback review",
      "Turn user signals into retrieval and content improvements.",
      <><AdminFeedback key="feedback" /><div className="feedback-list legacy-feedback-hidden" key="feedback-legacy">
        {[] .length === 0 && <div className="empty-admin-panel">No feedback has been submitted yet.</div>}
        {[] .map((r: string[]) => (
          <div key={r[0]}>
            <span className="feedback-icon">
              <MessageSquareText size={18} />
            </span>
            <span>
              <strong>{r[0]}</strong>
              <small>{r[1]} Â· Today</small>
            </span>
            <em>{r[2]}</em>
            <button className="secondary">Review</button>
          </div>
        ))}
      </div></>,
    ],
    "Models & prompts": [
      "Models and prompts",
      "Version and test the behaviour used for grounded answers.",
      <><ModelsPrompts key="models" />
      <div className="settings-form legacy-models-hidden" key="models-legacy">
        <label>
          Generation model
          <select defaultValue="gpt-5-mini">
            <option>gpt-5-mini</option>
            <option>gpt-5</option>
            <option>gpt-4.1</option>
          </select>
        </label>
        <label>
          Embedding model
          <select defaultValue="text-embedding-3-small">
            <option>text-embedding-3-small</option>
          </select>
        </label>
        <label className="span-2">
          System prompt
          <textarea defaultValue="You are Beforest AI. Answer only from permitted, relevant evidence. Cite every grounded claim and be transparent when evidence is insufficient." />
        </label>
        <div className="span-2 form-actions">
          <button className="secondary">Test configuration</button>
          <button className="primary">Save draft</button>
        </div>
      </div></>,
    ],
    Appearance: [
      "Appearance",
      "Customize the workspace colors and visual identity.",
      <AppearanceSettings key="appearance" />,
    ],
    Settings: [
      "System settings",
      "Control retrieval, external search, retention, and notifications.",
      <><SystemSettings key="settings" />
      <div className="setting-list legacy-settings-hidden" key="settings-legacy">
        {[
          ["External web search", "Allow SearXNG for permitted users", true],
          [
            "Contributor approval",
            "Require admin approval before indexing",
            true,
          ],
          [
            "Conversation history",
            "Retain query and answer history for 90 days",
            true,
          ],
          [
            "Email notifications",
            "Notify teams about newly published documents",
            false,
          ],
        ].map(([a, b, c]) => (
          <div key={String(a)}>
            <span>
              <strong>{a}</strong>
              <small>{b}</small>
            </span>
            <button className={`toggle ${c ? "on" : ""}`}>
              <i />
            </button>
          </div>
        ))}
      </div></>,
    ],
  };
  const [title, desc, body] = content[tab];
  return (
    <section className="admin-section full">
      <div className="section-heading">
        <div>
          <h3>{title}</h3>
          <p>{desc}</p>
        </div>
      </div>
      {body}
    </section>
  );
}

function AdminDocuments() {
  const [documents, setDocuments] = useState<Array<{ id: string; name: string; status?: string; bytes?: number; owner?: string }>>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  useEffect(() => { void fetch("/api/documents/list").then((r) => r.json()).then((data) => setDocuments(data.files || [])).catch(() => undefined); }, []);
  if (!documents.length) return <div className="empty-admin-panel">No documents are currently available in the vector store.</div>;
  const groups = documents.reduce<Record<string, typeof documents[number][]>>((result, document) => { const owner = document.owner || "Unknown uploader"; (result[owner] ||= []).push(document); return result; }, {});
  return <div className="admin-documents-list">{Object.entries(groups).map(([owner, files]) => <div className="document-owner-group" key={owner}><button className="document-owner-row" onClick={() => setExpanded((current) => ({ ...current, [owner]: !current[owner] }))}><span><ChevronDown size={16} className={expanded[owner] ? "rotated" : ""} /><strong>{owner}</strong></span><small>{files.length} document{files.length === 1 ? "" : "s"}</small></button>{expanded[owner] && files.map((document) => <div className="admin-document-row" key={document.id}><span><FileText size={17} /><strong>{document.name}</strong></span><small>{document.status || "Indexed"}</small><small>{document.bytes ? `${Math.round(document.bytes / 1024)} KB` : "â€”"}</small></div>)}</div>)}</div>;
}

function AdminFeedback() {
  const [items, setItems] = useState<Array<{ id: number; rating: "up" | "down"; query?: string; createdAt: string }>>([]);
  const [reviewId, setReviewId] = useState<number | null>(null);
  useEffect(() => { void fetch("/api/feedback").then((r) => r.json()).then((data) => setItems(data.feedback || [])).catch(() => undefined); }, []);
  if (!items.length) return <div className="empty-admin-panel">No feedback has been submitted yet.</div>;
  return <div className="admin-feedback-list">{items.map((item) => <div className="admin-feedback-item" key={item.id}><div className="admin-feedback-row"><span className={`feedback-badge ${item.rating}`}>{item.rating === "up" ? "Positive" : "Negative"}</span><div><strong>{item.query || "Conversation feedback"}</strong><small>Seshu Â· {new Date(item.createdAt).toLocaleString()}</small></div><button className="secondary" onClick={() => setReviewId(reviewId === item.id ? null : item.id)}>{reviewId === item.id ? "Close" : "Review"}</button></div>{reviewId === item.id && <div className="feedback-review-panel"><strong>Feedback review</strong><span>Rating: {item.rating === "up" ? "Positive" : "Negative"}</span><span>Query: {item.query || "Not available"}</span><span>Submitted: {new Date(item.createdAt).toLocaleString()}</span></div>}</div>)}</div>;
}

function AdminSearchHistory() {
  const [rows, setRows] = useState<Array<{ query: string; latencyMs?: number; chunks: number; topScore?: number | null; sources?: string[]; feedback?: "up" | "down" }>>([]);
  const [traceIndex, setTraceIndex] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  useEffect(() => { void fetch("/api/admin/telemetry").then((r) => r.json()).then((data) => setRows(data.rows || [])).catch(() => undefined); }, []);
  if (!rows.length) return <div className="empty-admin-panel">No search history has been recorded yet.</div>;
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const visibleRows = rows.slice(start, start + pageSize);
  return <div className="admin-history-list"><div className="admin-history-head"><span>User / query</span><span>Evidence</span><span>Feedback</span><span>Latency</span><span /></div>{visibleRows.map((row, index) => { const absoluteIndex = start + index; return <div className="admin-history-item" key={`${row.query}-${absoluteIndex}`}><div className="admin-history-row"><span><strong>{row.query}</strong><small>Seshu Â· Internal</small></span><span>{evidenceBand(row.topScore)}{typeof row.topScore === "number" ? ` Â· ${row.topScore.toFixed(2)}` : ""}</span><span className={row.feedback === "up" ? "positive" : row.feedback === "down" ? "negative" : ""}>{row.feedback === "up" ? "Positive" : row.feedback === "down" ? "Negative" : "No feedback"}</span><span>{row.latencyMs ? `${row.latencyMs} ms` : "â€”"}</span><button className="secondary" onClick={() => setTraceIndex(traceIndex === absoluteIndex ? null : absoluteIndex)}>{traceIndex === absoluteIndex ? "Hide trace" : "Trace"}</button></div>{traceIndex === absoluteIndex && <div className="trace-details"><strong>Retrieval trace</strong><span>Mode: Hybrid internal search (65% semantic / 35% keyword)</span><span>Selected sources: {row.sources?.length ? row.sources.join(", ") : "None"}</span><span>Selected chunks: {row.chunks}</span><span>Top ranking score: {typeof row.topScore === "number" ? row.topScore.toFixed(3) : "Not available"}</span><span>Feedback: {row.feedback === "up" ? "Positive" : row.feedback === "down" ? "Negative" : "Not provided"}</span></div>}</div>; })}<div className="pagination-bar"><span>Showing {start + 1}-{Math.min(start + pageSize, rows.length)} of {rows.length} searches</span><div><button className="secondary" disabled={safePage === 1} onClick={() => { setTraceIndex(null); setPage((current) => Math.max(1, current - 1)); }}>Previous</button><strong>Page {safePage} of {totalPages}</strong><button className="secondary" disabled={safePage === totalPages} onClick={() => { setTraceIndex(null); setPage((current) => Math.min(totalPages, current + 1)); }}>Next</button></div></div></div>;
}

function defaultViewForRole(role: Role): View {
  return role === "Contributor" ? "knowledge" : "ask";
}

type RetrievalRow = {
  id: number;
  query: string;
  topScore?: number | null;
  chunks: number;
  sources?: string[];
  expectedSource?: string;
  verdict?: "relevant" | "miss";
  feedback?: "up" | "down";
  resolution?: string | null;
  resolutionNotes?: string | null;
  closedAt?: string | null;
};

const retrievalResolutions = [
  "Resolved - retrieval was correct",
  "Resolved - document missing",
  "Resolved - needs re-indexing",
  "Resolved - prompt issue",
  "Ignored - not useful query",
];

function RetrievalQuality() {
  const [rows, setRows] = useState<RetrievalRow[]>([]);
  const [expectedSources, setExpectedSources] = useState<Record<number, string>>({});
  const [resolutions, setResolutions] = useState<Record<number, string>>({});
  const [resolutionNotes, setResolutionNotes] = useState<Record<number, string>>({});
  const [activeQualityTab, setActiveQualityTab] = useState<"all" | "needs" | "reviewed">("needs");
  const [message, setMessage] = useState("");
  const load = useCallback(() => void fetch("/api/admin/telemetry").then((response) => response.json()).then((data) => {
    setRows(data.rows || []);
    setExpectedSources(Object.fromEntries((data.rows || []).map((row: RetrievalRow) => [row.id, row.expectedSource || row.sources?.[0] || ""])));
    setResolutions(Object.fromEntries((data.rows || []).map((row: RetrievalRow) => [row.id, row.resolution || retrievalResolutions[0]])));
    setResolutionNotes(Object.fromEntries((data.rows || []).map((row: RetrievalRow) => [row.id, row.resolutionNotes || ""])));
  }).catch(() => undefined), []);
  useEffect(load, [load]);
  const review = async (row: RetrievalRow, verdict: "relevant" | "miss") => {
    const response = await fetch("/api/admin/telemetry", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ queryEventId: row.id, expectedSource: expectedSources[row.id] || "", verdict }) });
    setMessage(response.ok ? "Retrieval review saved." : "Unable to save retrieval review.");
    if (response.ok) load();
  };
  const closeReview = async (row: RetrievalRow) => {
    const response = await fetch("/api/admin/telemetry", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ queryEventId: row.id, resolution: resolutions[row.id] || retrievalResolutions[0], notes: resolutionNotes[row.id] || "" }) });
    setMessage(response.ok ? "Review case closed." : "Unable to close review case.");
    if (response.ok) load();
  };
  const reviewed = rows.filter((row) => row.verdict);
  const relevant = reviewed.filter((row) => row.verdict === "relevant").length;
  const scores = rows.map((row) => row.topScore).filter((score): score is number => typeof score === "number");
  const averageScore = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null;
  const needsReviewRows = rows.filter(isNeedsReview);
  const closedRows = rows.filter((row) => row.resolution);
  const visibleRows = activeQualityTab === "needs" ? needsReviewRows : activeQualityTab === "reviewed" ? closedRows : rows;
  const precision = reviewed.length ? `${Math.round((relevant / reviewed.length) * 100)}%` : "—";
  return <div className="retrieval-quality">
    <div className="quality-metrics">
      <div><span>Queries captured</span><strong>{rows.length}</strong></div>
      <div><span>Needs review</span><strong>{needsReviewRows.length}</strong></div>
      <div><span>Cases closed</span><strong>{closedRows.length}</strong></div>
      <div><span>Precision</span><strong>{precision}</strong></div>
      <div><span>Average top score</span><strong>{averageScore === null ? "—" : averageScore.toFixed(2)}</strong></div>
    </div>
    <div className="quality-calibration-note"><strong>Standard evidence bands</strong><span>Low: below 0.35 · Medium: 0.35–0.59 · High: 0.60 and above. Only low confidence, failed retrievals, and thumbs-down queries enter the Needs review queue.</span></div>
    <div className="retrieval-sop">
      <strong>Admin glossary / SOP</strong>
      <div>
        <span><b>Low score but source is correct:</b> Document may need better chunking or metadata.</span>
        <span><b>Wrong document retrieved:</b> Add clearer filename/folder metadata or improve query expansion.</span>
        <span><b>No chunks selected:</b> Check whether the document is indexed in the vector store.</span>
        <span><b>User gave thumbs down:</b> Review answer quality and source match.</span>
        <span><b>Knowledge missing:</b> Upload the missing document or mark it as a knowledge gap.</span>
      </div>
    </div>
    <div className="quality-subtabs">
      <button className={activeQualityTab === "needs" ? "active" : ""} onClick={() => setActiveQualityTab("needs")}>Needs review ({needsReviewRows.length})</button>
      <button className={activeQualityTab === "all" ? "active" : ""} onClick={() => setActiveQualityTab("all")}>All queries ({rows.length})</button>
      <button className={activeQualityTab === "reviewed" ? "active" : ""} onClick={() => setActiveQualityTab("reviewed")}>Reviewed / closed ({closedRows.length})</button>
    </div>
    {!rows.length && <div className="empty-admin-panel">Run a few knowledge searches to begin retrieval evaluation.</div>}
    {!!rows.length && !visibleRows.length && <div className="empty-admin-panel">{activeQualityTab === "needs" ? "No low-confidence or failed retrievals need review right now." : "No reviewed cases yet."}</div>}
    <div className="quality-review-list">{visibleRows.map((row) => <div className={`quality-review-row ${isNeedsReview(row) ? "needs-review" : ""}`} key={row.id}>
      <div className="quality-query"><strong>{row.query}</strong><small>{row.sources?.length ? row.sources.join(", ") : "No source retrieved"}</small><em>{retrievalIssueReason(row)}</em></div>
      <span className={`confidence-pill ${evidenceBand(row.topScore).toLowerCase().replace(" ", "-")}`}>{evidenceBand(row.topScore)}{typeof row.topScore === "number" ? ` · ${row.topScore.toFixed(2)}` : ""}</span>
      <input value={expectedSources[row.id] || ""} onChange={(event) => setExpectedSources((current) => ({ ...current, [row.id]: event.target.value }))} placeholder="Expected source" />
      <div className="quality-actions"><button className={row.verdict === "relevant" ? "chosen" : ""} onClick={() => void review(row, "relevant")}>Mark relevant</button><button className={row.verdict === "miss" ? "chosen miss" : ""} onClick={() => void review(row, "miss")}>Mark miss</button></div>
      <div className="quality-suggestion"><strong>Suggested fix</strong><span>{retrievalSuggestion(row)}</span></div>
      <div className="quality-resolution">
        <select value={resolutions[row.id] || retrievalResolutions[0]} onChange={(event) => setResolutions((current) => ({ ...current, [row.id]: event.target.value }))}>{retrievalResolutions.map((resolution) => <option key={resolution}>{resolution}</option>)}</select>
        <input value={resolutionNotes[row.id] || ""} onChange={(event) => setResolutionNotes((current) => ({ ...current, [row.id]: event.target.value }))} placeholder="Optional admin note" />
        <button className="primary" onClick={() => void closeReview(row)}>{row.resolution ? "Update closure" : "Close review"}</button>
      </div>
      {row.resolution && <p className="review-closed-note">Closed as: {row.resolution}{row.closedAt ? ` · ${new Date(row.closedAt).toLocaleString()}` : ""}</p>}
    </div>)}</div>
    {message && <p className="admin-action-message">{message}</p>}
  </div>;
}

function AppearanceSettings() {
  const [sidebar, setSidebar] = useState("#064c3d");
  const [accent, setAccent] = useState("#2a7f62");
  const [thumbnail, setThumbnail] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  useEffect(() => { void fetch("/api/admin/appearance").then((r) => r.json()).then((data) => { if (data.appearance?.sidebar) setSidebar(data.appearance.sidebar); if (data.appearance?.accent) setAccent(data.appearance.accent); if (data.appearance?.thumbnail) setThumbnail(data.appearance.thumbnail); }).catch(() => undefined); }, []);
  useEffect(() => { if (/^#[0-9a-fA-F]{6}$/.test(sidebar)) document.documentElement.style.setProperty("--forest", sidebar); if (/^#[0-9a-fA-F]{6}$/.test(accent)) document.documentElement.style.setProperty("--green", accent); }, [sidebar, accent]);
  useEffect(() => { if (thumbnail) { document.documentElement.style.setProperty("--leaf-thumbnail", `url(${thumbnail})`); document.documentElement.style.setProperty("--leaf-thumbnail-visibility", "hidden"); } }, [thumbnail]);
  const save = async () => { if (!/^#[0-9a-fA-F]{6}$/.test(sidebar) || !/^#[0-9a-fA-F]{6}$/.test(accent)) { setSaveMessage("Use valid six-digit hex colors."); return; } document.documentElement.style.setProperty("--green", accent); document.documentElement.style.setProperty("--forest", sidebar); if (thumbnail) { document.documentElement.style.setProperty("--leaf-thumbnail", `url(${thumbnail})`); document.documentElement.style.setProperty("--leaf-thumbnail-visibility", "hidden"); } const response = await fetch("/api/admin/appearance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sidebar, accent, thumbnail }) }); setSaveMessage(response.ok ? "Appearance saved." : "Unable to save appearance."); };
  return <div className="settings-form"><label>Sidebar color (hex)<input value={sidebar} onChange={(e) => setSidebar(e.target.value)} placeholder="#064c3d" /></label><label>Accent color (hex)<input value={accent} onChange={(e) => setAccent(e.target.value)} placeholder="#2a7f62" /></label><label>Leaf icon style<select defaultValue="leaf"><option value="leaf">Leaf</option><option value="minimal">Minimal</option></select></label><label>Leaf thumbnail<input type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => setThumbnail(String(reader.result)); reader.readAsDataURL(file); }} /></label>{thumbnail && <img className="appearance-preview" src={thumbnail} alt="Leaf thumbnail preview" />}<div className="span-2 form-actions"><button className="primary" onClick={save}>Save appearance</button></div>{saveMessage && <p className="admin-action-message">{saveMessage}</p>}</div>;
}

function ModelsPrompts() {
  const [generationModel, setGenerationModel] = useState("gpt-5-mini");
  const [embeddingModel, setEmbeddingModel] = useState("text-embedding-3-small");
  const [systemPrompt, setSystemPrompt] = useState("You are Beforest AI. Answer only from permitted, relevant evidence. Cite every grounded claim and be transparent when evidence is insufficient.");
  const [message, setMessage] = useState("");
  useEffect(() => { void fetch("/api/admin/models").then((r) => r.json()).then((data) => { if (!data.config) return; setGenerationModel(data.config.generationModel); setEmbeddingModel(data.config.embeddingModel); setSystemPrompt(data.config.systemPrompt); }).catch(() => undefined); }, []);
  const save = async (active: boolean) => { const response = await fetch("/api/admin/models", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ generationModel, embeddingModel, systemPrompt, active }) }); setMessage(response.ok ? (active ? "Configuration activated." : "Draft saved.") : "Unable to save configuration."); };
  return <div className="settings-form"><label>Generation model<select value={generationModel} onChange={(e) => setGenerationModel(e.target.value)}><option>gpt-5-mini</option><option>gpt-5</option><option>gpt-4.1</option></select></label><label>Embedding and indexing<input value="Managed by OpenAI vector store" readOnly /><small>The hosted vector store manages embeddings automatically. The saved model value is retained for configuration history.</small></label><label className="span-2">System prompt<textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} /></label><div className="span-2 form-actions"><button className="secondary" onClick={() => setMessage("Configuration fields validated.")}>Test configuration</button><button className="secondary" onClick={() => void save(false)}>Save draft</button><button className="primary" onClick={() => void save(true)}>Set active</button></div>{message && <p className="admin-action-message">{message}</p>}</div>;
}

function SystemSettings() {
  const defaults = { webSearch: true, contributorApproval: true, conversationHistory: true, emailNotifications: false };
  const [settings, setSettings] = useState(defaults);
  useEffect(() => { void fetch("/api/admin/settings").then((r) => r.json()).then((data) => { const next = { ...defaults }; for (const item of data.settings || []) if (item.key in next) next[item.key as keyof typeof next] = item.value === "true"; setSettings(next); }).catch(() => undefined); }, []);
  const toggle = (key: keyof typeof settings) => { const value = !settings[key]; setSettings((current) => ({ ...current, [key]: value })); void fetch("/api/admin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, value }) }); };
  const rows: Array<[keyof typeof settings, string, string]> = [["webSearch", "External web search", "Allow SearXNG for permitted users"], ["contributorApproval", "Contributor approval", "Require admin approval before indexing"], ["conversationHistory", "Conversation history", "Retain query and answer history for 90 days"], ["emailNotifications", "Email notifications", "Notify teams about newly published documents"]];
  return <div className="setting-list">{rows.map(([key, title, description]) => <div key={key}><span><strong>{title}</strong><small>{description}</small></span><button className={`toggle ${settings[key] ? "on" : ""}`} onClick={() => toggle(key)}><i /></button></div>)}</div>;
}

function AdminView({ currentUser }: { currentUser: AuthUser }) {
  const [tab, setTab] = useState("Overview");
  const [exportOpen, setExportOpen] = useState(false);
  const exportCsv = async () => { const [telemetry, feedback, documents] = await Promise.all([fetch("/api/admin/telemetry").then((r) => r.json()), fetch("/api/feedback").then((r) => r.json()), fetch("/api/documents/list").then((r) => r.json())]); const rows = [["Section", "Value"], ["Query", "Latency (ms)", "Chunks", "Feedback"], ...(telemetry.rows || []).map((r: { query: string; latencyMs?: number; chunks: number; feedback?: string }) => [r.query, String(r.latencyMs || ""), String(r.chunks), r.feedback || ""]), ["Feedback records", String((feedback.feedback || []).length)], ["Documents", String((documents.files || []).length)]]; const csv = (rows as string[][]).map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n"); const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); const link = document.createElement("a"); link.href = url; link.download = `beforest-admin-report-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url); setExportOpen(false); };
  return (
    <div className="page admin-page">
      <div className="page-lead admin-lead">
        <div>
          <h2>Admin</h2>
          <p>Monitor knowledge quality, access, and system performance.</p>
        </div>
        <button className="secondary" onClick={() => setExportOpen((open) => !open)}>
          <Download size={16} />
          Export report
        </button>
        {exportOpen && <div className="export-menu"><button onClick={() => void exportCsv()}>Export CSV</button><button onClick={() => { setExportOpen(false); window.print(); }}>Export PDF</button></div>}
      </div>
      <div className="tabs">
        {adminTabs.map((t) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Overview" ? (
        <AdminOverview onViewAll={() => setTab("Search history")} />
      ) : tab === "Users" ? (
        <AdminUsers currentUser={currentUser} />
      ) : (
        <AdminGeneric tab={tab} />
      )}
    </div>
  );
}

function LoginView({ onLogin }: { onLogin: (user: AuthUser) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await response.json().catch(() => ({}));
    setLoading(false);
    if (!response.ok || !data.user) {
      setError(data.error || "Unable to log in.");
      return;
    }
    onLogin(data.user);
  };
  return (
    <main className="login-shell">
      <section className="login-card">
        <Brand />
        <div>
          <h1>Sign in to Beforest AI</h1>
          <p>Use the credentials created by your admin.</p>
        </div>
        <form onSubmit={submit}>
          <label>Email / username<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {error && <p className="login-error">{error}</p>}
          <button className="primary" type="submit" disabled={loading}>{loading ? "Signing in…" : "Sign in"}</button>
        </form>
        <small>If this is your first setup, use the default admin credentials configured in your environment variables.</small>
      </section>
    </main>
  );
}

export default function Home() {
  const [authLoading, setAuthLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [view, setView] = useState<View>("ask");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [chatKey, setChatKey] = useState(0);
  const [selectedChat, setSelectedChat] = useState<ConversationSummary | null>(null);
  const [activeConversationId, setActiveConversationId] = useState(createConversationId);
  const [recentChats, setRecentChats] = useState<ConversationSummary[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [allConversations, setAllConversations] = useState<ConversationSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const role = user?.role || "User";
  const refreshConversations = useCallback(() => {
    if (!user || user.role === "Contributor") return;
    void fetch("/api/conversations")
      .then((response) => response.json())
      .then((data: { conversations?: ConversationSummary[] }) => {
        const conversations = data.conversations || [];
        setAllConversations(conversations);
        setRecentChats(conversations.slice(0, 12));
      })
      .catch(() => {
        setAllConversations([]);
        setRecentChats([]);
      });
  }, [user]);
  useEffect(() => {
    if (!user || user.role === "Contributor") return;
    void fetch("/api/projects")
      .then((response) => response.json())
      .then((data: { projects?: Project[] }) => setProjects(data.projects || []))
      .catch(() => undefined);
  }, [user]);
  useEffect(() => {
    refreshConversations();
  }, [refreshConversations]);
  useEffect(() => {
    void fetch("/api/auth/me")
      .then((response) => response.json())
      .then((data: { user?: AuthUser | null }) => {
        setUser(data.user || null);
        if (data.user) setView(defaultViewForRole(data.user.role));
      })
      .catch(() => setUser(null))
      .finally(() => setAuthLoading(false));
  }, []);
  const projectChatCounts = useMemo(() => projects.reduce<Record<number, number>>((counts, project) => {
    counts[project.id] = project.threadCount || 0;
    return counts;
  }, {}), [projects]);
  const selectedProject = projects.find((project) => project.id === selectedProjectId) || null;
  if (authLoading) return <main className="login-shell"><section className="login-card"><Brand /><p>Checking session…</p></section></main>;
  if (!user) return <LoginView onLogin={(nextUser) => { setUser(nextUser); setView(defaultViewForRole(nextUser.role)); }} />;
  const effectiveView = role === "Admin" && view === "admin" ? "admin" : role === "Contributor" ? "knowledge" : view === "admin" ? "ask" : view;
  const title = {
    knowledge: "Knowledge",
    ask: selectedProject?.name || "Ask Beforest",
    web: "Web search",
    admin: "Admin",
  }[effectiveView];
  return (
    <div className="app-shell">
      <Sidebar
        view={effectiveView}
        setView={setView}
        role={role}
        mobileOpen={mobileOpen}
        closeMobile={() => setMobileOpen(false)}
        onNewChat={() => { setSelectedChat(null); setActiveConversationId(createConversationId()); setChatKey((key) => key + 1); setView("ask"); }}
        onSelectChat={(chat) => { setSelectedChat(chat); setSelectedProjectId(chat.projectId ?? null); setActiveConversationId(chat.id); setChatKey((key) => key + 1); setView("ask"); }}
        selectedChatId={selectedChat?.id || ""}
        recentChats={recentChats}
        projects={projects}
        projectChatCounts={projectChatCounts}
        selectedProjectId={selectedProjectId}
        onAddProject={() => setProjectModalOpen(true)}
        onSelectProject={(project) => { setSelectedProjectId(project.id); setSelectedChat(null); setActiveConversationId(createConversationId()); setChatKey((key) => key + 1); setView("ask"); }}
      />
      <div className="app-content">
        <Header
          title={title}
          user={user}
          onLogout={() => {
            void fetch("/api/auth/logout", { method: "POST" });
            setUser(null);
            setRecentChats([]);
            setAllConversations([]);
            setProjects([]);
            setSelectedChat(null);
            setSelectedProjectId(null);
          }}
          openMobile={() => setMobileOpen(true)}
        />
        {effectiveView === "knowledge" && <KnowledgeView project={selectedProject} />}
        {effectiveView === "ask" && <AskView key={`${chatKey}-${activeConversationId}`} conversationId={activeConversationId} projectId={selectedProjectId} projectName={selectedProject?.name} initialQuestion={selectedChat?.title || undefined} fresh={!selectedChat} onChatStarted={(chatTitle) => {
          const nextChat = { id: activeConversationId, title: chatTitle, projectId: selectedProjectId };
          if (selectedProjectId && !allConversations.some((chat) => chat.id === activeConversationId)) {
            setProjects((current) => current.map((project) => project.id === selectedProjectId ? { ...project, threadCount: (project.threadCount || 0) + 1 } : project));
          }
          setAllConversations((current) => [nextChat, ...current.filter((chat) => chat.id !== activeConversationId)]);
          setRecentChats((current) => [nextChat, ...current.filter((chat) => chat.id !== activeConversationId)].slice(0, 12));
        }} />}
        {effectiveView === "web" && <WebView />}
        {effectiveView === "admin" && <AdminView currentUser={user} />}
      </div>
      {projectModalOpen && (
        <CreateProjectModal
          close={() => setProjectModalOpen(false)}
          onCreated={(project) => {
            setProjects((current) => [...current, project]);
            setSelectedProjectId(project.id);
            setSelectedChat(null);
            setActiveConversationId(createConversationId());
            setChatKey((key) => key + 1);
            setProjectModalOpen(false);
            setView("ask");
          }}
        />
      )}
    </div>
  );
}










