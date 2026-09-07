/**
 * Novel Studio MCP — the Model Context Protocol message layer. (Stage 5B)
 *
 * MCP over stdio is JSON-RPC 2.0 with one message per line. That is small
 * enough to implement directly, and doing so is the point: a server whose whole
 * job is to hand an AI read-only access to a novelist's unpublished manuscript
 * is a poor place to add a dependency tree nobody in this repository has read.
 * There is nothing to install and nothing to audit but these three files.
 *
 * Pure message handling: a message in, a message out. The tool executor is
 * injected, so this module is testable without a network or a subprocess.
 */

/** Newest first. The client's choice is honoured when we know it. */
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
export const PREFERRED_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

export const JSON_RPC_ERRORS = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
};

/**
 * Version negotiation, per the MCP spec: echo the client's version when it is
 * one we speak, otherwise answer with ours and let the client decide.
 *
 * @param {unknown} requested
 */
export function negotiateProtocolVersion(requested) {
  return typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
    ? requested
    : PREFERRED_PROTOCOL_VERSION;
}

/**
 * @typedef {{ jsonrpc: '2.0', id: string|number|null, result: any }} JsonRpcResult
 * @typedef {{ jsonrpc: '2.0', id: string|number|null, error: { code: number, message: string } }} JsonRpcError
 * @typedef {JsonRpcResult | JsonRpcError} JsonRpcResponse
 */

/**
 * @param {string|number|null} id
 * @returns {JsonRpcResult}
 */
function result(id, value) {
  return { jsonrpc: '2.0', id, result: value };
}

/**
 * @param {string|number|null} id
 * @returns {JsonRpcError}
 */
export function errorResponse(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/**
 * Builds the message handler.
 *
 * @param {Object} options
 * @param {{ name: string, version: string }} options.serverInfo
 * @param {Array<object>} options.tools
 * @param {(name: string, args: Record<string, unknown>) => Promise<Array<{type:'text',text:string}>>} options.callTool
 */
export function createHandler({ serverInfo, tools, callTool }) {
  /**
   * @param {any} message A parsed JSON-RPC message.
   * @returns {Promise<JsonRpcResponse|null>} The response, or null for a notification.
   */
  return async function handle(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      return errorResponse(null, JSON_RPC_ERRORS.invalidRequest, 'Expected a JSON-RPC object.');
    }

    const { id, method, params } = message;
    // A notification carries no id and must never be answered — replying to one
    // is the classic way to wedge a stdio client.
    const isNotification = id === undefined || id === null;

    if (typeof method !== 'string') {
      return isNotification
        ? null
        : errorResponse(id, JSON_RPC_ERRORS.invalidRequest, 'Missing method.');
    }

    switch (method) {
      case 'initialize':
        return result(id, {
          protocolVersion: negotiateProtocolVersion(params?.protocolVersion),
          capabilities: { tools: {} },
          serverInfo,
          instructions:
            'Read-only access to the manuscripts in Novel Studio. These tools ' +
            'can list projects, read a chapter outline, read a chapter\'s text ' +
            'and search the prose. Nothing here can create, edit, save, delete ' +
            'or publish — if the user asks for a change, tell them it has to be ' +
            'made in Novel Studio itself.',
        });

      case 'ping':
        return isNotification ? null : result(id, {});

      case 'tools/list':
        return result(id, { tools });

      case 'tools/call': {
        const name = params?.name;
        const args =
          params?.arguments && typeof params.arguments === 'object'
            ? params.arguments
            : {};

        if (typeof name !== 'string') {
          return errorResponse(id, JSON_RPC_ERRORS.invalidParams, 'Missing tool name.');
        }

        try {
          const content = await callTool(name, args);
          return result(id, { content, isError: false });
        } catch (err) {
          // Per the spec a tool that fails reports it in the result, so the
          // model can read the reason and correct itself, rather than as a
          // protocol error that the client swallows.
          const text = err instanceof Error ? err.message : String(err);
          return result(id, { content: [{ type: 'text', text }], isError: true });
        }
      }

      default:
        // Notifications we do not implement — `notifications/initialized`
        // above all — are accepted silently, as the protocol requires.
        if (isNotification) return null;
        return errorResponse(
          id,
          JSON_RPC_ERRORS.methodNotFound,
          `Method not supported: ${method}`
        );
    }
  };
}

/**
 * Splits a stdio chunk into complete newline-delimited messages.
 *
 * Returns the leftover partial line so the caller can prepend it to the next
 * chunk: a large message arrives split across several reads, and treating each
 * read as a message loses it.
 *
 * @param {string} buffer
 * @returns {{ lines: string[], rest: string }}
 */
export function splitMessages(buffer) {
  const lines = [];
  let rest = buffer;
  let index;

  while ((index = rest.indexOf('\n')) !== -1) {
    const line = rest.slice(0, index).trim();
    rest = rest.slice(index + 1);
    if (line) lines.push(line);
  }

  return { lines, rest };
}
