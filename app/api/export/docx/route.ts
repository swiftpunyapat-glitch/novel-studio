import { NextResponse } from 'next/server';
import { generateDocxDocument } from '@/lib/docx/generator';
import { AuthError, requireVerifiedUser, requireProjectOwner } from '@/lib/server/auth';
import { UnsupportedNodeError } from '@/lib/editor/manuscript-schema';
import { DEFAULT_DOCUMENT_SETTINGS, type DocumentSettings } from '@/types/project';

export const dynamic = 'force-dynamic';

/**
 * Renders a manuscript to DOCX.
 *
 * The route is a pure transform: content arrives in the request body, read by
 * the client through rule-protected Firestore. It still requires a verified ID
 * token and project ownership, because it was previously an open, CPU- and
 * memory-heavy endpoint (Audit M8) and Stage 3 makes it reachable from the UI.
 */

const MAX_CHAPTERS = 500;

function mergeSettings(raw: unknown): DocumentSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_DOCUMENT_SETTINGS };
  const partial = raw as Partial<DocumentSettings>;
  return {
    ...DEFAULT_DOCUMENT_SETTINGS,
    ...partial,
    margins: { ...DEFAULT_DOCUMENT_SETTINGS.margins, ...(partial.margins ?? {}) },
  };
}

export async function POST(req: Request) {
  try {
    const { uid } = await requireVerifiedUser(req);

    let body: {
      projectId?: unknown;
      projectTitle?: unknown;
      settings?: unknown;
      chapters?: unknown;
    };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Malformed request body' }, { status: 400 });
    }

    if (typeof body.projectId !== 'string' || !body.projectId) {
      return NextResponse.json({ error: 'Missing projectId' }, { status: 400 });
    }

    // Ownership is checked even though content arrives in the body, so this
    // cannot be used as an anonymous rendering service.
    await requireProjectOwner(uid, body.projectId);

    if (!Array.isArray(body.chapters) || body.chapters.length === 0) {
      return NextResponse.json({ error: 'No chapters provided for export' }, { status: 400 });
    }
    if (body.chapters.length > MAX_CHAPTERS) {
      return NextResponse.json(
        { error: `Too many chapters in one export (limit ${MAX_CHAPTERS})` },
        { status: 400 }
      );
    }

    const projectTitle =
      typeof body.projectTitle === 'string' && body.projectTitle.trim()
        ? body.projectTitle
        : 'Novel';

    const buffer = await generateDocxDocument(
      projectTitle,
      mergeSettings(body.settings),
      body.chapters as Parameters<typeof generateDocxDocument>[2]
    );

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        // The client sets the real filename; this is only a fallback.
        'Content-Disposition': `attachment; filename="manuscript.docx"; filename*=UTF-8''${encodeURIComponent(projectTitle)}.docx`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.publicMessage }, { status: err.status });
    }
    if (err instanceof UnsupportedNodeError) {
      // Fail loudly: never hand back a document with content silently removed.
      console.error('DOCX export refused', err);
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    console.error('Error generating DOCX', err);
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }
}
