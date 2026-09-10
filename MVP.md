# Beforest AI — Minimum Viable Product Specification

## 1. Product overview

Beforest AI is a folder-based knowledge management and retrieval application. It allows teams to upload organizational documents, extract and index their contents, ask questions grounded in those documents, and optionally search the public web through SearXNG.

```text
Beforest AI
├── Knowledge Explorer → Knowledge Database
├── RAG Search → Vector Store
└── External Web Search
    ├── SearXNG → Search result discovery
    ├── HTTP extractor → Webpage content extraction
    └── Playwright/Chromium → JavaScript-page fallback
```

## 2. MVP objectives

The MVP must provide:

- Folder-based document organization.
- Secure document upload and processing.
- Text extraction and OCR where required.
- Document chunking, embedding, and vector indexing.
- Fast internal document question answering with citations.
- Retrieval relevance scoring, reranking, and traceability.
- User feedback for continuous retrieval and answer-quality improvement.
- External web search using SearXNG.
- Role-based access using Admin and User roles.
- An admin panel for system configuration, monitoring, analytics, and audit.

## 3. Technology baseline

- Generation model: `gpt-5-mini`
- Embedding model: `text-embedding-3-small`
- Proposed vector layer: OpenAI vector stores/file search
- External search provider: SearXNG
- Browser fallback: Playwright with headless Chromium

### Vector-layer decision to validate

Before full implementation, the team must validate whether OpenAI's managed vector-store workflow provides the required control over custom embeddings, chunking, retrieval scores, metadata filtering, and reranking.

If those controls are insufficient, the fallback is a dedicated vector database such as Qdrant, Pinecone, or PostgreSQL with pgvector while continuing to use `text-embedding-3-small`.

## 4. User roles

### Admin

Admins have complete system access, including:

- Admin panel access.
- User and role management.
- Team, folder, document, and permission management.
- Document upload, approval, publishing, replacement, archival, and deletion.
- Search and conversation analytics.
- Retrieval traces and feedback review.
- Model, prompt, RAG, and SearXNG configuration.
- Usage, cost, performance, security, and audit information.

### User

Users can:

- View permitted folders and documents.
- Ask questions against permitted internal knowledge.
- Upload documents when the current deployment allows user uploads.
- Use SearXNG when enabled by an Admin.
- View their conversations and citations.
- Rate answers and submit feedback.

Users cannot access the admin panel.

## 5. Permission requirements

- Permissions must be applied before retrieval. Unauthorized chunks must never be sent to the model.
- Access can be assigned by user, team, folder, or document.
- User uploads are limited to explicitly permitted folders.
- Only Admins can assign permissions or permanently delete content.
- Notifications can only be sent to audiences permitted to access the document.
- All uploads, approvals, permission changes, configuration changes, downloads, and deletions must be audited.
- The system must support a configurable user upload workflow:
  - Admin approval before publishing; or
  - Direct publishing for trusted Users in selected folders.

## 6. Document ingestion pipeline

```text
Upload document into permitted folder
→ validate file type, size, and permissions
→ perform security and malware checks
→ detect format
→ extract text or run OCR
→ normalize content
→ detect duplicates and versions
→ split content into chunks
→ generate embeddings
→ index chunks in the vector layer
→ validate indexing
→ publish or request Admin approval
→ notify permitted team members
```

### Ingestion requirements

- Processing must run asynchronously.
- The UI must display queued, processing, indexed, failed, and published states.
- Failed jobs must be retryable.
- The extracted text and chunks must be previewable by an Admin.
- Duplicate files and updated versions must be identifiable.
- Deletion and permission changes must synchronize with the vector index.
- The initial supported-file list will be finalized during technical design; unsupported files must fail safely with a clear message.

## 7. Query and answer pipeline

```text
Authenticate user
→ select search mode
→ normalize the query
→ apply permission, folder, and metadata filters
→ retrieve candidate chunks
→ score and rerank candidates
→ remove chunks below the relevance threshold
→ send the best evidence to GPT-5 mini
→ stream the grounded answer with citations
→ collect user feedback
→ record retrieval trace, configuration, and latency
```

### Search modes

- Internal: Search only permitted organizational documents. This is the default.
- Internal + Web: Combine permitted internal evidence with public web information.
- Web only: Search public information without retrieving internal documents.

Internal and web sources must be clearly separated in the answer. Web sources must not silently override official internal policies or documents.

## 8. Retrieval relevance and observability

The system must record the following for each query:

