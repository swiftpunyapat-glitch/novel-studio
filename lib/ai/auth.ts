import type { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { aiJson } from '@/lib/ai/serialize';

/**
 * Bearer-token gate for the read-only AI API. (Audit H10)
 *
 * Two repairs:
 *   1. FAIL CLOSED. The previous version fell back to a token hardcoded in this
 *      file, so a deploy with a missing env var was protected by a secret that
 *      is public in the repository. There is no fallback now — if either
 *      variable is absent the API refuses every request.
 *   2. OWNER SCOPING. The token no longer implies access to all data. It
 *      authorizes reads for exactly one uid, `NOVEL_OWNER_UID`, and every route
 *      must filter its queries by the returned uid.
 *
 * V1 is deliberately single-owner: one server-side token, one owner uid. This
 * is not multi-tenant token infrastructure and is not meant to become it
 * without a real credential store.
 */

const MIN_TOKEN_LENGTH = 16;

export interface AiPrincipal {
  /** The single owner whose data this token may read. */
  ownerUid: string;
}

/** Constant-time compare that does not leak length through early return. */
function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) {
    // Still burn a comparison so timing does not distinguish length mismatch.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

const UNAUTHORIZED = { error: 'Unauthorized' } as const;

/**
 * Verifies the request's bearer token and resolves the owner it may read.
 *
 * Returns either a NextResponse to return immediately, or the principal.
 * Callers must use `principal.ownerUid` to scope every query they issue.
 */
export function authenticateAiRequest(
  req: Request
): { response: NextResponse } | { principal: AiPrincipal } {
  const expectedToken = process.env.NOVEL_AI_READ_TOKEN;
  const ownerUid = process.env.NOVEL_OWNER_UID;

  // Fail closed: refuse to serve at all when the secret is not configured.
  if (!expectedToken || expectedToken.length < MIN_TOKEN_LENGTH) {
    console.error(
      'NOVEL_AI_READ_TOKEN is missing or too short; AI API is disabled.'
    );
    return { response: aiJson({ error: 'AI API is not configured' }, 503) };
  }

  if (!ownerUid) {
    console.error('NOVEL_OWNER_UID is not set; AI API is disabled.');
    return { response: aiJson({ error: 'AI API is not configured' }, 503) };
  }

  const header = req.headers.get('authorization');
  if (!header || !header.startsWith('Bearer ')) {
    return { response: aiJson(UNAUTHORIZED, 401) };
  }

  const provided = header.slice('Bearer '.length).trim();
  if (!provided || !tokensMatch(provided, expectedToken)) {
    return { response: aiJson(UNAUTHORIZED, 401) };
  }

  return { principal: { ownerUid } };
}
