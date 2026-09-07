/**
 * Novel Studio MCP — tool definitions and request planning. (Stage 5B)
 *
 * READ-ONLY BY CONSTRUCTION, and that is the point of this file.
 *
 * A tool call never builds a URL from its arguments. It selects one of four
 * hardcoded route templates below, and arguments only ever fill in a path
 * segment — validated, then percent-encoded, so nothing an argument contains
 * can escape into a different path. There is no template for a write endpoint,
 * so there is no argument value that produces one.
 *
 * `assertReadOnly` then re-checks the produced plan against that same fixed
 * set, and `tests/unit/mcp-read-only.test.ts` asserts it over every tool. Adding a
 * mutating tool would require defeating all three deliberately.
 *
 * Pure: no network, no environment, no filesystem. `client.mjs` performs the
 * request this module describes.
 */

/**
 * @typedef {Object} RequestPlan
 * @property {'GET' | 'POST'} method
 * @property {string} path      Path only, always beginning with /api/ai/
 * @property {unknown} [body]   JSON body, POST only
 */

/** Raised for bad tool input. Reported to the model, never to the server. */
export class ToolInputError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'ToolInputError';
  }
}

/**
 * The only paths this server may ever request.
 *
 * `POST` appears once, for search, which carries its query in a body and
 * writes nothing. Every other route is a GET.
 */
const ALLOWED_ROUTES = [
  { method: 'GET', pattern: /^\/api\/ai\/projects$/ },
  { method: 'GET', pattern: /^\/api\/ai\/projects\/[^/]+\/structure$/ },
  { method: 'GET', pattern: /^\/api\/ai\/projects\/[^/]+\/chapters\/[^/]+$/ },
  { method: 'POST', pattern: /^\/api\/ai\/projects\/[^/]+\/search$/ },
];

/** Last line of defence: a plan that is not on the list never leaves. */
export function assertReadOnly(/** @type {RequestPlan} */ plan) {
  const allowed = ALLOWED_ROUTES.some(
    (route) => route.method === plan.method && route.pattern.test(plan.path)
  );
  if (!allowed) {
    throw new Error(
      `Refusing to issue ${plan.method} ${plan.path}: not a known read-only route.`
    );
  }
  return plan;
}

const MAX_ID_LENGTH = 200;
const MAX_QUERY_LENGTH = 200;

/**
 * Validates a value used as a single path segment.
 * @param {unknown} value
 * @param {string} label
 * @returns {string}
 */
function assertId(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ToolInputError(`${label} is required and must be a string.`);
  }
  const id = value.trim();
  if (id.length > MAX_ID_LENGTH) {
    throw new ToolInputError(`${label} is too long.`);
  }
  // Encoding below already neutralises these; rejecting them outright means a
  // caller gets a clear error instead of a confusing 404.
  if (id.includes('/') || id === '.' || id === '..') {
    throw new ToolInputError(`${label} is not a valid id.`);
  }
  return id;
}

/** @param {unknown} value */
function optionalPositiveInt(value, label, max) {
  if (value === undefined || value === null) return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 1) {
    throw new ToolInputError(`${label} must be a positive number.`);
  }
  return Math.min(Math.floor(n), max);
}

const seg = encodeURIComponent;

/**
 * MCP tool annotations, identical for all four tools because all four are the
 * same kind of operation: a read.
 *
 * These are ADVISORY METADATA. The MCP specification is explicit that a client
 * must not treat annotations as a guarantee from an untrusted server, and this
 * server does not ask it to: the read-only property is enforced structurally by
 * the route templates and `assertReadOnly` above, and those remain the
 * authority. The annotations exist so a client can present these tools sensibly
 * — auto-approving a read, say — without having to infer intent from a name.
 *
 *   readOnlyHint    the tool does not modify its environment
 *   destructiveHint nothing is removed or overwritten
 *   idempotentHint  repeating a call has no additional effect
 *   openWorldHint   the world is one Novel Studio instance, not the internet
 */
const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

/**
 * The four tools, exactly as advertised over MCP.
 *
 * Descriptions are written for the model: they say what the tool reads, and
 * they say plainly that nothing can be changed through this server, so an agent
 * does not go looking for a save or publish tool that does not exist.
 */
