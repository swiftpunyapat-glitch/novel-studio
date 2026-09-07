import { describe, expect, test } from 'vitest';

// The MCP server is plain ESM with no dependencies, so it is imported here
// exactly as Node loads it at runtime.
import {
  TOOLS,
  TOOL_NAMES,
  ToolInputError,
  assertReadOnly,
  formatToolResult,
  planRequest,
} from '../../mcp/lib/tools.mjs';
import {
  JSON_RPC_ERRORS,
  PREFERRED_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  createHandler,
  isNotification,
  isValidRequestId,
  negotiateProtocolVersion,
  splitMessages,
} from '../../mcp/lib/protocol.mjs';
import { readConfig, scrubSecrets } from '../../mcp/lib/client.mjs';

import {
  chapterSummary,
  chapterText,
  projectSummary,
  volumeSummary,
} from '@/lib/ai/serialize';

/**
 * Stage 5 — read-only AI/MCP surface.
 *
 * The property every test here defends is the same one: this server can read a
 * manuscript and cannot change it. That has to hold not because the four tools
 * happen to be reads today, but because nothing in the code can express a
 * write — so the tests go at the mechanism, not at the current tool list.
 */

// ===========================================================================
// Read-only by construction
// ===========================================================================

describe('the MCP surface cannot write', () => {
  test('exposes exactly the four V1 tools', () => {
    expect(TOOL_NAMES).toEqual([
      'novel_list_projects',
      'novel_get_structure',
      'novel_get_chapter_text',
      'novel_search_manuscript',
    ]);
  });

  test('no tool is named for a mutating operation', () => {
    // A blunt check on purpose: it fails the moment someone adds a save tool,
    // whatever else they remember to update.
    const mutating = /create|update|save|write|edit|delete|remove|publish|set_|patch|insert/i;
    for (const name of TOOL_NAMES) {
      expect(name).not.toMatch(mutating);
    }
  });

  test('every tool plans a GET, except search which POSTs a query and writes nothing', () => {
    const plans = [
      planRequest('novel_list_projects', {}),
      planRequest('novel_get_structure', { projectId: 'p1' }),
      planRequest('novel_get_chapter_text', { projectId: 'p1', chapterId: 'c1' }),
      planRequest('novel_search_manuscript', { projectId: 'p1', query: 'x' }),
    ];

    expect(plans.map((p) => p.method)).toEqual(['GET', 'GET', 'GET', 'POST']);
    expect(plans.filter((p) => p.method === 'POST')).toHaveLength(1);
    expect(plans[3].path).toMatch(/\/search$/);
  });

  test('every planned path stays inside the read-only AI namespace', () => {
    for (const name of TOOL_NAMES) {
      const plan = planRequest(name, { projectId: 'p1', chapterId: 'c1', query: 'x' });
      expect(plan.path.startsWith('/api/ai/')).toBe(true);
    }
  });

  test('assertReadOnly refuses anything off the allowlist', () => {
    // The guard, exercised directly: these are the shapes a future mistake
    // would take.
    expect(() => assertReadOnly({ method: 'GET', path: '/api/projects/p1' })).toThrow();
    expect(() =>
      assertReadOnly({ method: 'POST', path: '/api/ai/projects/p1/structure' })
    ).toThrow();
    expect(() =>
      assertReadOnly({ method: 'POST', path: '/api/publishing/publish' })
    ).toThrow();
    // A DELETE cannot even be described, but the guard rejects it regardless.
    expect(() =>
      assertReadOnly({ method: 'DELETE', path: '/api/ai/projects/p1' } as never)
    ).toThrow();
  });

  test('an unknown tool name is refused rather than guessed at', () => {
    expect(() => planRequest('novel_save_chapter', { projectId: 'p1' })).toThrow(
      ToolInputError
    );
  });

  test('tool descriptions tell the model it cannot change anything', () => {
    for (const tool of TOOLS) {
      expect(tool.description.toLowerCase()).toContain('read-only');
    }
  });

  test('every tool carries the read-only MCP annotations', () => {
    for (const tool of TOOLS) {
      expect(tool.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    }
  });

  test('annotations are advisory; the structural guard is what actually holds', () => {
    // Stated as a test so the distinction survives: a client is entitled to
    // ignore an untrusted server's hints, and this server does not rely on
    // them for its read-only property.
    const tampered = { ...TOOLS[0], annotations: { readOnlyHint: false } };
    expect(tampered.annotations.readOnlyHint).toBe(false);
    expect(() => assertReadOnly({ method: 'POST', path: '/api/ai/projects' })).toThrow();
    expect(planRequest('novel_list_projects', {}).method).toBe('GET');
  });
});

// ===========================================================================
// Path safety
// ===========================================================================

describe('ids can never escape their path segment', () => {
  test.each([
    'p1/../../secret',
    'p1/chapters',
    '..',
    '.',
    '',
    '   ',
  ])('rejects %p as a projectId', (projectId) => {
    expect(() => planRequest('novel_get_structure', { projectId })).toThrow(ToolInputError);
  });

  test('rejects a non-string id', () => {
    expect(() => planRequest('novel_get_structure', { projectId: 42 })).toThrow(
      ToolInputError
    );
    expect(() => planRequest('novel_get_structure', {})).toThrow(ToolInputError);
  });

  test('an exotic but legal id is percent-encoded, not interpolated raw', () => {
    const plan = planRequest('novel_get_chapter_text', {
      projectId: 'a b&c',
      chapterId: 'x?y#z',
    });
    expect(plan.path).toBe('/api/ai/projects/a%20b%26c/chapters/x%3Fy%23z');
    // The query and fragment characters cannot start a query string.
    expect(plan.path).not.toContain('?');
    expect(plan.path).not.toContain('#');
  });

  test('an over-long id is refused', () => {
    expect(() =>
      planRequest('novel_get_structure', { projectId: 'a'.repeat(500) })
    ).toThrow(ToolInputError);
  });
});

// ===========================================================================
// Search arguments
// ===========================================================================

describe('search arguments', () => {
  test('an empty query is refused before any request is made', () => {
    expect(() => planRequest('novel_search_manuscript', { projectId: 'p1', query: '  ' })).toThrow(
      ToolInputError
    );
  });

  test('an over-long query is refused, matching the server bound', () => {
    expect(() =>
      planRequest('novel_search_manuscript', { projectId: 'p1', query: 'x'.repeat(201) })
    ).toThrow(ToolInputError);
  });

  test('limit is clamped to the server maximum', () => {
    const plan = planRequest('novel_search_manuscript', {
      projectId: 'p1',
      query: 'x',
      limit: 5000,
    });
    expect((plan.body as { limit: number }).limit).toBe(100);
  });

  test('an omitted limit is left to the server default', () => {
    const plan = planRequest('novel_search_manuscript', { projectId: 'p1', query: 'x' });
    expect(plan.body).toEqual({ query: 'x' });
  });

  test('Thai queries survive intact', () => {
    const plan = planRequest('novel_search_manuscript', {
      projectId: 'p1',
      query: 'ลาดพร้าว',
    });
    expect((plan.body as { query: string }).query).toBe('ลาดพร้าว');
  });
});

// ===========================================================================
// Result shaping
// ===========================================================================

describe('chapter text is returned as prose, not as escaped JSON', () => {
  const chapter = {
    id: 'c1',
    title: 'บทที่ 7',
    plainText: 'เธอหยุดอยู่ตรงนั้น\nแล้วมองย้อนกลับไป',
    wordCount: 6,
  };

  test('metadata and prose arrive as separate blocks', () => {
    const [meta, prose] = formatToolResult('novel_get_chapter_text', {}, chapter);
    expect(JSON.parse(meta.text).title).toBe('บทที่ 7');
    expect(JSON.parse(meta.text).plainText).toBeUndefined();
    // Raw, so newlines and Thai are not spent on backslash escapes.
    expect(prose.text).toBe(chapter.plainText);
  });

  test('the whole chapter is returned when maxChars is omitted', () => {
    const [meta, prose] = formatToolResult('novel_get_chapter_text', {}, chapter);
    expect(prose.text).toHaveLength(chapter.plainText.length);
    expect(JSON.parse(meta.text).truncated).toBe(false);
  });

  test('truncation is applied and declared, never silent', () => {
    const [meta, prose] = formatToolResult('novel_get_chapter_text', { maxChars: 5 }, chapter);
    expect(prose.text).toHaveLength(5);
    const parsed = JSON.parse(meta.text);
    expect(parsed.truncated).toBe(true);
    expect(parsed.truncationNote).toContain(String(chapter.plainText.length));
  });

  test('other tools return a single JSON block', () => {
    const blocks = formatToolResult('novel_list_projects', {}, { projects: [] });
    expect(blocks).toHaveLength(1);
    expect(JSON.parse(blocks[0].text)).toEqual({ projects: [] });
  });
});

// ===========================================================================
// Protocol
// ===========================================================================

describe('MCP protocol handling', () => {
  interface RpcResponse {
    result?: Record<string, never> & Record<string, unknown>;
    error?: { code: number; message: string };
  }

  const handler = () =>
    createHandler({
      serverInfo: { name: 'novel-studio', version: '1.0.0' },
      tools: TOOLS,
      callTool: async (name: string) => [{ type: 'text' as const, text: `called ${name}` }],
    });

  /** Asserts a response was produced at all, then narrows it for inspection. */
  async function call(
    message: unknown,
    handle = handler()
  ): Promise<{ result: any; error: { code: number; message: string } }> {
    const res = await handle(message as never);
    expect(res).not.toBeNull();
    return res as never;
  }

  test('initialize echoes a protocol version we speak', async () => {
    const res = await call({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05' },
    });
    expect(res.result.protocolVersion).toBe('2024-11-05');
    expect(res.result.capabilities).toEqual({ tools: {} });
  });

  test('an unknown protocol version falls back to ours rather than failing', () => {
    expect(negotiateProtocolVersion('1999-01-01')).toBe(PREFERRED_PROTOCOL_VERSION);
    expect(negotiateProtocolVersion(undefined)).toBe(PREFERRED_PROTOCOL_VERSION);
    expect(negotiateProtocolVersion(42)).toBe(PREFERRED_PROTOCOL_VERSION);
    expect(SUPPORTED_PROTOCOL_VERSIONS).toContain(PREFERRED_PROTOCOL_VERSION);
  });

  test('supports the 2025-era revisions, newest preferred', () => {
    expect(SUPPORTED_PROTOCOL_VERSIONS).toEqual([
      '2025-11-25',
      '2025-06-18',
      '2025-03-26',
      '2024-11-05',
    ]);
    expect(PREFERRED_PROTOCOL_VERSION).toBe('2025-11-25');
  });

  test('every supported version is echoed back when a client asks for it', async () => {
    for (const version of SUPPORTED_PROTOCOL_VERSIONS) {
      const res = await call({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: version },
      });
      expect(res.result.protocolVersion).toBe(version);
    }
  });

  test('does NOT claim the modern 2026-07-28 era', async () => {
    // That revision brings server/discover and per-request metadata, none of
    // which this server implements. Advertising it would send a client looking
    // for a discovery method that answers -32601.
    expect(SUPPORTED_PROTOCOL_VERSIONS).not.toContain('2026-07-28');
    expect(negotiateProtocolVersion('2026-07-28')).toBe(PREFERRED_PROTOCOL_VERSION);

    const res = await call({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2026-07-28' },
    });
    expect(res.result.protocolVersion).toBe('2025-11-25');
  });

  test('no advertised version is from a later era than 2025', () => {
    for (const version of SUPPORTED_PROTOCOL_VERSIONS) {
      expect(version < '2026-01-01').toBe(true);
    }
  });

  test('initialize instructions state the read-only limit', async () => {
    const res = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    expect(res.result.instructions.toLowerCase()).toContain('read-only');
  });

  test('tools/list advertises only the four tools', async () => {
    const res = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(res.result.tools.map((t: { name: string }) => t.name)).toEqual(TOOL_NAMES);
  });

  test('a notification is never answered', async () => {
    // Replying to one is the classic way to wedge a stdio client.
    expect(
      await handler()({ jsonrpc: '2.0', method: 'notifications/initialized' })
    ).toBeNull();
    expect(await handler()({ jsonrpc: '2.0', method: 'notifications/cancelled' })).toBeNull();
  });

  test('an unknown method is a JSON-RPC error, not a crash', async () => {
    const res = await call({ jsonrpc: '2.0', id: 3, method: 'resources/list' });
    expect(res.error.code).toBe(-32601);
  });

  test('a failing tool reports isError so the model can read why', async () => {
    const handle = createHandler({
      serverInfo: { name: 'x', version: '1' },
      tools: TOOLS,
      callTool: async () => {
        throw new Error('Not found (404).');
      },
    });
    const res = await call(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'novel_get_structure', arguments: { projectId: 'p1' } },
      },
      handle
    );
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain('404');
  });

  test('a successful tool call carries its content', async () => {
    const res = await call({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'novel_list_projects', arguments: {} },
    });
    expect(res.result.isError).toBe(false);
    expect(res.result.content[0].text).toBe('called novel_list_projects');
  });
});