- Original and normalized query.
- Search mode.
- User, role, and applied permission scope.
- Folder and metadata filters.
- Candidate document and chunk identifiers.
- Initial similarity or retrieval score.
- Reranked score.
- Relevance threshold.
- Accepted and rejected chunks.
- Evidence sent to the answer model.
- Citations included in the answer.
- Retrieval, reranking, time-to-first-token, and total-response latency.
- Prompt version, model configuration, and retrieval configuration.
- Whether SearXNG was used.

Admins must be able to inspect this flow:

```text
Query
→ candidate chunks
→ initial scores
→ reranked scores
→ selected evidence
→ generated answer and citations
→ user feedback
```

The initial retrieval strategy should retrieve a limited candidate set, rerank it, and pass only the strongest chunks to the model. An additional LLM-based reranker should be introduced only if evaluation shows that the lower-latency approach is insufficient.

When evidence does not meet the configured relevance threshold, the system must state that it cannot find reliable internal evidence and optionally offer web search.

## 9. User feedback

Each answer must support:

- Thumbs up or thumbs down.
- Optional 1–5 rating.
- Optional written feedback.
- A problem category:
  - Incorrect answer
  - Relevant document not found
  - Wrong source
  - Outdated information
  - Incomplete answer
  - Too slow
  - Other
- An optional expected answer for expert reviewers.

The stored feedback record must include:

- Query and answer.
- Retrieved document and chunk identifiers.
- Retrieval and reranking scores.
- Citations.
- Prompt and configuration versions.
- User rating and comment.
- Response latency.
- Review and resolution status.

Feedback should first be used to improve chunking, metadata, permissions, retrieval count, thresholds, reranking, prompts, and source prioritization. Model fine-tuning should be considered only after enough reviewed, high-quality examples have been collected.

## 10. SearXNG external search

SearXNG will be integrated through its API and will not be exposed as a separate application.

```text
Sanitized user query
→ SearXNG search API
→ rank and select URLs
→ fetch pages using lightweight HTTP extraction
→ use Playwright/Chromium only when required
→ clean and chunk webpage content
→ rerank passages
→ answer with URL citations
```

### Web-search requirements

- Internal knowledge search remains the default.
- Web search can be enabled or disabled globally and by user or role.
- Confidential document content must never be included in an external search query.
- Web requests must use timeouts, response-size limits, domain controls, and safe content handling.
- Retrieved webpages must be treated as untrusted content and isolated from system instructions.
- Web citations must include the source URL and be visually separated from internal citations.
- Query, selected sources, latency, and feedback must be recorded.
- Playwright/Chromium is a fallback for JavaScript-rendered pages, not the default fetch mechanism.

## 11. Admin panel

### Overview

- Total, new, active, daily, weekly, and monthly users.
- Total queries, uploads, indexed documents, and processing failures.
- Positive and negative feedback rates.
- Average retrieval time, time to first token, and total response time.
- Document-processing success rate.
- Storage, token, model, and external-search usage.

### Users and permissions

- Create, disable, reactivate, and inspect users.
- Assign Admin or User roles.
- Manage teams and memberships.
- Manage folder and document permissions.
- View sessions and recent activity.
- Review permission-change history.

### Knowledge management

- Browse the full folder and document inventory.
- Inspect processing and publication status.
- Preview extracted text and chunks.
- Review versions, duplicates, OCR status, and ownership.
- Retry extraction or indexing.
- Approve, publish, archive, restore, or delete documents.
- Identify stale, failed, or unused content.

### Search and conversation analytics

- Search histories filtered by user, team, folder, search mode, and date.
- Frequently searched topics.
- Queries with no useful results.
- Low-confidence and negatively rated queries.
- Internal versus web-search usage.
- Full retrieval traces and cited sources.
- Retrieval and response latency.

Full search history can contain sensitive information. Access must be restricted, audited, and governed by configurable retention, redaction, export, and deletion policies.

### Feedback and quality

- Feedback trends and categories.
- Reviewed and unresolved feedback.
- Worst-performing queries and documents.
- Admin annotations and corrected answers.
- Evaluation-dataset management.
- Retrieval metrics such as precision@K, recall@K, MRR, and citation correctness.
- Comparison of prompt, model, and retrieval versions.

### Models, prompts, and RAG configuration

- Active generation model.
- Embedding and vector-layer configuration.
- Versioned system prompt editor with rollback.
- Separate prompts for RAG, external search, and query rewriting.
- Chunking and overlap configuration where supported.
- Candidate count, final chunk count, and relevance threshold.
- Reranking configuration.
- Citation and insufficient-evidence behaviour.
- Draft, test, and production configuration stages.
- A controlled test console using a fixed evaluation set.

