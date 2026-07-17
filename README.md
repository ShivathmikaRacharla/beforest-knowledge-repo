# Beforest Knowledge Assistant

A Next.js knowledge management and RAG assistant for Beforest AI.

The application lets permitted users upload documents, browse indexed knowledge, ask questions against an OpenAI vector store, review retrieval quality, collect feedback, and manage users/admin settings from a live dashboard.

## What this app does

- Upload documents into a knowledge workspace
- Send uploaded files to the configured OpenAI vector store
- Ask questions using GPT with grounded source references
- Store chat history, feedback, document metadata, users, projects, and admin settings
- Support role-based access:
  - Admin: full access
  - User: Knowledge, upload documents, Ask Beforest
  - Contributor: Knowledge and upload documents only
- Track search history, feedback, retrieval quality, low-confidence cases, and operational health
- Invite users with admin-created credentials and optional SMTP email delivery

## Tech stack

- Next.js
- React
- TypeScript
- SQLite locally / PostgreSQL through `DATABASE_URL`
- OpenAI API
- OpenAI vector store
- Nodemailer for invite emails

## Environment variables

Create a `.env` file locally. Do not commit it.

```env
DATABASE_URL=

OPENAI_API_KEY=
OPENAI_MODEL=gpt-5-mini
OPENAI_VECTOR_STORE_ID=

DEFAULT_ADMIN_NAME=
DEFAULT_ADMIN_EMAIL=
DEFAULT_ADMIN_PASSWORD=

SMTP_HOST=
SMTP_PORT=
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=

APP_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000

MAX_UPLOAD_SIZE_MB=50
```

Notes:

- `DEFAULT_ADMIN_EMAIL` and `DEFAULT_ADMIN_PASSWORD` are required when the database is empty so the first admin can be created.
- `DATABASE_URL` can point to PostgreSQL for production. If it is not provided, the app uses local SQLite.
- `OPENAI_VECTOR_STORE_ID` should be the single OpenAI vector store used by this application.
- SMTP variables are required only if invite emails should be sent automatically.

## Local development

Install dependencies:

```bash
npm install
```

Run locally:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## Production build

```bash
npm run build
npm run start
```

## Validation

Run lint:

```bash
npm run lint
```

Run production build:

```bash
npm run build
```

## Deployment notes for Coolify

Recommended Coolify settings:

- Build command: `npm run build`
- Start command: `npm run start`
- Port: `3000`
- Add all required environment variables in Coolify
- Use a managed PostgreSQL database and set `DATABASE_URL`
- Set `APP_URL` and `NEXT_PUBLIC_APP_URL` to the public application URL

## Git safety

The `.gitignore` excludes:

- `.env`
- `.env.local`
- `.next`
- `node_modules`
- local SQLite database files under `data/`
- runtime storage files

Before pushing, confirm:

```bash
npm run lint
npm run build
```

## Suggested first production checklist

- Set real `DEFAULT_ADMIN_EMAIL` and `DEFAULT_ADMIN_PASSWORD`
- Set real `OPENAI_API_KEY`
- Set `OPENAI_VECTOR_STORE_ID`
- Set production `DATABASE_URL`
- Set SMTP configuration if invite emails are required
- Confirm user roles in Admin → Users
- Upload and test at least one document
- Ask a test question in Ask Beforest
- Confirm search history, feedback, and retrieval quality data appear in Admin
