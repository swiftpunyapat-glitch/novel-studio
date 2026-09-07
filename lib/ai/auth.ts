import { NextRequest, NextResponse } from 'next/server';

export function validateAiToken(req: NextRequest): NextResponse | null {
  const authHeader = req.headers.get('authorization');
  const expectedToken = process.env.NOVEL_AI_READ_TOKEN || 'demo_novel_ai_secret_token_123';

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json(
      { error: 'Unauthorized: Missing Bearer token' },
      { status: 401 }
    );
  }

  const token = authHeader.split(' ')[1];
  if (token !== expectedToken) {
    return NextResponse.json(
      { error: 'Unauthorized: Invalid AI read token' },
      { status: 401 }
    );
  }

  return null;
}
