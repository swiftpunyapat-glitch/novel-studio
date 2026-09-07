# AI Reader / MCP — read-only manuscript access (V1)

An MCP server that lets an AI assistant **read** the manuscripts in Novel
Studio. It cannot write. That is not a policy the server tries to follow — it
is the shape of the code, and this document explains where the boundary is so
that a later change cannot cross it by accident.

```
AI client (Claude Desktop, …)
   │  stdio, JSON-RPC 2.0
   ▼
mcp/novel-studio-mcp.mjs        ← the token lives here, in process env only
   │  HTTPS, Bearer <NOVEL_AI_READ_TOKEN>
   ▼
/api/ai/*  (Next.js route handlers)
   │  Firebase Admin SDK, scoped to NOVEL_OWNER_UID
   ▼
Firestore
```

---

## The four tools

| Tool | Reads | Arguments |
| --- | --- | --- |
| `novel_list_projects` | Manuscripts owned by the configured owner | — |
| `novel_get_structure` | Volumes and chapter metadata for one project. No prose | `projectId` |
| `novel_get_chapter_text` | Full plain text of one chapter's current draft | `projectId`, `chapterId`, `maxChars?` |
| `novel_search_manuscript` | Literal substring search across every chapter, with context | `projectId`, `query`, `limit?` |

There is no tool that creates, edits, saves, deletes or publishes, and none is
planned for V1. If an assistant is asked to change something, the correct
answer is that the change has to be made in Novel Studio itself.

All four carry the same MCP annotations:

```json
{ "readOnlyHint": true, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false }
```

These are **advisory metadata**, and the specification is explicit that a client
must not take an untrusted server's annotations as a guarantee. This server does
not ask it to: the read-only property is enforced structurally, as described
below, and those guards remain the authority. The annotations exist so a client
can present the tools sensibly — auto-approving a read, for instance — without
inferring intent from a tool name.

---

## Protocol era — 2025 (legacy) stdio, deliberately

The server negotiates these revisions, newest first:

```
2025-11-25   ← preferred
2025-06-18
2025-03-26
2024-11-05
```

It does **not** claim `2026-07-28` or later. That revision opens a different,
modern era with `server/discover` and per-request metadata, none of which is
implemented here. Advertising it would be a lie a client would act on: it would
go looking for discovery and receive a method-not-found. A client asking for a
modern version is answered with `2025-11-25` instead and decides for itself
whether to continue.

Modern-era support is out of scope for V1. A version belongs in
`SUPPORTED_PROTOCOL_VERSIONS` only once the server actually implements it.

### JSON-RPC strictness

- `jsonrpc` must be exactly `"2.0"`.
- A request id, when present, must be a string or a finite number. `null` is
  **not** a valid MCP request id — JSON-RPC permits it, MCP does not, and it
  would collide with the value used to mean "the id could not be determined".
- A **notification is a message with no `id` property at all**, not one whose
  id is `null`. `{ "id": null, … }` is a malformed request and is answered;
  `{ }` is a notification and is not.
- A notification never receives a response — including a malformed one, and
  including `tools/list` or `tools/call` sent without an id. Answering a
  notification is the classic way to wedge a stdio client.

---

## Why it cannot write

Four independent barriers, each of which would have to be removed deliberately:

1. **No route exists.** `/api/ai/*` exports only `GET` handlers, plus one
   `POST` for search — which carries a query in its body and performs no
   Firestore write. There is no `PUT`, `PATCH` or `DELETE` anywhere under
   `app/api/ai/`.
2. **No URL is built from arguments.** `mcp/lib/tools.mjs` holds four
   hardcoded route templates. Arguments only fill in a path segment, validated
   and then percent-encoded, so no argument value can produce a different path.
3. **An allowlist re-checks the result.** `assertReadOnly` compares every
   planned request against that same fixed set — once when the plan is made,
   and again in `client.mjs` immediately before the request leaves the process.
4. **Tests assert the mechanism, not the tool list.** `tests/unit/mcp-read-only.test.ts`
   checks that no tool name matches a mutating verb, that only search uses
   `POST`, that every path is under `/api/ai/`, and that `assertReadOnly`
   rejects a write. A save tool fails the suite whatever else is updated.

