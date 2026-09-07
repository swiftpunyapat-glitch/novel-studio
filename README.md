# Novel Studio

A dedicated, production-usable novel-writing application for authors, featuring Word-accurate manuscript formatting, distraction-free desktop writing, snapshot-isolated public reading, and token-authenticated read-only AI access.

## Core Features
- **Word-Accurate Manuscript Formatting**: Default A5 paper (148 × 210 mm), Sarabun 16pt, Left-aligned, 0.5 cm first-line indent, Multiple 1.08 line spacing (`line: 259`).
- **Semantic Breaks**: First-class `SceneBreak` and `PageBreak` editor nodes that export cleanly to DOCX.
- **Draft Variants & Revisions**: Work on alternate branches (Draft A, Draft B) and create immutable revision checkpoints.
- **Strict Snapshot Publishing**: Public readers at `/read/[projectSlug]` access pre-rendered, sanitized snapshots with zero risk of draft or note leaks.
- **DOCX Export**: Real OOXML `.docx` files that open natively in Microsoft Word and Google Docs.
- **Character Dossier**: Rich character profiles and private image gallery backed by Firebase Storage.
- **AI Read API**: Token-guarded server-side read-only endpoints (`/api/ai/*`) for Claude, ChatGPT, and MCP servers.

## Tech Stack
- **Framework**: Next.js 14 (App Router) + TypeScript
- **Styling**: Tailwind CSS
- **Rich-Text Engine**: Tiptap / ProseMirror
- **Backend & Auth**: Firebase Auth, Cloud Firestore, Firebase Storage, Firebase Admin SDK
- **Export**: `docx` (npm)
- **Deployment**: Vercel

## Architecture & Implementation Plan
For the complete technical architecture review, Firestore schema, and sequential execution checklist, see `IMPLEMENTATION_PLAN.md`.