// ===========================================================================
// JSON-RPC validity
// ===========================================================================

describe('JSON-RPC request validation', () => {
  const handle = createHandler({
    serverInfo: { name: 'novel-studio', version: '1.0.0' },
    tools: TOOLS,
    callTool: async () => [{ type: 'text' as const, text: 'ok' }],
  });

  const send = (message: unknown) => handle(message as never);

  describe('what counts as a notification', () => {
    test('a notification has NO id property — not an id of null', () => {
      expect(isNotification({ jsonrpc: '2.0', method: 'ping' })).toBe(true);
      expect(isNotification({ jsonrpc: '2.0', method: 'ping', id: null })).toBe(false);
      expect(isNotification({ jsonrpc: '2.0', method: 'ping', id: 1 })).toBe(false);
      // Present but explicitly undefined is still a property, so still a request.
      expect(isNotification({ jsonrpc: '2.0', method: 'ping', id: undefined })).toBe(false);
    });

    test.each([
      'initialize',
      'ping',
      'tools/list',
      'tools/call',
      'notifications/initialized',
      'notifications/cancelled',
      'resources/list',
      'completely/unknown',
    ])('%s without an id produces no response at all', async (method) => {
      expect(await send({ jsonrpc: '2.0', method })).toBeNull();
    });

    test('tools/call without an id is silent even though it would have run', async () => {
      const calls: string[] = [];
      const recording = createHandler({
        serverInfo: { name: 'x', version: '1' },
        tools: TOOLS,
        callTool: async (name: string) => {
          calls.push(name);
          return [{ type: 'text' as const, text: 'ok' }];
        },
      });
      const res = await recording({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: 'novel_list_projects', arguments: {} },
      } as never);

      expect(res).toBeNull();
      expect(calls).toEqual([]);
    });

    test('a malformed notification is still silent', async () => {
      // No response is permitted, so a bad version or a missing method cannot
      // be reported — silence is the only correct answer.
      expect(await send({ jsonrpc: '1.0', method: 'ping' })).toBeNull();
      expect(await send({ jsonrpc: '2.0' })).toBeNull();
      expect(await send({ method: 'ping' })).toBeNull();
    });
  });

  describe('request ids', () => {
    test('accepts a string or a finite number', () => {
      expect(isValidRequestId('abc')).toBe(true);
      expect(isValidRequestId(0)).toBe(true);
      expect(isValidRequestId(-7)).toBe(true);
      expect(isValidRequestId(1.5)).toBe(true);
    });

    test('rejects null, booleans, objects and arrays', () => {
      expect(isValidRequestId(null)).toBe(false);
      expect(isValidRequestId(undefined)).toBe(false);
      expect(isValidRequestId(true)).toBe(false);
      expect(isValidRequestId({})).toBe(false);
      expect(isValidRequestId([])).toBe(false);
      expect(isValidRequestId(NaN)).toBe(false);
    });

    test('id: null is an invalid request, not a notification', async () => {
      // JSON-RPC 2.0 permits a null id; MCP does not, and treating it as valid
      // would make the answer indistinguishable from "id unknown".
      const res = await send({ jsonrpc: '2.0', id: null, method: 'tools/list' });
      expect(res).not.toBeNull();
      expect((res as { error: { code: number } }).error.code).toBe(
        JSON_RPC_ERRORS.invalidRequest
      );
    });

    test.each([true, {}, [], 1.5e400])(
      'an id of %p that cannot be echoed is answered with a null id',
      async (id) => {
        const res = (await send({ jsonrpc: '2.0', id, method: 'tools/list' })) as {
          id: unknown;
          error: { code: number };
        };
        // Per JSON-RPC: when the id cannot be determined, report null.
        expect(res.error.code).toBe(JSON_RPC_ERRORS.invalidRequest);
        expect(res.id).toBeNull();
      }
    );

    test('a valid id is echoed back on both success and error', async () => {
      const ok = (await send({ jsonrpc: '2.0', id: 'req-1', method: 'tools/list' })) as {
        id: string;
      };
      expect(ok.id).toBe('req-1');

      const bad = (await send({ jsonrpc: '2.0', id: 99, method: 'nope/nope' })) as {
        id: number;
      };
      expect(bad.id).toBe(99);
    });
  });

  describe('the jsonrpc field', () => {
    test.each([undefined, '1.0', '2', 2.0, null])(
      'a version of %p is an invalid request',
      async (jsonrpc) => {
        const res = (await send({ jsonrpc, id: 1, method: 'tools/list' })) as {
          error: { code: number };
        };
        expect(res.error.code).toBe(JSON_RPC_ERRORS.invalidRequest);
      }
    );

    test('exactly "2.0" is accepted', async () => {
      const res = (await send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })) as {
        result: { tools: unknown[] };
      };
      expect(res.result.tools).toHaveLength(4);
    });

    test('every response declares jsonrpc 2.0 itself', async () => {
      const ok = (await send({ jsonrpc: '2.0', id: 1, method: 'ping' })) as {
        jsonrpc: string;
      };
      const err = (await send({ jsonrpc: '2.0', id: 2, method: 'nope' })) as {
        jsonrpc: string;
      };
      expect(ok.jsonrpc).toBe('2.0');
      expect(err.jsonrpc).toBe('2.0');
    });
  });

  describe('messages that are not request objects', () => {
    test.each([null, undefined, 'a string', 42, true, []])(
      '%p is answered as an invalid request with a null id',
      async (message) => {
        const res = (await send(message)) as { id: unknown; error: { code: number } };
        expect(res.error.code).toBe(JSON_RPC_ERRORS.invalidRequest);
        expect(res.id).toBeNull();
      }
    );
  });

  describe('a well-formed request still reaches its method', () => {
    test('missing method on a request is reported', async () => {
      const res = (await send({ jsonrpc: '2.0', id: 1 })) as { error: { code: number } };
      expect(res.error.code).toBe(JSON_RPC_ERRORS.invalidRequest);
    });

    test('tools/call without a tool name is invalid params, not invalid request', async () => {
      const res = (await send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {},
      })) as { error: { code: number } };
      expect(res.error.code).toBe(JSON_RPC_ERRORS.invalidParams);
    });

    test('ping answers an empty result', async () => {
      const res = (await send({ jsonrpc: '2.0', id: 7, method: 'ping' })) as {
        result: unknown;
      };
      expect(res.result).toEqual({});
    });
  });
});

