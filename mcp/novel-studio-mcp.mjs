#!/usr/bin/env node
/**
 * Novel Studio MCP server — read-only manuscript access. (Stage 5B)
 *
 * Run it from an MCP client, not by hand:
 *
 *   {
 *     "mcpServers": {
 *       "novel-studio": {
 *         "command": "node",
 *         "args": ["C:/path/to/novel-studio/mcp/novel-studio-mcp.mjs"],
 *         "env": {
 *           "NOVEL_AI_READ_TOKEN": "…",
 *           "NOVEL_STUDIO_BASE_URL": "http://localhost:3000"
 *         }
 *       }
 *     }
 *   }
 *
 * The token belongs in that env block and nowhere else. It is never given a
 * NEXT_PUBLIC_ prefix, never imported by a browser bundle, and never written to
 * a file by this process.
 *
 * WHAT THIS SERVER CAN DO: list projects, read a chapter outline, read a
 * chapter's text, search the prose. That is the whole of it. There is no tool
 * that saves, edits, deletes or publishes, and `mcp/lib/tools.mjs` cannot
 * describe a request that would.
 *
 * One rule for stdio transport, which is why every diagnostic below goes to
 * stderr: STDOUT CARRIES PROTOCOL MESSAGES ONLY. A stray console.log corrupts
 * the stream and the client disconnects with an unhelpful parse error.
 */

import { performRequest, readConfig, scrubSecrets, ApiError } from './lib/client.mjs';
import {
  createHandler,
  errorResponse,
  isValidRequestId,
  JSON_RPC_ERRORS,
  splitMessages,
} from './lib/protocol.mjs';
import { formatToolResult, planRequest, ToolInputError, TOOLS } from './lib/tools.mjs';

const SERVER_INFO = { name: 'novel-studio', version: '1.0.0' };

/** @param {string} message */
function logToStderr(message) {
  process.stderr.write(`[novel-studio-mcp] ${message}\n`);
}

let config;
try {
  config = readConfig(process.env);
} catch (err) {
  logToStderr(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

logToStderr(`read-only server ready; reading from ${config.baseUrl}`);

const handle = createHandler({
  serverInfo: SERVER_INFO,
  tools: TOOLS,
  async callTool(name, args) {
    let plan;
    try {
      plan = planRequest(name, args);
    } catch (err) {
      if (err instanceof ToolInputError) throw err;
      throw new Error(scrubSecrets(String(err), config.token));
    }

    try {
      const data = await performRequest(config, plan);
      return formatToolResult(name, args, data);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new Error(
        scrubSecrets(err instanceof Error ? err.message : String(err), config.token)
      );
    }
  },
});

/** @param {object} message */
function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

/** @param {string} line */
async function processLine(line) {
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    send(errorResponse(null, JSON_RPC_ERRORS.parseError, 'Invalid JSON.'));
    return;
  }

  try {
    const response = await handle(parsed);
    if (response) send(response);
  } catch (err) {
    // A handler that throws would otherwise leave the client waiting forever.
    const text = scrubSecrets(err instanceof Error ? err.message : String(err), config.token);
    logToStderr(`handler failed: ${text}`);
    // Only a real request gets an answer: a notification that failed is still
    // a notification, and must stay silent.
    const id = parsed && typeof parsed === 'object' ? parsed.id : undefined;
    if (isValidRequestId(id)) send(errorResponse(id, JSON_RPC_ERRORS.internalError, text));
  }
}

let buffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  const { lines, rest } = splitMessages(buffer);
  buffer = rest;
  for (const line of lines) void processLine(line);
});

process.stdin.on('end', () => process.exit(0));
process.stdin.on('error', (err) => {
  logToStderr(`stdin error: ${err.message}`);
  process.exit(1);
});

// Never let an unexpected rejection take the server down mid-conversation.
process.on('unhandledRejection', (reason) => {
  logToStderr(`unhandled rejection: ${scrubSecrets(String(reason), config.token)}`);
});
