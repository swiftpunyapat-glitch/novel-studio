# Novel Studio — Master Technical Architecture & Implementation Plan

> **Author**: Senior Software Architect  
> **Target Executor**: Claude Code (Autonomous Coding Agent)  
> **Status**: Approved — Ready for Phase 1 Execution

---

## Executive Summary & Workspace Status

- **Workspace**: `c:\Users\art_b\Desktop\AI Councils\Novel Editor`
- **Stack**: Next.js (App Router), TypeScript, Tailwind CSS, Tiptap / ProseMirror, Firebase (Auth, Firestore, Storage, Admin SDK), `docx` (OOXML engine).
- **Core Constraints**:
  - Desktop-first A5 writing canvas (148 x 210 mm)
  - Default body font: Sarabun 16pt, Left-aligned, 0.5cm first-line indent, 0pt before/after, Multiple 1.08 line spacing
  - Private drafts strictly decoupled from public reader snapshots
  - AI API is server-side, read-only, authenticated via `NOVEL_AI_READ_TOKEN`
  - Dark Mode affects editor appearance only, NEVER alters manuscript formatting or DOCX exports
  - No bloated office features or simulated virtual browser pagination in V1

---

## A. Architecture Review Summary

1. **Shallow Firestore Chapter Structure**: We intentionally flatten chapter subcollections to `projects/{projectId}/chapters/{chapterId}` (with `volumeId: string` and `order: number`) instead of 6-level deep nesting (`projects/.../volumes/.../chapters/...`). This makes moving chapters between volumes an atomic single-field update without destroying child revision subcollections.
2. **Snapshot-Only Publishing**: `/read/...` reads exclusively from `publicProjects/{projectSlug}`. Public users cannot query drafts, revisions, notes, or character references.
3. **In-Memory Client Search**: Full-text project search runs over client-cached plain-text chapters in memory (< 3ms for a 100k-word novel) avoiding expensive third-party search subscriptions for single-author V1.
4. **Exact OpenXML Line Spacing**: Spacing `Multiple 1.08` is mapped in DOCX using formula `Math.round(240 * 1.08) = 259` with `LineRuleType.AUTO`.

---

## B. Firestore Schema

### Private Collections
- `users/{uid}`: Profile
- `users/{uid}/preferences/editor`: Appearance theme, view scale
- `projects/{projectId}`: Document preferences (A5, margins, Sarabun 16pt, 1.08 line spacing)
- `projects/{projectId}/volumes/{volumeId}`: Volume structure
- `projects/{projectId}/chapters/{chapterId}`: Chapter metadata (`volumeId`, `order`, `title`, `activeVariantId`)
- `projects/{projectId}/chapters/{chapterId}/variants/{variantId}`: Working draft (Tiptap JSON content, plainText, wordCount, status: `draft` | `candidate` | `archived`)
- `projects/{projectId}/chapters/{chapterId}/variants/{variantId}/revisions/{revisionId}`: Immutable point-in-time snapshot
- `projects/{projectId}/characters/{characterId}`: Character dossier & private writer notes
- `projects/{projectId}/characters/{characterId}/references/{referenceId}`: Firebase Storage image metadata
- `projects/{projectId}/publications/{publicationId}`: Publishing audit trail

### Public Collections (Read-Only)
- `publicProjects/{projectSlug}`: Published metadata & reading settings
- `publicProjects/{projectSlug}/volumes/{volumeId}`: Public volume TOC
- `publicProjects/{projectSlug}/chapters/{chapterId}`: Pre-rendered sanitized HTML snapshot & clean plain text

---

## C. Claude Code Sequential Execution Plan

### Phase 1: Environment & Foundation
- [ ] 1. Initialize Next.js 14 App Router project in the root directory with TypeScript and Tailwind CSS.
- [ ] 2. Create `.env.example` and `.env.local` with Firebase Client, Firebase Admin, and `NOVEL_AI_READ_TOKEN` variables.
- [ ] 3. Install core dependencies: `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-underline`, `@tiptap/extension-text-style`, `@tiptap/extension-font-family`, `@tiptap/extension-text-align`, `docx`, `firebase`, `firebase-admin`, `lucide-react`, `clsx`, `tailwind-merge`, `zod`, `file-saver`.
- [ ] 4. Configure `firestore.rules` and `storage.rules`.
- [ ] 5. Implement `lib/firebase/client.ts` and `lib/firebase/admin.ts`.
- [ ] 6. Implement `lib/firebase/auth.ts` (Auth context, provider, login/logout).
- [ ] 7. Implement Studio Root Layout with dark/light theme switching and responsive desktop shell.
- [ ] **CHECKPOINT 1**: Run `npm run lint` and `npm run build`. Confirm zero errors.