export const TOOLS = [
  {
    name: 'novel_list_projects',
    description:
      'List the manuscripts (projects) available to read. Returns id, title, ' +
      'slug, description and publication state for each. Read-only. Start here ' +
      'to obtain a projectId for the other tools.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    annotations: { ...READ_ONLY_ANNOTATIONS },
  },
  {
    name: 'novel_get_structure',
    description:
      'Read the outline of one manuscript: its volumes, and the chapters in ' +
      'each with title, chapter number, section type (prologue/chapter/' +
      'epilogue), scene date and location, and word count. Metadata only — no ' +
      'prose. Read-only. Use novel_get_chapter_text to read a chapter.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project id from novel_list_projects.',
        },
      },
      required: ['projectId'],
      additionalProperties: false,
    },
    annotations: { ...READ_ONLY_ANNOTATIONS },
  },
  {
    name: 'novel_get_chapter_text',
    description:
      'Read the full plain text of one chapter, as it currently stands (its ' +
      'active draft variant). Returns the prose plus the chapter metadata. ' +
      'Read-only: this cannot edit, save or publish anything.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project id from novel_list_projects.',
        },
        chapterId: {
          type: 'string',
          description: 'Chapter id from novel_get_structure.',
        },
        maxChars: {
          type: 'number',
          description:
            'Optional cap on returned characters. Omit to read the whole ' +
            'chapter; truncation is reported explicitly when it happens.',
          minimum: 1,
        },
      },
      required: ['projectId', 'chapterId'],
      additionalProperties: false,
    },
    annotations: { ...READ_ONLY_ANNOTATIONS },
  },
  {
    name: 'novel_search_manuscript',
    description:
      'Search the manuscript for a literal substring, across the current text ' +
      'of every chapter. Returns matches with surrounding context, the chapter ' +
      'and volume they occur in, and their position. Case-insensitive, not a ' +
      'regular expression. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project id from novel_list_projects.',
        },
        query: {
          type: 'string',
          description: 'Literal text to find. Thai and English both work.',
          minLength: 1,
          maxLength: MAX_QUERY_LENGTH,
        },
        limit: {
          type: 'number',
          description: 'Maximum matches to return (default 20, maximum 100).',
          minimum: 1,
          maximum: 100,
        },
      },
      required: ['projectId', 'query'],
      additionalProperties: false,
    },
    annotations: { ...READ_ONLY_ANNOTATIONS },
  },
];

export const TOOL_NAMES = TOOLS.map((tool) => tool.name);

/**
 * Turns a tool call into the single request it is allowed to make.
 *
 * @param {string} toolName
 * @param {Record<string, unknown>} args
 * @returns {RequestPlan}
 */
export function planRequest(toolName, args = {}) {
  switch (toolName) {
    case 'novel_list_projects':
      return assertReadOnly({ method: 'GET', path: '/api/ai/projects' });

    case 'novel_get_structure': {
      const projectId = assertId(args.projectId, 'projectId');
      return assertReadOnly({
        method: 'GET',
        path: `/api/ai/projects/${seg(projectId)}/structure`,
      });
    }

    case 'novel_get_chapter_text': {
      const projectId = assertId(args.projectId, 'projectId');
      const chapterId = assertId(args.chapterId, 'chapterId');
      return assertReadOnly({
        method: 'GET',
        path: `/api/ai/projects/${seg(projectId)}/chapters/${seg(chapterId)}`,
      });
    }

    case 'novel_search_manuscript': {
      const projectId = assertId(args.projectId, 'projectId');
      const query = typeof args.query === 'string' ? args.query.trim() : '';
      if (!query) {
        throw new ToolInputError('query is required and must be a non-empty string.');
      }
      if (query.length > MAX_QUERY_LENGTH) {
        throw new ToolInputError(
          `query is too long (maximum ${MAX_QUERY_LENGTH} characters).`
        );
      }
      const limit = optionalPositiveInt(args.limit, 'limit', 100);

      return assertReadOnly({
        method: 'POST',
        path: `/api/ai/projects/${seg(projectId)}/search`,
        body: limit === undefined ? { query } : { query, limit },
      });
    }

    default:
      throw new ToolInputError(`Unknown tool: ${toolName}`);
  }
}

/**
 * Shapes a response for the model.
 *
 * Chapter prose is returned as its own text block rather than embedded in JSON:
 * a whole chapter of Thai escaped into a JSON string is unreadable and wastes
 * a great deal of context on backslashes.
 *
 * @param {string} toolName
 * @param {Record<string, unknown>} args
 * @param {any} data
 * @returns {Array<{ type: 'text', text: string }>}
 */
export function formatToolResult(toolName, args, data) {
  if (toolName !== 'novel_get_chapter_text') {
    return [{ type: 'text', text: JSON.stringify(data, null, 2) }];
  }

  const { plainText, ...metadata } = data ?? {};
  const full = typeof plainText === 'string' ? plainText : '';
  const maxChars = optionalPositiveInt(args.maxChars, 'maxChars', Number.MAX_SAFE_INTEGER);

  const truncated = maxChars !== undefined && full.length > maxChars;
  const text = truncated ? full.slice(0, maxChars) : full;

  return [
    {
      type: 'text',
      text: JSON.stringify(
        {
          ...metadata,
          returnedCharacters: text.length,
          truncated,
          ...(truncated
            ? { truncationNote: `Showing the first ${maxChars} of ${full.length} characters.` }
            : {}),
        },
        null,
        2
      ),
    },
    { type: 'text', text },
  ];
}
