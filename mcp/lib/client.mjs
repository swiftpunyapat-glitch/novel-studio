/**
 * Novel Studio MCP — HTTP client for the read-only AI API. (Stage 5B)
 *
 * The token lives in this process's environment and nowhere else. It is read
 * once, sent as a bearer header, and deliberately never returned, logged or
 * embedded in an error message — `scrubSecrets` strips it from anything on its
 * way out, because a failing request is exactly when a stack trace or a
 * verbose fetch error is most likely to carry it.
 *
 * Nothing here is written back to Novel Studio: the only requests it can make
 * are the ones `tools.mjs` plans, and that module cannot describe a write.
 */

import { assertReadOnly } from './tools.mjs';

const DEFAULT_BASE_URL = 'http://localhost:3000';
const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_TOKEN_LENGTH = 16;

/** A request failed in a way worth reporting to the model verbatim. */
export class ApiError extends Error {
  /** @param {string} message @param {number} [status] */
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * Reads configuration from the environment.
 *
 * Fails closed, matching the server: an MCP server with no token would
 * otherwise start happily and produce a wall of 401s that look like a Novel
 * Studio fault rather than a missing setting.
 *
 * @param {Record<string, string | undefined>} env
 */
export function readConfig(env) {
  const token = (env.NOVEL_AI_READ_TOKEN ?? '').trim();
  if (!token) {
    throw new Error(
      'NOVEL_AI_READ_TOKEN is not set. Put it in this MCP server\'s environment ' +
        '(the "env" block of your MCP client config) — never in the web app\'s ' +
        'client-side configuration.'
    );
  }
  if (token.length < MIN_TOKEN_LENGTH) {
    throw new Error(
      `NOVEL_AI_READ_TOKEN is shorter than ${MIN_TOKEN_LENGTH} characters; ` +
        'the server refuses tokens that short. Generate one with: openssl rand -hex 32'
    );
  }

  const rawBase = (env.NOVEL_STUDIO_BASE_URL ?? DEFAULT_BASE_URL).trim();
  let baseUrl;
  try {
    baseUrl = new URL(rawBase);
  } catch {
    throw new Error(`NOVEL_STUDIO_BASE_URL is not a valid URL: ${rawBase}`);
  }
  if (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') {
    throw new Error('NOVEL_STUDIO_BASE_URL must be an http or https URL.');
  }

  const timeoutMs = Number(env.NOVEL_MCP_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);

  return {
    token,
    baseUrl: baseUrl.origin,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
  };
}

/**
 * Removes the token from a string before it can reach a log or a model.
 *
 * @param {string} text
 * @param {string} token
 */
export function scrubSecrets(text, token) {
  if (!token) return text;
  return text.split(token).join('[redacted]');
}

/**
 * Turns an HTTP status into something a model can act on.
 *
 * The API's own error bodies are already generic by design, so these say what
 * the *operator* should check without inventing detail about the server.
 *
 * @param {number} status
 */
function messageForStatus(status) {
  if (status === 401) {
    return 'Novel Studio rejected the read token (401). Check NOVEL_AI_READ_TOKEN in this MCP server\'s environment matches the one on the server.';
  }
  if (status === 404) {
    return 'Not found (404). The project or chapter does not exist, or it belongs to a different owner than NOVEL_OWNER_UID on the server.';
  }
  if (status === 400) {
    return 'Novel Studio rejected the request (400).';
  }
  if (status === 503) {
    return 'The Novel Studio AI API is not configured (503): NOVEL_AI_READ_TOKEN or NOVEL_OWNER_UID is missing on the server.';
  }
  return `Novel Studio returned HTTP ${status}.`;
}

/**
 * Executes one planned request.
 *
 * @param {{ token: string, baseUrl: string, timeoutMs: number }} config
 * @param {import('./tools.mjs').RequestPlan} plan
 */
export async function performRequest(config, plan) {
  // Re-checked here as well as at planning time: this is the last point before
  // a request actually leaves the process.
  assertReadOnly(plan);

  const url = `${config.baseUrl}${plan.path}`;

  /** @type {Record<string, string>} */
  const headers = {
    Authorization: `Bearer ${config.token}`,
    Accept: 'application/json',
  };
  if (plan.body !== undefined) headers['Content-Type'] = 'application/json';

  let response;
  try {
    response = await fetch(url, {
      method: plan.method,
      headers,
      body: plan.body === undefined ? undefined : JSON.stringify(plan.body),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ApiError(
      scrubSecrets(
        `Could not reach Novel Studio at ${config.baseUrl}: ${reason}. ` +
          'Is the app running, and is NOVEL_STUDIO_BASE_URL correct?',
        config.token
      )
    );
  }

  if (!response.ok) {
    throw new ApiError(messageForStatus(response.status), response.status);
  }

  try {
    return await response.json();
  } catch {
    throw new ApiError('Novel Studio returned a response that was not JSON.');
  }
}
