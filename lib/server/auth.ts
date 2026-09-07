/**
 * Server-side request authorization for Admin-SDK-backed routes. (Audit C1)
 *
 * The Admin SDK bypasses firestore.rules entirely, so for any route that uses it
 * the route's own code is the ONLY access control. These helpers exist so that
 * authorization always happens before any manuscript data is read.
 *
 * Rule: the caller's identity comes from a verified Firebase ID token and from
 * nowhere else. Owner identity supplied in a request body is never trusted.
 */

import { adminAuth, adminDb } from '@/lib/firebase/admin';

export class AuthError extends Error {
  constructor(
    readonly status: 401 | 403 | 404,
    readonly publicMessage: string
  ) {
    super(publicMessage);
    this.name = 'AuthError';
  }
}

/**
 * Extracts and verifies a Firebase ID token from the Authorization header.
 * Throws AuthError(401) for anything missing, malformed, expired or revoked.
 */
export async function requireVerifiedUser(req: Request): Promise<{ uid: string }> {
  const header = req.headers.get('authorization');

  if (!header || !header.startsWith('Bearer ')) {
    throw new AuthError(401, 'Authentication required');
  }

  const idToken = header.slice('Bearer '.length).trim();
  if (!idToken) {
    throw new AuthError(401, 'Authentication required');
  }

  try {
    // checkRevoked: a signed-out or disabled session must stop working immediately.
    const decoded = await adminAuth.verifyIdToken(idToken, true);
    if (!decoded?.uid) throw new AuthError(401, 'Authentication required');
    return { uid: decoded.uid };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new AuthError(401, 'Invalid or expired credentials');
  }
}

/**
 * Loads a project and asserts the verified caller owns it.
 * This is the only sanctioned way to establish project access on the server.
 *
 * Returns the project data so callers need not re-read it.
 */
export async function requireProjectOwner(
  uid: string,
  projectId: string
): Promise<FirebaseFirestore.DocumentData> {
  if (!projectId || typeof projectId !== 'string' || projectId.includes('/')) {
    throw new AuthError(404, 'Project not found');
  }

  const snap = await adminDb.collection('projects').doc(projectId).get();
  if (!snap.exists) {
    throw new AuthError(404, 'Project not found');
  }

  const data = snap.data() as FirebaseFirestore.DocumentData;
  if (data.ownerId !== uid) {
    // Deliberately distinct from 404 so the owner can tell "wrong account"
    // from "wrong id"; the project's existence is not sensitive.
    throw new AuthError(403, 'You do not have access to this project');
  }

  return data;
}

/** Maps an AuthError (or anything unexpected) onto a safe JSON response. */
export function authErrorResponse(err: unknown): Response {
  if (err instanceof AuthError) {
    return Response.json({ error: err.publicMessage }, { status: err.status });
  }
  return null as never;
}
