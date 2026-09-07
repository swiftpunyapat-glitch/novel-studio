import { NextRequest, NextResponse } from 'next/server';
import { generateDocxDocument } from '@/lib/docx/generator';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectTitle, settings, chapters } = body;

    if (!chapters || !Array.isArray(chapters) || chapters.length === 0) {
      return NextResponse.json({ error: 'No chapters provided for export' }, { status: 400 });
    }

    const buffer = await generateDocxDocument(projectTitle || 'Novel', settings, chapters);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(projectTitle || 'novel')}.docx"`,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Error generating DOCX', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