describe('stdio framing', () => {
  test('splits complete lines and keeps the partial one', () => {
    const { lines, rest } = splitMessages('{"a":1}\n{"b":2}\n{"c":');
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
    expect(rest).toBe('{"c":');
  });

  test('a message split across reads is reassembled, not lost', () => {
    const first = splitMessages('{"long":"');
    expect(first.lines).toEqual([]);
    const second = splitMessages(`${first.rest}value"}\n`);
    expect(second.lines).toEqual(['{"long":"value"}']);
  });

  test('blank lines are ignored', () => {
    expect(splitMessages('\n\n{"a":1}\n').lines).toEqual(['{"a":1}']);
  });
});

// ===========================================================================
// The secret
// ===========================================================================

describe('the read token stays in this process', () => {
  const TOKEN = 'a-real-token-value-32-chars-long';

  test('configuration fails closed when the token is absent', () => {
    expect(() => readConfig({})).toThrow(/NOVEL_AI_READ_TOKEN/);
  });

  test('a token below the server minimum is refused up front', () => {
    expect(() => readConfig({ NOVEL_AI_READ_TOKEN: 'short' })).toThrow(/16 characters/);
  });

  test('the base URL must be http or https', () => {
    expect(() =>
      readConfig({ NOVEL_AI_READ_TOKEN: TOKEN, NOVEL_STUDIO_BASE_URL: 'file:///etc/passwd' })
    ).toThrow(/http or https/);
    expect(() =>
      readConfig({ NOVEL_AI_READ_TOKEN: TOKEN, NOVEL_STUDIO_BASE_URL: 'not a url' })
    ).toThrow(/valid URL/);
  });

  test('only the origin of the base URL is kept, so a path cannot be smuggled in', () => {
    const config = readConfig({
      NOVEL_AI_READ_TOKEN: TOKEN,
      NOVEL_STUDIO_BASE_URL: 'https://example.com/some/prefix?x=1',
    });
    expect(config.baseUrl).toBe('https://example.com');
  });

  test('the token is scrubbed from anything on its way out', () => {
    // Failing requests are exactly when a verbose error is most likely to
    // carry the credential into a log or a model's context.
    const leaked = `fetch failed for https://x/?token=${TOKEN} (${TOKEN})`;
    const scrubbed = scrubSecrets(leaked, TOKEN);
    expect(scrubbed).not.toContain(TOKEN);
    expect(scrubbed).toContain('[redacted]');
  });

  test('no tool schema asks for or returns a credential', () => {
    const text = JSON.stringify(TOOLS).toLowerCase();
    for (const word of ['token', 'secret', 'password', 'credential', 'apikey']) {
      expect(text).not.toContain(word);
    }
  });
});