The tool annotations are a fifth, advisory layer. They are not one of the four.

The Firebase Admin SDK bypasses `firestore.rules`, so the route handlers are
the only access control on this path. They are not weakened by this feature and
`firestore.rules` is unchanged.

---

## The token

`NOVEL_AI_READ_TOKEN` is a **server-side secret**. It exists in exactly two
places:

- the Novel Studio server's environment (`.env.local`), where `lib/ai/auth.ts`
  reads it to verify incoming requests;
- the MCP server's own environment, where `mcp/lib/client.mjs` reads it to sign
  outgoing ones.

It must **never** be given a `NEXT_PUBLIC_` prefix — that is the mechanism by
which Next.js inlines a value into the browser bundle. `lib/ai/auth.ts` is
imported only by route handlers, never by a client component, so the token has
no path into a page. The MCP server additionally scrubs it from every error
string before that string can reach a log or a model's context, because a
failing request is exactly when a verbose error is most likely to carry a
credential out with it.

Generate one with:

```bash
openssl rand -hex 32
```

---

## Setup

### 1. Novel Studio server

In `.env.local`:

```
NOVEL_AI_READ_TOKEN="<the token>"
NOVEL_OWNER_UID="<the Firebase uid whose manuscripts may be read>"
```

Both are required. With either missing the API returns `503` to every request
rather than falling back to something permissive.

`NOVEL_OWNER_UID` is what makes the token single-owner: it authorises reads for
exactly one account, and every route filters by it. A leaked token cannot
enumerate anyone else's work.

### 2. MCP client

No install step — the server has no dependencies. Point your client at the
file:

```json
{
  "mcpServers": {
    "novel-studio": {
      "command": "node",
      "args": ["C:/Users/you/Desktop/Novel Studio/novel-studio/mcp/novel-studio-mcp.mjs"],
      "env": {
        "NOVEL_AI_READ_TOKEN": "<the same token>",
        "NOVEL_STUDIO_BASE_URL": "http://localhost:3000"
      }
    }
  }
}
```

| Variable | Required | Default |
| --- | --- | --- |
| `NOVEL_AI_READ_TOKEN` | yes | — (server exits if absent) |
| `NOVEL_STUDIO_BASE_URL` | no | `http://localhost:3000` |
| `NOVEL_MCP_TIMEOUT_MS` | no | `30000` |

Only the **origin** of `NOVEL_STUDIO_BASE_URL` is used; a path or query in it is
discarded, so a base URL cannot smuggle in a prefix.

---

## Notes for whoever works on this next

- **stdout carries protocol messages only.** Every diagnostic in the MCP server
  goes to stderr. A stray `console.log` corrupts the stream and the client
  disconnects with an unhelpful parse error.
- **Responses are allowlists.** `lib/ai/serialize.ts` writes out every field by
  hand. `{ id, ...doc.data() }` is the thing it exists to prevent: it publishes
  whatever a document holds today and, worse, whatever is added to it tomorrow.
- **Plain text only.** The chapter tool returns prose, never the manuscript's
  Tiptap JSON. Handing out the tree would make an external reader a consumer of
  the editor's schema and every future change to it their problem.
- **Chapter text is the active variant.** Sibling draft variants and revision
  snapshots are not exposed; a reader sees the chapter as it currently stands.

## Known limits (V1)

- Single owner, single token. This is not multi-tenant credential
  infrastructure and should not become it without a real credential store.
- Search is a literal case-insensitive substring scan over every chapter's
  text, performed in the route. It is not an index, and it is not regex or
  semantic search. Fine at the scale of one novel.
- `novel_get_chapter_text` returns a whole chapter by default. `maxChars` is
  available when context is tight, and truncation is always declared rather
  than silent.
- The characters endpoint (`/api/ai/projects/{id}/characters`) exists and is
  hardened, but is deliberately **not** exposed as an MCP tool in V1 — it
  carries private author notes, and the brief for this version is manuscript
  text.