API keys and secrets must be stored securely and must not be displayed after initial entry.

### SearXNG configuration

- Enable or disable external search.
- Control access by user or role.
- Configure allowed and blocked domains.
- Configure timeouts and result limits.
- Review usage, failures, and latency.
- Configure privacy and retention rules.

### Performance, usage, and cost

- Retrieval, reranking, and generation latency.
- Time to first token.
- Token, vector-storage, and external-search usage.
- Cost by user, team, date, and model.
- Cache hit rate.
- Rate limits, errors, and timeouts.
- Slow-query investigation and usage alerts.

### Security and audit

- Login and failed-login events.
- Upload, download, sharing, publication, and deletion events.
- Permission, prompt, model, and configuration changes.
- Administrative access to user conversations.
- Suspicious-activity alerts.
- Retention, export, and deletion controls.

## 12. Core data entities

The technical design must include at least:

- Users
- Roles
- Teams and memberships
- Folders
- Documents and document versions
- Document permissions
- Processing jobs
- Extracted content
- Chunks and vector references
- Conversations, queries, and answers
- Retrieved chunks and retrieval scores
- Citations
- User feedback and feedback reviews
- Notifications
- Prompt versions
- Model and RAG configurations
- Search-provider configurations
- Audit logs
- Usage, cost, and latency metrics

Every answer must retain the exact document versions, chunks, scores, model, prompt, and retrieval configuration that produced it.

## 13. Performance approach

- Run extraction and indexing asynchronously.
- Apply permission and metadata filters before vector retrieval.
- Keep the candidate set bounded.
- Pass only high-relevance chunks to the answer model.
- Stream answers to reduce perceived latency.
- Cache safe repeated queries while respecting permissions and document versions.
- Avoid SearXNG unless the selected search mode requires it.
- Prefer HTTP extraction over browser automation.
- Measure retrieval, reranking, time to first token, and total response time separately.
- Establish final latency service levels from prototype benchmarks.

## 14. Security and privacy requirements

- Enforce authorization at the API, database, retrieval, and file-storage layers.
- Encrypt data in transit and at rest.
- Store API credentials in a secrets manager.
- Scan uploaded files and safely reject malicious or corrupted content.
- Treat documents and web pages as untrusted model context.
- Prevent prompt content from overriding application-level instructions.
- Audit privileged actions and administrative access to user histories.
- Define retention, deletion, backup, and recovery policies.
- Ensure external queries cannot expose confidential internal information.

## 15. MVP success criteria

- Unauthorized documents and chunks are never retrieved for a user.
- Every document-grounded answer includes valid source citations.
- Admins can trace an answer back to its selected chunks and scores.
- Negative feedback is linked to the exact retrieval and configuration trace.
- Low-confidence retrieval produces a transparent insufficient-evidence response.
- Extraction and indexing failures are visible and retryable.
- Prompt, model, and retrieval changes are versioned and reversible.
- Internal and external evidence is clearly distinguished.
- Retrieval and generation latency are independently measurable.

## 16. Prototype and validation

Before completing the full interface, build a technical prototype using approximately 50–100 representative documents. Include:

- Common office and text formats.
- Scanned documents requiring OCR.
- Multiple folders and permission scenarios.
- Duplicate and updated document versions.
- Retrieval relevance and reranking tests.
- Citation verification.
- User feedback capture.
- SearXNG queries and source extraction.
- Streaming and latency measurement.

The prototype must validate the vector-layer decision and establish realistic quality and performance targets.

## 17. Delivery phases

1. Product requirements and technical architecture
2. Authentication, roles, teams, and permissions
3. Folder and document management
4. Extraction, OCR, chunking, and indexing
5. Internal RAG search, streaming, and citations
6. Retrieval traces, scoring, and user feedback
7. Admin panel and knowledge operations
8. SearXNG and webpage extraction
9. Evaluation, security, and performance testing
10. Controlled pilot and production rollout

## 18. Out of scope for the initial MVP

- Model fine-tuning before sufficient reviewed feedback exists.
- Fully autonomous web browsing or web actions.
- Supporting every possible file format without validation.
- Multiple additional organizational roles beyond Admin and User.
- Advanced workflow automation unrelated to document ingestion and review.
- Native mobile applications.

## 19. Immediate next deliverables

- Approve this MVP specification.
- Finalize supported file formats and maximum upload sizes.
- Decide whether user uploads require approval by default.
- Validate OpenAI managed vector stores against retrieval-control requirements.
- Define the database schema and API contracts.
- Create interface wireframes.
- Prepare the prototype evaluation dataset.
- Convert the delivery phases into an implementation backlog.