// ===========================================================================
// Response allowlists (Stage 5A)
// ===========================================================================

describe('AI API responses are allowlists, not document dumps', () => {
  test('a project returns named fields only', () => {
    const out = projectSummary('p1', {
      title: 'Novel',
      slug: 'novel',
      description: 'd',
      isPublished: true,
      createdAt: 1,
      updatedAt: 2,
      ownerId: 'uid_secret',
      internalNote: 'should never leave',
    });

    expect(Object.keys(out).sort()).toEqual([
      'createdAt',
      'description',
      'id',
      'isPublished',
      'slug',
      'title',
      'updatedAt',
    ]);
    expect(JSON.stringify(out)).not.toContain('uid_secret');
    expect(JSON.stringify(out)).not.toContain('should never leave');
  });

  test('a volume returns named fields only', () => {
    const out = volumeSummary('v1', { title: 'Volume 1', volumeNumber: 1, order: 1, secret: 'x' });
    expect(Object.keys(out).sort()).toEqual(['id', 'order', 'title', 'volumeNumber']);
  });

  test('a chapter summary hides internal plumbing', () => {
    const out = chapterSummary('c1', {
      title: 'Chapter 7',
      volumeId: 'v1',
      chapterNumber: 7,
      order: 1,
      totalWordCount: 100,
      updatedAt: 5,
      activeVariantId: 'variant_internal',
      publishedRevisionId: 'revision_internal',
      unexpectedFutureField: 'leaked',
    });

    const json = JSON.stringify(out);
    expect(json).not.toContain('variant_internal');
    expect(json).not.toContain('revision_internal');
    expect(json).not.toContain('leaked');
    expect(out.wordCount).toBe(100);
  });

  test('an unknown field added to a document tomorrow is not published today', () => {
    // The whole reason these are hand-written rather than a spread.
    const out = chapterSummary('c1', { title: 'x', somethingAddedLater: 'private' });
    expect(JSON.stringify(out)).not.toContain('private');
  });

  test('a missing chapterType falls back to chapter, and prologue keeps a null number', () => {
    expect(chapterSummary('c1', { title: 'x' }).chapterType).toBe('chapter');
    const prologue = chapterSummary('c2', { title: 'Prologue', chapterType: 'prologue' });
    expect(prologue.chapterType).toBe('prologue');
    expect(prologue.chapterNumber).toBeNull();
  });

  test('a bogus chapterType is not passed through', () => {
    expect(chapterSummary('c1', { chapterType: 'appendix' }).chapterType).toBe('chapter');
  });

  test('optional metadata is omitted from the response rather than sent as ""', () => {
    // Asserted on the serialized body, which is the actual contract: an
    // `undefined` field is absent over the wire.
    const blank = JSON.parse(JSON.stringify(chapterSummary('c1', { title: 'x', subtitle: '   ' })));
    expect('subtitle' in blank).toBe(false);
    expect(chapterSummary('c2', { subtitle: 'A beginning' }).subtitle).toBe('A beginning');
  });

  test('chapter text exposes prose but never the manuscript JSON', () => {
    const out = chapterText(
      'p1',
      'c1',
      { title: 'Chapter 7', activeVariantId: 'v_internal' },
      {
        name: 'Main',
        plainText: 'เธอหยุดอยู่ตรงนั้น',
        wordCount: 3,
        characterCount: 18,
        content: { type: 'doc', content: [{ type: 'paragraph' }] },
        lastEditedBySessionId: 'session_internal',
      }
    );

    expect(out.plainText).toBe('เธอหยุดอยู่ตรงนั้น');
    const json = JSON.stringify(out);
    // The Tiptap tree is the editor's private representation.
    expect(json).not.toContain('"type":"doc"');
    expect(json).not.toContain('session_internal');
    expect(json).not.toContain('v_internal');
  });

  test('word count prefers the variant, which is what the text came from', () => {
    const out = chapterText('p1', 'c1', { totalWordCount: 90 }, { wordCount: 100 });
    expect(out.wordCount).toBe(100);
    // Falls back to the chapter when the variant is gone.
    expect(chapterText('p1', 'c1', { totalWordCount: 90 }, null).wordCount).toBe(90);
  });
});
