"use client";

import {
  AlertCircle,
  ArrowRight,
  Bell,
  BookOpen,
  ChevronDown,
  CheckCircle2,
  Clock3,
  Download,
  ExternalLink,
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
  Users,
  X,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useAuth, type AuthUser, type Role } from "./auth-provider";
import { DEFAULT_KNOWLEDGE_SYSTEM_PROMPT } from "@/lib/prompts";

type View = "knowledge" | "ask" | "web" | "admin";
type ConversationSummary = {
  id: string;
  title: string;
  projectId?: number | null;
};

function createConversationId() {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function evidenceBand(score?: number | null) {
  if (typeof score !== "number") return "Unscored citation";
  if (score >= 0.6) return "High";
  if (score >= 0.35) return "Medium";
  return "Low";
}

function cleanDisplayText(value?: string | null) {
  return (value || "")
    .replace(/â€¦/g, "…")
    .replace(/â€”/g, "—")
    .replace(/Â·/g, "·")
    .replace(/â€œ/g, "“")
    .replace(/â€/g, "”")
    .replace(/â€™/g, "’")
    .replace(/â€˜/g, "‘")
    .replace(/â€/g, "—")
    .replace(/�/g, "")
    .trim();
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
  if (!row.chunks || !row.sources?.length) return "Check whether the document is available in the approved knowledge base.";
  if (typeof row.topScore === "number" && row.topScore < 0.35 && row.sources?.length) return "If the source is correct, improve chunking or metadata. If the source is wrong, add clearer filename/folder metadata or improve query expansion.";
  return "Confirm whether the retrieved source answers the query.";
}

type KnowledgeDocument = {
  id: string;
  documentId?: string;
  name: string;
  type: string;
  folder: string;
  owner: string;
  updated: string;
  status: string;
  size: string;
  rawFolder?: string;
  dropboxPath?: string;
  dropboxFileId?: string;
};

const legacyFolderNames = new Set(["Policies", "Operations", "Research", "Community"]);

function displayKnowledgeFolder(folder?: string, owner?: string) {
  if (owner === "Approved knowledge base") return "Approved documents";
  if (!folder || folder === "Knowledge base") return "Approved documents";
  if (legacyFolderNames.has(folder)) return "Approved documents";
  return folder;
}

function viewFromPath(pathname: string, role?: Role): View {
  if (pathname.startsWith("/documents")) return "knowledge";
  if (pathname.startsWith("/admin") && role === "Admin") return "admin";
  if (pathname.startsWith("/settings") && role === "Admin") return "admin";
  if (pathname.startsWith("/chat")) return "ask";
  return "ask";
}

function pathForView(view: View) {
  if (view === "knowledge") return "/documents";
  if (view === "admin") return "/admin";
  return "/chat";
}

const searchRows: string[][] = [];

function Brand() {
  return (
    <div className="brand" aria-label="Beforest — Nature at Work">
      <span className="brand-logo" role="img" aria-label="Beforest — Nature at Work" />
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
}) {
  const items = [
    { id: "knowledge" as View, label: "Knowledge", icon: BookOpen },
    { id: "ask" as View, label: "Ask Beforest", icon: MessageSquareText },
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
        <div className="chat-sidebar-tools">
          <button className="new-chat-button" onClick={onNewChat}>
            <MessageSquareText size={17} />
            <span>New chat</span>
            <span className="new-chat-plus">+</span>
          </button>
          <div className="chat-sidebar-heading recent-heading">Recent chats</div>
          {recentChats.map((chat) => <button className={`chat-sidebar-row chat-history ${selectedChatId === chat.id ? "selected" : ""}`} key={chat.id} onClick={() => onSelectChat(chat)}><Clock3 size={15} /><span>{chat.title}</span></button>)}
        </div>
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
  const [personalNotifications, setPersonalNotifications] = useState<Array<{ id: number; title: string; detail: string; createdAt: string }>>([]);
  const notificationRef = useRef<HTMLDivElement | null>(null);
  const profileRef = useRef<HTMLDivElement | null>(null);
  const notifications = useMemo(() => {
    const completed = vectorStatus?.fileCounts?.completed ?? 0;
    const processing = vectorStatus?.fileCounts?.in_progress ?? 0;
    const failed = vectorStatus?.fileCounts?.failed ?? 0;
    const totalFeedback = (stats?.positive ?? 0) + (stats?.negative ?? 0);
    return [
      {
        title: completed ? `${completed} documents indexed` : "Knowledge base is connected",
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
    if (user.role !== "Admin") return;
    void Promise.all([
      fetch("/api/admin/stats").then((response) => response.json()),
      fetch("/api/openai/status").then((response) => response.json()),
    ])
      .then(([statsData, statusData]) => {
        setStats(statsData);
        setVectorStatus(statusData);
      })
      .catch(() => undefined);
  }, [user.role]);

  const loadPersonalNotifications = useCallback(() => {
    void fetch("/api/notifications")
      .then((response) => response.json())
      .then((data) => setPersonalNotifications(data.notifications || []))
      .catch(() => undefined);
  }, [user.id]);

  useEffect(() => {
    loadPersonalNotifications();
    const interval = window.setInterval(loadPersonalNotifications, 5000);
    return () => window.clearInterval(interval);
  }, [loadPersonalNotifications]);

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

  const showHeaderTitle = title !== "Admin" && title !== "Knowledge";

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
        {showHeaderTitle && <h1>{title}</h1>}
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
                <span>{notifications.length + personalNotifications.length} updates</span>
              </div>
              <div className="notification-list">
                {[...personalNotifications.map((item) => ({ ...item, tone: "success" })), ...notifications].map((item) => (
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

function KnowledgeView({ role }: { role: Role }) {
  const [filter, setFilter] = useState("");
  const [selectedCollection, setSelectedCollection] = useState("all");
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedType, setSelectedType] = useState("all");
  const [selectedOwner, setSelectedOwner] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [liveDocuments, setLiveDocuments] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [openingDocument, setOpeningDocument] = useState<string | null>(null);
  const [actionDocumentId, setActionDocumentId] = useState<string | null>(null);
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null);
  const [documentNotice, setDocumentNotice] = useState("");
  const filterRef = useRef<HTMLDivElement | null>(null);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const loadDocuments = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/documents/list");
      const data = (await response.json()) as {
        files?: Array<{ id: string; name: string; bytes: number; status: string; folder: string; owner: string; createdAt: number; dropboxPath?: string; dropboxFileId?: string }>;
        error?: string;
        model?: string;
      };
      if (!response.ok) throw new Error(data.error || "Unable to load documents.");
      setLiveDocuments((data.files || []).map((file) => ({
        id: file.id,
        documentId: file.id,
        name: file.name,
        type: file.name.split(".").pop()?.toUpperCase() || "FILE",
        folder: displayKnowledgeFolder(file.folder, file.owner),
        rawFolder: file.folder,
        owner: file.owner,
        updated: new Date(file.createdAt * 1000).toLocaleDateString(),
        status: file.status === "completed" ? "Indexed" : file.status,
        size: file.bytes ? `${(file.bytes / 1024 / 1024).toFixed(1)} MB` : "-",
        dropboxPath: file.dropboxPath,
        dropboxFileId: "dropboxFileId" in file ? String(file.dropboxFileId || "") : "",
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
  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      const target = event.target as Node;
      if (filterRef.current && !filterRef.current.contains(target)) {
        setFilterOpen(false);
      }
      if (actionMenuRef.current && !actionMenuRef.current.contains(target)) {
        setActionDocumentId(null);
      }
    }
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, []);
  const collections = useMemo(() => {
    const counts = new Map<string, number>();
    liveDocuments.forEach((document) => {
      const collection = document.folder || "Approved documents";
      counts.set(collection, (counts.get(collection) || 0) + 1);
    });

    return [
      { id: "all", label: "All knowledge", count: liveDocuments.length, icon: FolderOpen },
      ...Array.from(counts.entries())
        .sort(([first], [second]) => first.localeCompare(second))
        .map(([label, count]) => ({ id: label, label, count, icon: Folder })),
    ];
  }, [liveDocuments]);
  const filterOptions = useMemo(() => ({
    types: Array.from(new Set(liveDocuments.map((document) => document.type).filter(Boolean))).sort(),
    owners: Array.from(new Set(liveDocuments.map((document) => document.owner).filter(Boolean))).sort(),
    statuses: Array.from(new Set(liveDocuments.map((document) => document.status).filter(Boolean))).sort(),
  }), [liveDocuments]);
  const activeFilterCount = [selectedType, selectedOwner, selectedStatus].filter((value) => value !== "all").length;
  const filtered = liveDocuments.filter((document) => {
    if (!document.name.toLowerCase().includes(filter.toLowerCase())) return false;
    if (selectedCollection !== "all" && document.folder !== selectedCollection) return false;
    if (selectedType !== "all" && document.type !== selectedType) return false;
    if (selectedOwner !== "all" && document.owner !== selectedOwner) return false;
    if (selectedStatus !== "all" && document.status !== selectedStatus) return false;
    return true;
  });
  const clearDocumentFilters = () => {
    setSelectedType("all");
    setSelectedOwner("all");
    setSelectedStatus("all");
  };
  const openDocument = async (document: KnowledgeDocument) => {
    if (!document.dropboxPath || openingDocument) return;
    setOpeningDocument(document.id);
    const params = new URLSearchParams({
      path: document.dropboxPath,
      name: document.name,
    });
    window.open(`/api/documents/view?${params.toString()}`, "_blank", "noopener,noreferrer");
    window.setTimeout(() => setOpeningDocument(null), 500);
  };
  const deleteDocument = async (document: KnowledgeDocument) => {
    if (role !== "Admin" || deletingDocumentId) return;
    const confirmed = window.confirm(`Remove "${document.name}" from knowledge retrieval? The Dropbox file will not be deleted.`);
    if (!confirmed) return;
    setDeletingDocumentId(document.id);
    setDocumentNotice("");
    try {
      const response = await fetch("/api/documents/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dropboxPath: document.dropboxPath,
          fileName: document.name,
          dropboxFileId: document.dropboxFileId,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Unable to remove document.");
      setLiveDocuments((current) => current.filter((item) => item.id !== document.id));
      setActionDocumentId(null);
      setDocumentNotice(`Removed ${document.name} from knowledge retrieval.`);
    } catch (error) {
      setDocumentNotice(error instanceof Error ? error.message : "Unable to remove document.");
    } finally {
      setDeletingDocumentId(null);
    }
  };
  return (
    <div className="page knowledge-page">
      <div className="page-lead">
        <div>
          <h2>Knowledge explorer</h2>
          <p>
            Browse documents indexed in <strong>your permitted knowledge</strong>.
          </p>
        </div>
      </div>
      <div className="knowledge-layout">
        <aside className={`folder-panel ${collectionsOpen ? "open" : ""}`}>
          <button
            className="panel-label collections-toggle"
            type="button"
            aria-expanded={collectionsOpen}
            onClick={() => setCollectionsOpen((open) => !open)}
          >
            <span>Collections</span>
            <ChevronDown className={collectionsOpen ? "rotated" : ""} size={16} />
          </button>
          <div className="collection-options">
            {collections.map(({ id, label, count, icon: Icon }) => (
              <button
                className={`folder-row ${selectedCollection === id ? "selected" : ""}`}
                key={id}
                onClick={() => {
                  setSelectedCollection(id);
                  setCollectionsOpen(false);
                }}
              >
                <Icon size={18} />
                <span>{label}</span>
                <small>{count}</small>
              </button>
            ))}
          </div>
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
            <div className="document-filter-wrap" ref={filterRef}>
              <button
                className={`secondary ${activeFilterCount ? "active-filter" : ""}`}
                aria-expanded={filterOpen}
                onClick={() => setFilterOpen((open) => !open)}
              >
                <Filter size={16} />
                Filter{activeFilterCount ? ` (${activeFilterCount})` : ""}
              </button>
              {filterOpen && (
                <div className="document-filter-menu" role="dialog" aria-label="Document filters">
                  <label>
                    File type
                    <select value={selectedType} onChange={(event) => setSelectedType(event.target.value)}>
                      <option value="all">All file types</option>
                      {filterOptions.types.map((type) => <option key={type} value={type}>{type}</option>)}
                    </select>
                  </label>
                  <label>
                    Owner
                    <select value={selectedOwner} onChange={(event) => setSelectedOwner(event.target.value)}>
                      <option value="all">All owners</option>
                      {filterOptions.owners.map((owner) => <option key={owner} value={owner}>{owner}</option>)}
                    </select>
                  </label>
                  <label>
                    Status
                    <select value={selectedStatus} onChange={(event) => setSelectedStatus(event.target.value)}>
                      <option value="all">All statuses</option>
                      {filterOptions.statuses.map((status) => <option key={status} value={status}>{status}</option>)}
                    </select>
                  </label>
                  <button type="button" className="secondary clear-document-filters" onClick={clearDocumentFilters}>
                    Clear filters
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="table document-table">
            <div className="tr th">
              <span>Name</span>
              <span>Collection</span>
              <span>Owner</span>
              <span>Updated</span>
              <span>Status</span>
              <span>View</span>
            </div>
            {loading && <div className="empty-knowledge">Loading approved documents...</div>}
            {!loading && documentNotice && <div className="empty-knowledge knowledge-notice">{documentNotice}</div>}
            {!loading && loadError && <div className="empty-knowledge error-state">{loadError}</div>}
            {!loading && !loadError && filtered.length === 0 && <div className="empty-knowledge">No documents found in this collection.</div>}
            {!loading && !loadError && filtered.map((doc) => (
              <div
                className={`tr ${doc.dropboxPath ? "openable" : ""}`}
                key={doc.id}
                onClick={() => void openDocument(doc)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    void openDocument(doc);
                  }
                }}
                role={doc.dropboxPath ? "button" : undefined}
                tabIndex={doc.dropboxPath ? 0 : undefined}
              >
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
                <span>
                  {role === "Admin" ? (
                    <div className="document-action-wrap" ref={actionDocumentId === doc.id ? actionMenuRef : undefined}>
                      <button
                        className="icon-btn"
                        disabled={deletingDocumentId === doc.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          setActionDocumentId((current) => current === doc.id ? null : doc.id);
                        }}
                        title="Document actions"
                        aria-label={`Actions for ${doc.name}`}
                        aria-expanded={actionDocumentId === doc.id}
                      >
                        <MoreHorizontal size={17} />
                      </button>
                      {actionDocumentId === doc.id && (
                        <div className="document-action-menu">
                          <button type="button" disabled={!doc.dropboxPath || openingDocument === doc.id} onClick={(event) => { event.stopPropagation(); void openDocument(doc); }}>
                            <ExternalLink size={15} />
                            Open document
                          </button>
                          <button type="button" className="danger-menu-action" disabled={deletingDocumentId === doc.id} onClick={(event) => { event.stopPropagation(); void deleteDocument(doc); }}>
                            <X size={15} />
                            {deletingDocumentId === doc.id ? "Deleting..." : "Delete from knowledge"}
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <button
                      className="icon-btn"
                      disabled={!doc.dropboxPath || openingDocument === doc.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        void openDocument(doc);
                      }}
                      title="Open document"
                      aria-label={`Open ${doc.name}`}
                    >
                      <ExternalLink size={16} />
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

type ChatCitation = {
  fileId: string;
  filename: string;
  score?: number;
  excerpt?: string;
  dropboxPath?: string;
  url?: string;
};

type FeedbackReason = "slow_response" | "wrong_citation" | "poor_retrieval" | "not_relevant" | "missing_incomplete_information" | "accurate_helpful" | "clear_easy_to_understand" | "relevant_complete" | "other";

const feedbackReasons: Array<{ value: FeedbackReason; label: string }> = [
  { value: "slow_response", label: "Slow response" },
  { value: "wrong_citation", label: "Wrong citation" },
  { value: "missing_incomplete_information", label: "Missing information" },
  { value: "accurate_helpful", label: "Accurate & Helpful" },
  { value: "clear_easy_to_understand", label: "Clear & Easy to Understand" },
  { value: "relevant_complete", label: "Relevant & Complete" },
  { value: "other", label: "Other" },
];

const feedbackReasonLabels: Record<FeedbackReason, string> = {
  slow_response: "Slow response",
  wrong_citation: "Wrong citation",
  poor_retrieval: "Poor retrieval",
  not_relevant: "Not relevant",
  missing_incomplete_information: "Missing information",
  accurate_helpful: "Accurate & Helpful",
  clear_easy_to_understand: "Clear & Easy to Understand",
  relevant_complete: "Relevant & Complete",
  other: "Other",
};

function uniqueCitations(citations: ChatCitation[]) {
  const seen = new Set<string>();
  return citations.filter((citation, index) => {
    const sourceId = citation.dropboxPath || citation.fileId || citation.filename || `source-${index + 1}`;
    const key = sourceId.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sourceFileUrl(source: { dropboxPath?: string; fileId?: string; filename: string }, download = false) {
  const dropboxPath = source.dropboxPath || source.fileId;
  if (!dropboxPath) return "";
  const params = new URLSearchParams({
    path: dropboxPath,
    name: source.filename,
  });
  if (download) params.set("download", "1");
  return `/api/documents/view?${params.toString()}`;
}

function openAndDownloadSource(source: { openUrl: string; downloadUrl: string; title: string }) {
  if (!source.openUrl) return;
  window.open(source.openUrl, "_blank", "noopener,noreferrer");
  if (!source.downloadUrl) return;
  const link = document.createElement("a");
  link.href = source.downloadUrl;
  link.download = source.title;
  link.rel = "noopener noreferrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function AskView({ initialQuestion = "What is our approach to regenerative forestry?", conversationId, onChatStarted, fresh = false }: { initialQuestion?: string; conversationId: string; onChatStarted: (title: string) => void; fresh?: boolean }) {
  const [history, setHistory] = useState<Array<{ role: "user" | "assistant"; content: string; citations?: ChatCitation[] }>>([]);
  const [query, setQuery] = useState("");
  const [askedQuestion, setAskedQuestion] = useState(initialQuestion);
  const [answer, setAnswer] = useState(
    "Ask a question to test the approved knowledge base.",
  );
  const [liveSources, setLiveSources] = useState<ChatCitation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);
  const [feedbackRating, setFeedbackRating] = useState<"up" | "down" | "neutral">("neutral");
  const [feedbackReason, setFeedbackReason] = useState<FeedbackReason | "">("");
  const [feedbackNote, setFeedbackNote] = useState("");
  const [feedbackNotice, setFeedbackNotice] = useState("");
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  const [submittedFeedbackRating, setSubmittedFeedbackRating] = useState<"up" | "down" | "neutral" | null>(null);
  const [details, setDetails] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [appearanceThumbnail, setAppearanceThumbnail] = useState("");
  const sessionId = conversationId;

  useEffect(() => {
    void fetch("/api/appearance")
      .then((response) => response.json())
      .then((data) => setAppearanceThumbnail(typeof data.appearance?.thumbnail === "string" ? data.appearance.thumbnail : ""))
      .catch(() => setAppearanceThumbnail(""));
  }, []);

  useEffect(() => {
    if (fresh) return;
    void fetch(`/api/conversations?id=${encodeURIComponent(sessionId)}&title=${encodeURIComponent(initialQuestion)}&projectId=unassigned`)
      .then((response) => response.json())
      .then((data) => {
        if (!data?.messages?.length) return;
        const restored = data.messages.map((message: { role: "user" | "assistant"; content: string; citations?: ChatCitation[] }) => ({ role: message.role, content: message.content, citations: uniqueCitations(message.citations || []) }));
        setHistory(restored);
        const lastWithCitations = [...restored].reverse().find((message) => message.citations?.length);
        if (lastWithCitations?.citations) { setLiveSources(lastWithCitations.citations); setSourcesOpen(true); }
        const lastUser = [...restored].reverse().find((message) => message.role === "user");
        const lastAssistant = [...restored].reverse().find((message) => message.role === "assistant");
        if (lastUser) setAskedQuestion(lastUser.content);
        if (lastAssistant) setAnswer(lastAssistant.content);
      })
      .catch(() => undefined);
  }, [sessionId, initialQuestion, fresh]);

  const submit = async (question = query) => {
    const message = question.trim();
    if (!message || loading) return;
    setQuery("");
    setAskedQuestion(message);
    setLoading(true);
    setError("");
    setFeedback(null);
    setFeedbackNotice("");
    setFeedbackSubmitted(false);
    setSubmittedFeedbackRating(null);
    setLiveSources([]);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history, sessionId, stream: true }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Unable to search the knowledge base.");
      }
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("text/event-stream") && response.body) {
        setAnswer("");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let streamedAnswer = "";
        let streamedCitations: ChatCitation[] = [];
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() || "";
          for (const rawEvent of events) {
            const eventName = rawEvent.split("\n").find((line) => line.startsWith("event:"))?.replace("event:", "").trim();
            const dataLine = rawEvent.split("\n").find((line) => line.startsWith("data:"));
            if (!dataLine) continue;
            const payload = JSON.parse(dataLine.replace("data:", "").trim()) as {
              delta?: string;
              answer?: string;
              citations?: ChatCitation[];
              error?: string;
            };
            if (eventName === "delta" && payload.delta) {
              streamedAnswer += payload.delta;
              setAnswer(streamedAnswer);
            }
            if (eventName === "done") {
              streamedAnswer = payload.answer || streamedAnswer || "No answer was returned.";
              streamedCitations = uniqueCitations(payload.citations || []);
              setAnswer(streamedAnswer);
              setLiveSources(streamedCitations);
              setSourcesOpen(true);
            }
            if (eventName === "error") {
              throw new Error(payload.error || "Unable to search the knowledge base.");
            }
          }
        }
        const nextHistory = [
          ...history,
          { role: "user" as const, content: message },
          { role: "assistant" as const, content: streamedAnswer || "No answer was returned.", citations: streamedCitations },
        ].slice(-12);
        setHistory(nextHistory);
        void fetch("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: sessionId, title: initialQuestion === "What is our approach to regenerative forestry?" ? message : initialQuestion, projectId: null, messages: nextHistory }),
        }).catch(() => undefined);
        if (history.length === 0) onChatStarted(message);
        return;
      }
      const data = (await response.json()) as {
        answer?: string;
        citations?: ChatCitation[];
        error?: string;
        model?: string;
      };
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
        body: JSON.stringify({ id: sessionId, title: initialQuestion === "What is our approach to regenerative forestry?" ? message : initialQuestion, projectId: null, messages: nextHistory }),
      }).catch(() => undefined);
      if (history.length === 0) onChatStarted(message);
      setLiveSources(uniqueCitations(data.citations || []));
      setSourcesOpen(true);
    } catch (chatError) {
      setError(chatError instanceof Error ? chatError.message : "Chat failed.");
    } finally {
      setLoading(false);
    }
  };

  const displayedSources = uniqueCitations(liveSources).slice(0, 1).map((source, index) => ({
        title: source.filename,
        page: null as number | null,
        score: source.score,
        match: evidenceBand(source.score),
        text: source.excerpt || "This file was cited in the generated answer.",
        id: source.dropboxPath || source.fileId || `${source.filename}-${index}`,
        openUrl: sourceFileUrl(source),
        downloadUrl: sourceFileUrl(source, true),
      }));
  const evidenceScores = liveSources.map((source) => source.score).filter((score): score is number => typeof score === "number");
  const evidenceScore = evidenceScores.length ? Math.max(...evidenceScores) : null;
  const evidenceLevel = loading ? "Assessing evidence…" : evidenceBand(evidenceScore);
  const evidenceTone = loading ? "assessing" : evidenceLevel.toLowerCase().replace(" ", "-");
  const sendFeedback = async (rating: "up" | "down" | "neutral", reason: FeedbackReason, note = "") => {
    const response = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, rating, reason, note }),
    });
    if (!response.ok) throw new Error("Unable to save feedback.");
    setFeedback(rating === "neutral" ? null : rating);
    setFeedbackSubmitted(true);
    setSubmittedFeedbackRating(rating);
    setFeedbackNotice(note.trim() ? "Feedback note saved." : "Feedback saved.");
  };
  const openFeedbackModal = (rating: "up" | "down" | "neutral" = feedback || "neutral") => {
    setFeedbackRating(rating);
    setFeedbackReason("");
    setFeedbackNote("");
    setFeedbackNotice("");
    setFeedbackModalOpen(true);
  };
  const submitFeedbackNote = async () => {
    try {
      if (!feedbackReason) { setFeedbackNotice("Select a reason before submitting feedback."); return; }
      if (feedbackReason === "other" && !feedbackNote.trim()) { setFeedbackNotice("Add a note when selecting Other."); return; }
      await sendFeedback(feedbackRating, feedbackReason, feedbackNote);
      setFeedbackModalOpen(false);
    } catch (feedbackError) {
      setFeedbackNotice(feedbackError instanceof Error ? feedbackError.message : "Unable to save feedback.");
    }
  };

  return (
    <div className={`ask-layout ${sourcesOpen ? "with-sources" : ""}`}>
      <main className="ask-main">
        <div className="ask-inner">
          <div className="ask-box">
            <div className="ask-input">
              {appearanceThumbnail ? <span className="ask-logo" style={{ backgroundImage: `url(${appearanceThumbnail})` }} aria-hidden="true" /> : <Leaf size={21} />}
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void submit()}
                placeholder="Ask across your permitted knowledge…"
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
                  <div className="history-content">
                    <strong>{message.role === "user" ? "You" : "Beforest AI"}</strong>
                    <div className="markdown-answer"><ReactMarkdown remarkPlugins={[remarkGfm]}>{cleanDisplayText(message.content)}</ReactMarkdown></div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <article className="answer">
            <div className="question-row">
              <h2>{askedQuestion}</h2>
              <time>Now</time>
            </div>
            <div className="answer-body">
              <div>
                {loading ? (
                  <div className="answer-loading">
                    <i />
                    <span>Searching your knowledge base…</span>
                  </div>
                ) : error ? (
                  <div className="chat-error">
                    <strong>Could not answer</strong>
                    <span>{error}</span>
                  </div>
                ) : (
                  <div className="live-answer markdown-answer"><ReactMarkdown remarkPlugins={[remarkGfm]}>{cleanDisplayText(answer)}</ReactMarkdown></div>
                )}
                {displayedSources.length > 0 && (
                  <>
                    <h3>Sources ({displayedSources.length})</h3>
                    <div className="citation-list">
                      {displayedSources.map((s) => (
                        <button
                          key={s.id}
                          disabled={!s.openUrl}
                          onClick={() => {
                            openAndDownloadSource(s);
                          }}
                          title={s.openUrl ? `Open and download ${s.title}` : "Document file is unavailable"}
                        >
                          <FileText size={16} />
                          <span>{s.title}</span>
                          <small>{s.match}</small>
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
                      onClick={() => openFeedbackModal("up")}
                    >
                      <ThumbsUp size={18} />
                    </button>
                    <button
                      className={feedback === "down" ? "chosen" : ""}
                      onClick={() => { setFeedback("down"); openFeedbackModal("down"); }}
                    >
                      <ThumbsDown size={18} />
                    </button>
                    <button className={`write-feedback-button ${feedbackSubmitted ? "submitted" : ""}`} onClick={() => openFeedbackModal(submittedFeedbackRating || feedback || "neutral")}>
                      <MessageSquareText size={16} />
                      {feedbackSubmitted ? "Submitted" : "Write feedback"}
                    </button>
                  </div>
                </div>
                {feedbackNotice && <p className="feedback-save-notice">{feedbackNotice}</p>}
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
                      <strong>{displayedSources.length}</strong>
                    </div>
                    <div>
                      <span>Selected chunks</span>
                      <strong>{displayedSources.length}</strong>
                    </div>
                    <div>
                      <span>Provider</span>
                      <strong>Knowledge base</strong>
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
              <p>{displayedSources.length} selected · sorted by relevance</p>
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
                  <small>{s.match}</small>
                </div>
                <p>{s.text}</p>
                <footer>
                  {s.match} source{" "}
                  <button
                    disabled={!s.openUrl}
                    onClick={() => {
                      openAndDownloadSource(s);
                    }}
                    title={s.openUrl ? `Open and download ${s.title}` : "Document file is unavailable"}
                  >
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
                Ask a question to retrieve evidence from your approved knowledge base.
              </span>
            </div>
          )}
        </aside>
      )}
      {feedbackModalOpen && (
        <div className="modal-backdrop" onMouseDown={() => setFeedbackModalOpen(false)}>
          <div className="modal feedback-modal" role="dialog" aria-modal="true" aria-labelledby="feedback-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h2 id="feedback-title">Write feedback</h2>
                <p>Tell us what was helpful or what went wrong.</p>
              </div>
              <button className="icon-btn" onClick={() => setFeedbackModalOpen(false)}><X size={18} /></button>
            </div>
            <label>
              Feedback type
              <select value={feedbackRating} onChange={(event) => setFeedbackRating(event.target.value as "up" | "down" | "neutral")}>
                <option value="up">Positive</option>
                <option value="down">Negative</option>
              </select>
            </label>
            <label>
              Feedback reason
              <select value={feedbackReason} onChange={(event) => setFeedbackReason(event.target.value as FeedbackReason)}>
                <option value="">Select a reason</option>
                {feedbackReasons.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}
              </select>
            </label>
            <label>
              Feedback message
              <textarea value={feedbackNote} onChange={(event) => setFeedbackNote(event.target.value)} placeholder="Example: The answer used the wrong source, missed a document, or the explanation was unclear." />
            </label>
            {feedbackNotice && <p className="feedback-save-notice">{feedbackNotice}</p>}
            <div className="modal-actions">
              <button className="secondary" onClick={() => setFeedbackModalOpen(false)}>Cancel</button>
              <button className="primary" onClick={() => void submitFeedbackNote()}>Submit feedback</button>
            </div>
          </div>
        </div>
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
            <span>Results for “{query}”</span>
            <button className="secondary">
              <SlidersHorizontal size={16} />
              Search settings
            </button>
          </div>
          {[
            [
              "National Agroforestry Policy — Ministry of Agriculture",
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
  "Settings",
  "Appearance",
];

function AdminOverview({ onViewAll }: { onViewAll?: () => void }) {
  const [stats, setStats] = useState<{ activeUsers: number; queries: number; positive: number; negative: number } | null>(null);
  const [telemetry, setTelemetry] = useState<{ rows: Array<{ userName?: string; query: string; model?: string; latencyMs?: number; chunks: number; topScore?: number | null; feedback?: "up" | "down"; resolution?: string | null }>; averageLatencyMs?: number | null } | null>(null);
  const [vectorStatus, setVectorStatus] = useState<{ fileCounts?: { completed?: number; in_progress?: number; failed?: number; cancelled?: number } } | null>(null);
  useEffect(() => { void fetch("/api/admin/stats").then((r) => r.json()).then(setStats).catch(() => undefined); }, []);
  useEffect(() => { void fetch("/api/admin/telemetry").then((r) => r.json()).then(setTelemetry).catch(() => undefined); }, []);
  useEffect(() => { void fetch("/api/openai/status").then((r) => r.json()).then(setVectorStatus).catch(() => undefined); }, []);
  const needsReviewCount = (telemetry?.rows || []).filter(isNeedsReview).length;
  return (
    <>
      <div className="metric-strip">
        {[
          ["Active users", "—", "Not connected"],
          ["Queries this month", "—", "Not connected"],
          ["Positive feedback", "—", "No feedback yet"],
          ["Avg. response time", "—", "Awaiting telemetry"],
          ["Documents", "—", "Knowledge base"],
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
                <span>{row.userName || "Unknown user"}</span><span>{row.query}</span><span>Internal</span><span>{evidenceBand(row.topScore)}</span><span className={row.feedback === "up" ? "positive" : row.feedback === "down" ? "negative" : ""}>{row.feedback === "up" ? "Positive" : row.feedback === "down" ? "Negative" : "No feedback"}</span><span>{row.latencyMs ? `${row.latencyMs} ms` : "—"}</span>
              </div>
            ))}
          </div>
        </section>
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
  const [teams, setTeams] = useState<Array<{ id: number; name: string }>>([]);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "User" as Role, teamId: "" as number | "", active: true, mustChangePassword: true });
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const loadUsers = useCallback(() => {
    void fetch("/api/admin/users").then((r) => r.json()).then((data) => setUsers(data.users || [])).catch(() => setUsers([]));
  }, []);
  useEffect(() => { loadUsers(); }, [loadUsers]);
  useEffect(() => { void fetch("/api/admin/teams").then((r) => r.json()).then((data) => setTeams(data.teams || [])).catch(() => setTeams([])); }, []);
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
    setForm({ name: "", email: "", password: "", role: "User", teamId: "", active: true, mustChangePassword: true });
    setInviteOpen(true);
    setActionMessage("");
  };
  const openEdit = (user: AuthUser) => {
    setEditingUser(user);
    setForm({ name: user.name, email: user.email, password: "", role: user.role, teamId: user.teamId ?? "", active: user.active, mustChangePassword: false });
    setInviteOpen(true);
    setActionMessage("");
  };
  const saveUser = async () => {
    if (!form.teamId) {
      setActionMessage("Select a team before saving the user.");
      return;
    }
    const payload = editingUser ? { id: editingUser.id, ...form, teamId: Number(form.teamId), password: form.password || undefined } : { ...form, teamId: Number(form.teamId) };
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
          <p>Manage access across Admin and User roles.</p>
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
      {inviteOpen && <div className="invite-panel"><div className="invite-head"><h3>{editingUser ? "Edit user" : "Create user credentials"}</h3><button className="icon-btn" onClick={() => setInviteOpen(false)}><X size={17} /></button></div><label>Name<input value={form.name} onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))} placeholder="Full name" /></label><label>Email / username<input type="email" value={form.email} onChange={(e) => setForm((current) => ({ ...current, email: e.target.value }))} placeholder="name@company.com" /></label><label>{editingUser ? "New password (optional)" : "Temporary password"}<input type="password" value={form.password} onChange={(e) => setForm((current) => ({ ...current, password: e.target.value }))} placeholder="Minimum 8 characters" /></label><label>Team / collection<select value={form.teamId} onChange={(e) => setForm((current) => ({ ...current, teamId: e.target.value ? Number(e.target.value) : "" }))}><option value="">Select a team</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label><label>Role<select value={form.role} onChange={(e) => setForm((current) => ({ ...current, role: e.target.value as Role }))}><option>User</option><option>Admin</option></select></label><label>Status<select value={form.active ? "active" : "inactive"} onChange={(e) => setForm((current) => ({ ...current, active: e.target.value === "active" }))}><option value="active">Active</option><option value="inactive">Inactive</option></select></label><label className="checkbox-line"><input type="checkbox" checked={form.mustChangePassword} onChange={(e) => setForm((current) => ({ ...current, mustChangePassword: e.target.checked }))} />Require password change on first login</label><button className="primary" onClick={() => void saveUser()}>{editingUser ? "Save user" : "Create user"}</button></div>}
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
                {r[0]} · {r[2]}
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
              <small>{r[1]} · Today</small>
            </span>
            <em>{r[2]}</em>
            <button className="secondary">Review</button>
          </div>
        ))}
      </div></>,
    ],
    Appearance: [
      "Appearance",
      "Customize the workspace colors and visual identity.",
      <AppearanceSettings key="appearance" />,
    ],
    Settings: [
      "System settings",
      "Control conversation history, notifications, and answer style.",
      <SystemSettings key="settings" />,
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
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const loadDocuments = useCallback(() => {
    setLoading(true);
    setMessage("");
    void fetch("/api/documents/list")
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Unable to load documents.");
        return data;
      })
      .then((data) => {
        const files = data.files || [];
        setDocuments(files);
        const owners = Array.from(new Set(files.map((document: { owner?: string }) => document.owner || "Unknown uploader")));
        setExpanded(Object.fromEntries(owners.map((owner) => [owner, true])));
      })
      .catch((error) => {
        setDocuments([]);
        setMessage(error instanceof Error ? error.message : "Unable to load documents.");
      })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { loadDocuments(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadDocuments]);
  if (loading) return <div className="empty-admin-panel">Loading approved documents...</div>;
  if (!documents.length) return <div className="empty-admin-panel">{message || "No approved documents are currently available."}</div>;
  const groups = documents.reduce<Record<string, typeof documents[number][]>>((result, document) => { const owner = document.owner || "Unknown uploader"; (result[owner] ||= []).push(document); return result; }, {});
  return <div className="admin-documents-list">{message && <div className="knowledge-notice">{message}</div>}{Object.entries(groups).map(([owner, files]) => <div className="document-owner-group" key={owner}><button className="document-owner-row" onClick={() => setExpanded((current) => ({ ...current, [owner]: !current[owner] }))}><span><ChevronDown size={16} className={expanded[owner] ? "rotated" : ""} /><strong>{owner}</strong></span><small>{files.length} document{files.length === 1 ? "" : "s"}</small></button>{expanded[owner] && files.map((document) => <div className="admin-document-row" key={document.id}><span><FileText size={17} /><strong>{document.name}</strong></span><small>{document.status || "Indexed"}</small><small>{document.bytes ? `${Math.round(document.bytes / 1024)} KB` : "-"}</small><small>Searchable</small></div>)}</div>)}</div>;
}

function AdminFeedback() {
  const [items, setItems] = useState<Array<{ id: number; rating: "up" | "down" | "neutral"; reason?: FeedbackReason | null; note?: string | null; query?: string; userName?: string; createdAt: string; status?: "open" | "resolved"; resolutionNote?: string | null; notificationSent?: boolean }>>([]);
  const [reviewId, setReviewId] = useState<number | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState<Record<number, string>>({});
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const [actionMessage, setActionMessage] = useState("");
  const load = useCallback(() => { void fetch("/api/feedback").then((r) => r.json()).then((data) => setItems(data.feedback || [])).catch(() => undefined); }, []);
  useEffect(load, [load]);
  const resolve = async (id: number) => {
    setResolvingId(id);
    setActionMessage("");
    try {
      const response = await fetch("/api/feedback", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feedbackId: id, resolutionNote: resolutionNotes[id] || "" }) });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        setActionMessage(data.notified ? "Feedback resolved and the user was notified." : "Feedback resolved, but no active user account matched this feedback.");
        load();
      } else {
        setActionMessage(data.error || "Unable to resolve feedback.");
      }
    } catch {
      setActionMessage("Unable to resolve feedback.");
    } finally {
      setResolvingId(null);
    }
  };
  if (!items.length) return <div className="empty-admin-panel">No feedback has been submitted yet.</div>;
  const label = (rating: "up" | "down" | "neutral") => rating === "up" ? "Positive" : rating === "down" ? "Negative" : "Neutral";
  const reasonLabel = (reason?: FeedbackReason | null) => reason ? feedbackReasonLabels[reason] || "Uncategorized" : "Uncategorized";
  const sortedItems = [...items].sort((a, b) => {
    const priority = { down: 0, neutral: 1, up: 2 };
    return priority[a.rating] - priority[b.rating] || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
  const groupedItems = Object.entries(sortedItems.reduce<Record<string, typeof sortedItems>>((groups, item) => { const key = item.reason || "uncategorized"; (groups[key] ||= []).push(item); return groups; }, {})).sort(([, left], [, right]) => right.length - left.length);
  return (
    <div className="admin-feedback-list redesigned">
      {groupedItems.map(([reason, group]) => <section className="feedback-reason-group" key={reason}>
        <h3>{reasonLabel(reason === "uncategorized" ? null : reason as FeedbackReason)} <small>{group.length}</small></h3>
        {group.map((item) => (
        <div className={`admin-feedback-item feedback-${item.rating}`} key={item.id}>
          <div className="admin-feedback-row redesigned">
            <span className={`feedback-badge ${item.rating}`}>{label(item.rating)}</span>
            <div className="feedback-main">
              <strong>{item.query || "Conversation feedback"}</strong>
              <small>{item.userName || "Unknown user"} · {new Date(item.createdAt).toLocaleString()}</small>
              <p className={item.note ? "feedback-note" : "feedback-note empty"}>{item.note || "No written feedback added."}</p>
            </div>
            <div className="feedback-actions"><button className="secondary" onClick={() => setReviewId(reviewId === item.id ? null : item.id)}>{reviewId === item.id ? "Close details" : "View details"}</button><span className={`feedback-status ${item.status === "resolved" ? "resolved" : "open"}`}>{item.status === "resolved" ? "Resolved" : "Open"}</span></div>
          </div>
          {reviewId === item.id && (
            <div className="feedback-review-panel redesigned">
              <strong>Feedback details</strong>
              <span>Rating: {label(item.rating)}</span>
              <span>Query: {item.query || "Not available"}</span>
              <span>Submitted by: {item.userName || "Unknown user"}</span>
              <span>Submitted: {new Date(item.createdAt).toLocaleString()}</span>
              <span>Message: {item.note || "No written feedback added."}</span>
              {item.status !== "resolved" && <label className="feedback-resolution-label">Resolution note<input value={resolutionNotes[item.id] || ""} onChange={(event) => setResolutionNotes((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="Optional note for the user" /></label>}
              {item.resolutionNote && <span>Resolution note: {item.resolutionNote}</span>}
              <div className="feedback-review-actions">
                {item.status !== "resolved" ? <button className="primary" disabled={resolvingId === item.id} onClick={() => void resolve(item.id)}>{resolvingId === item.id ? "Resolving..." : "Mark resolved"}</button> : !item.notificationSent && <button className="secondary" disabled={resolvingId === item.id} onClick={() => void resolve(item.id)}>Notify user</button>}
                {item.status === "resolved" && item.notificationSent && <span className="feedback-status resolved">Resolved and notified</span>}
              </div>
            </div>
          )}
        </div>
        ))}
      </section>)}
      {actionMessage && <p className="admin-action-message">{actionMessage}</p>}
    </div>
  );
}

function AdminSearchHistory() {
  const [rows, setRows] = useState<Array<{ userName?: string; query: string; latencyMs?: number; chunks: number; topScore?: number | null; sources?: string[]; feedback?: "up" | "down" }>>([]);
  const [traceIndex, setTraceIndex] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  useEffect(() => { void fetch("/api/admin/telemetry").then((r) => r.json()).then((data) => setRows(data.rows || [])).catch(() => undefined); }, []);
  if (!rows.length) return <div className="empty-admin-panel">No search history has been recorded yet.</div>;
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const visibleRows = rows.slice(start, start + pageSize);
  return <div className="admin-history-list"><div className="admin-history-head"><span>User / query</span><span>Evidence</span><span>Feedback</span><span>Latency</span><span /></div>{visibleRows.map((row, index) => { const absoluteIndex = start + index; return <div className="admin-history-item" key={`${row.query}-${absoluteIndex}`}><div className="admin-history-row"><span><strong>{row.query}</strong><small>{row.userName || "Unknown user"} · Internal</small></span><span>{evidenceBand(row.topScore)}{typeof row.topScore === "number" ? ` · ${row.topScore.toFixed(2)}` : ""}</span><span className={row.feedback === "up" ? "positive" : row.feedback === "down" ? "negative" : ""}>{row.feedback === "up" ? "Positive" : row.feedback === "down" ? "Negative" : "No feedback"}</span><span>{row.latencyMs ? `${row.latencyMs} ms` : "—"}</span><button className="secondary" onClick={() => setTraceIndex(traceIndex === absoluteIndex ? null : absoluteIndex)}>{traceIndex === absoluteIndex ? "Hide trace" : "Trace"}</button></div>{traceIndex === absoluteIndex && <div className="trace-details"><strong>Retrieval trace</strong><span>Mode: Approved knowledge search</span><span>Selected sources: {row.sources?.length ? row.sources.join(", ") : "None"}</span><span>Selected excerpts: {row.chunks}</span><span>Top relevance score: {typeof row.topScore === "number" ? row.topScore.toFixed(3) : "Not available"}</span><span>Feedback: {row.feedback === "up" ? "Positive" : row.feedback === "down" ? "Negative" : "Not provided"}</span></div>}</div>; })}<div className="pagination-bar"><span>Showing {start + 1}-{Math.min(start + pageSize, rows.length)} of {rows.length} searches</span><div><button className="secondary" disabled={safePage === 1} onClick={() => { setTraceIndex(null); setPage((current) => Math.max(1, current - 1)); }}>Previous</button><strong>Page {safePage} of {totalPages}</strong><button className="secondary" disabled={safePage === totalPages} onClick={() => { setTraceIndex(null); setPage((current) => Math.min(totalPages, current + 1)); }}>Next</button></div></div></div>;
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
        <span><b>Low score but source is correct:</b> Document may need better metadata or source preparation.</span>
        <span><b>Wrong document retrieved:</b> Add clearer filename/folder metadata or improve query expansion.</span>
        <span><b>No excerpts selected:</b> Check whether the document is available in the approved knowledge base.</span>
        <span><b>User gave thumbs down:</b> Review answer quality and source match.</span>
        <span><b>Knowledge missing:</b> Approve the missing document or mark it as a knowledge gap.</span>
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

function SystemSettings() {
  const defaults = useMemo(() => ({ conversationHistory: true, emailNotifications: false }), []);
  const [settings, setSettings] = useState(defaults);
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_KNOWLEDGE_SYSTEM_PROMPT);
  const [promptStatus, setPromptStatus] = useState("");
  useEffect(() => { void fetch("/api/admin/settings").then((r) => r.json()).then((data) => { const next = { ...defaults }; for (const item of data.settings || []) { if (item.key in next) next[item.key as keyof typeof next] = item.value === "true"; if (item.key === "knowledge.systemPrompt") setSystemPrompt(item.value || DEFAULT_KNOWLEDGE_SYSTEM_PROMPT); } setSettings(next); }).catch(() => undefined); }, [defaults]);
  const toggle = (key: keyof typeof settings) => { const value = !settings[key]; setSettings((current) => ({ ...current, [key]: value })); void fetch("/api/admin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, value }) }); };
  const savePrompt = async () => {
    const trimmed = systemPrompt.trim();
    if (trimmed.length < 80) {
      setPromptStatus("Prompt is too short. Add tone, structure, and accuracy rules.");
      return;
    }
    const response = await fetch("/api/admin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "knowledge.systemPrompt", value: trimmed }) });
    setPromptStatus(response.ok ? "System prompt saved." : "Unable to save system prompt.");
  };
  const resetPrompt = () => {
    setSystemPrompt(DEFAULT_KNOWLEDGE_SYSTEM_PROMPT);
    setPromptStatus("Default prompt restored locally. Save to apply it.");
  };
  const promptStatusTone = promptStatus.startsWith("Unable") || promptStatus.startsWith("Prompt is too short") ? "error" : "success";
  const rows: Array<[keyof typeof settings, string, string]> = [["conversationHistory", "Conversation history", "Retain query and answer history for 90 days"], ["emailNotifications", "Email notifications", "Notify teams about newly published documents"]];
  return <><div className="setting-list">{rows.map(([key, title, description]) => <div key={key}><span><strong>{title}</strong><small>{description}</small></span><button className={`toggle ${settings[key] ? "on" : ""}`} onClick={() => toggle(key)}><i /></button></div>)}</div><div className="settings-form prompt-settings-form"><label className="span-2">System prompt<textarea value={systemPrompt} onChange={(event) => { setSystemPrompt(event.target.value); setPromptStatus(""); }} /></label><div className="span-2 form-actions"><button className="secondary" onClick={resetPrompt}>Reset default</button><button className="primary" onClick={() => void savePrompt()}>Save prompt</button></div>{promptStatus && <div className={`admin-action-message prompt-save-message span-2 ${promptStatusTone}`} role="status" aria-live="polite">{promptStatusTone === "success" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}<span>{promptStatus}</span></div>}</div></>;
}

function AdminView({ currentUser, initialTab = "Overview" }: { currentUser: AuthUser; initialTab?: string }) {
  const [tab, setTab] = useState(initialTab);
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
            onClick={() => {
              setTab(t);
            }}
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
      </section>
    </main>
  );
}

export default function Home() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, authLoading, setUser } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [chatKey, setChatKey] = useState(0);
  const [selectedChat, setSelectedChat] = useState<ConversationSummary | null>(null);
  const [activeConversationId, setActiveConversationId] = useState(createConversationId);
  const [recentChats, setRecentChats] = useState<ConversationSummary[]>([]);
  const role = user?.role || "User";
  const refreshConversations = useCallback(() => {
    if (!user) return;
    void fetch("/api/conversations")
      .then((response) => response.json())
      .then((data: { conversations?: ConversationSummary[] }) => {
        const conversations = data.conversations || [];
        setRecentChats(conversations.slice(0, 12));
      })
      .catch(() => {
        setRecentChats([]);
      });
  }, [user]);
  useEffect(() => {
    refreshConversations();
  }, [refreshConversations]);
  if (authLoading) return <main className="login-shell"><section className="login-card"><Brand /><p>Checking session…</p></section></main>;
  if (!user) return <LoginView onLogin={(nextUser) => { setUser(nextUser); router.push(pathForView(viewFromPath(pathname, nextUser.role))); }} />;
  const effectiveView = viewFromPath(pathname, role);
  const title = {
    knowledge: "Knowledge",
    ask: "Ask Beforest",
    web: "Web search",
    admin: "Admin",
  }[effectiveView];
  return (
    <div className="app-shell">
      <Sidebar
        view={effectiveView}
        setView={(nextView) => router.push(pathForView(nextView))}
        role={role}
        mobileOpen={mobileOpen}
        closeMobile={() => setMobileOpen(false)}
        onNewChat={() => { setSelectedChat(null); setActiveConversationId(createConversationId()); setChatKey((key) => key + 1); router.push("/chat"); }}
        onSelectChat={(chat) => { setSelectedChat(chat); setActiveConversationId(chat.id); setChatKey((key) => key + 1); router.push("/chat"); }}
        selectedChatId={selectedChat?.id || activeConversationId}
        recentChats={recentChats}
      />
      <div className="app-content">
        <Header
          title={title}
          user={user}
          onLogout={() => {
            void fetch("/api/auth/logout", { method: "POST" });
            setUser(null);
            setRecentChats([]);
            setSelectedChat(null);
            router.push("/login");
          }}
          openMobile={() => setMobileOpen(true)}
        />
        {effectiveView === "knowledge" && <KnowledgeView role={role} />}
        {effectiveView === "ask" && <AskView key={`${chatKey}-${activeConversationId}`} conversationId={activeConversationId} initialQuestion={selectedChat?.title || undefined} fresh={!selectedChat} onChatStarted={(chatTitle) => {
          const nextChat = { id: activeConversationId, title: chatTitle, projectId: null };
          setRecentChats((current) => [nextChat, ...current.filter((chat) => chat.id !== activeConversationId)].slice(0, 12));
        }} />}
        {effectiveView === "web" && <WebView />}
        {effectiveView === "admin" && <AdminView key={pathname.startsWith("/settings") ? "settings" : "admin"} currentUser={user} initialTab={pathname.startsWith("/settings") ? "Settings" : "Overview"} />}
      </div>
    </div>
  );
}