### Phase 2: Data Model & Navigation
- [ ] 8. Implement TypeScript interfaces in `types/` for Project, Volume, Chapter, Variant, Revision, Character.
- [ ] 9. Implement typed Firestore helper CRUD in `lib/firebase/firestore.ts`.
- [ ] 10. Build Projects Dashboard (`/studio`) allowing creation of a novel with default A5 settings.
- [ ] 11. Build Studio Sidebar Navigator with Volume and Chapter creation, renaming, and reordering.
- [ ] **CHECKPOINT 2**: Run `npm run build`. Verify creating a Project, Volume, and Chapter in the browser.

### Phase 3: Manuscript Editor & Formatting Core
- [ ] 12. Create custom Tiptap extensions: `SceneBreak`, `PageBreak`, `LineSpacing`, and `FirstLineIndent`.
- [ ] 13. Build `EditorCanvas` component rendering an A5-proportioned paper surface with Sarabun 16pt font.
- [ ] 14. Build Word-style `FormattingToolbar` (Bold, Italic, Underline, Alignments, Indent, Breaks).
- [ ] 15. Build `ChapterMetadataHeader` for Chapter #, Title, Subtitle, Date, and Location.
- [ ] 16. Implement Find & Replace in-document toolbar with keyboard shortcuts (`Ctrl+F`, `Ctrl+H`).
- [ ] **CHECKPOINT 3**: Run `npm run build`. Verify writing Thai and English prose, applying formatting, and inserting breaks.

### Phase 4: Autosave, Variants & Revisions
- [ ] 17. Implement debounced autosave (1.5s) to Firestore draft variant with status indicator.
- [ ] 18. Implement IndexedDB local mirror and `beforeunload` unsaved protection.
- [ ] 19. Build `VariantSwitcher` allowing creation and selection of Draft A, Draft B, and Candidate tagging.
- [ ] 20. Build `RevisionHistoryDrawer` to take manual snapshots and restore older revisions.
- [ ] **CHECKPOINT 4**: Test offline behavior (toggle network offline in DevTools). Verify zero data loss and successful recovery.

### Phase 5: DOCX Export
- [ ] 21. Implement `lib/docx/generator.ts` mapping Tiptap AST to `docx` elements.
- [ ] 22. Enforce exact A5 dimensions, 20mm margins, Sarabun font, 0.5cm indent, and line spacing `line: 259`.
- [ ] 23. Implement `/api/export/docx` route handler and client export dialog (Chapter, Volume, Manuscript).
- [ ] **CHECKPOINT 5**: Export a sample chapter to `.docx`. Verify file opens cleanly in Word/Docs with exact A5 layout.

### Phase 6: Character Dossier & Storage
- [ ] 24. Build Characters page (`/studio/projects/[id]/characters`) with character CRUD.
- [ ] 25. Implement Firebase Storage reference image upload, primary thumbnail toggle, and captions.
- [ ] **CHECKPOINT 6**: Run `npm run build`. Upload reference image and verify security isolation.

### Phase 7: Publishing & Public Reader
- [ ] 26. Implement atomic publishing Server Action/Route Handler with Firebase Admin SDK batch writes.
- [ ] 27. Build Publishing Manager UI (`/studio/projects/[id]/publish`) with candidate validation.
- [ ] 28. Build Public Reader layout and routes (`/read/[projectSlug]/[volumeSlug]/[chapterSlug]`).
- [ ] 29. Implement reader typography controls (Font size, Light/Sepia/Dark modes, TOC drawer).
- [ ] **CHECKPOINT 7**: Publish Chapter 1. Modify draft. Confirm public reader still shows published snapshot.

### Phase 8: AI Read API & Full-Text Search
- [ ] 30. Implement Bearer token authentication middleware for `/api/ai/*`.
- [ ] 31. Build AI endpoints: `GET /projects`, `GET structure`, `GET chapter`, `GET characters`, `POST search`.
- [ ] 32. Build in-memory Client Project Search worker with volume/chapter snippets.
- [ ] **FINAL CHECKPOINT**: Run full suite: `npm run lint`, `npm run typecheck`, `npm run build`. Test AI API with curl.
