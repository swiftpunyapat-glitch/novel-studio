# Stage 2 — Manuscript Durability: Verification Record

Branch: `audit/security-hardening`
Scope: multi-device safety and local durability (Audit C5, H4, H7, M5, M6, M17)

---

## What is verified where

Stage 2's guarantees are proven at three levels. This matters because each level
proves something the others cannot.

| Level | Proves | Where |
|---|---|---|
| Rules engine + real transactions | The stale device genuinely cannot overwrite, even with a hostile client | `tests/rules/content-version.test.ts`, `tests/rules/acceptance-multidevice.test.ts` |
| Coordinator with `fake-indexeddb` | State machine, conflict handling, flush/dispose, offline buffering | `tests/unit/durability.test.ts` |
| Real browser | Browser IndexedDB actually persists Tiptap JSON and Thai text across reload | Recorded below |

---

## A. Two-device conflict scenario

**Automated equivalent:** `tests/rules/acceptance-multidevice.test.ts`, run against
the Firestore emulator with real transaction semantics and the production rules.

| Step | Expected | Result |
|---|---|---|
| PC A opens Chapter 1 at version N (=1) | baseVersion 1 | PASS |
| PC B opens the same chapter at version N | baseVersion 1 | PASS |
| PC A writes and saves | version becomes N+1 | PASS |
| PC B types into the stale copy and saves | **conflict, not a write** | PASS |
| PC A's text on the server | unchanged | PASS |
| Server version | still N+1, no extra write | PASS |
| PC B's local content | intact, returned in the conflict result | PASS |
| PC B preserves text as a new Draft Variant | both texts exist, neither lost | PASS |
| PC B accepts remote, then saves again | succeeds at N+2 | PASS |
| Legacy variant with no `contentVersion` | first save migrates 0 → 1 | PASS |

The rules engine independently rejects a same-version content change, a +2 skip,
a rewind, a non-integer, and a content change with no version bump — so the
guarantee does not depend on the client behaving.

### Browser walkthrough (for re-running by hand)

```bash
npx firebase emulators:start --project novel-studio-test --only firestore,storage,auth
```

Set `NEXT_PUBLIC_USE_FIREBASE_EMULATORS="true"` in `.env.local`, then `npm run dev`.

1. Sign in, open a chapter in two browser profiles (not two tabs — two profiles,
   so each gets its own IndexedDB and session id).
2. Note the version indicator in both.
3. In profile A, type a sentence and wait for **Saved**.
4. In profile B, type a different sentence.
5. Expected: profile B shows the **Conflict** badge and the conflict dialog,
   listing both texts side by side.
6. Choose *Keep this device's text as a new draft variant*.
7. Expected: a new variant appears; profile A's text is untouched.

---

## B. Offline scenario

**Automated equivalent:** `tests/unit/durability.test.ts` — "Offline behaviour"
and "8. Navigation flushes the final edit".

| Step | Expected | Result |
|---|---|---|
| Type text | mirrored to IndexedDB within ~300ms | PASS |
| Go offline | status `offline_pending`, no remote call attempted | PASS |
| Keep writing while offline | buffered locally, flagged dirty | PASS |
| Refresh the browser | local text still present and recoverable | PASS (browser-verified, below) |
| Recovery prompt on load | offered when local is dirty and differs from remote | PASS |
| Go back online and flush | syncs the buffered text, status `saved` | PASS |
| Remote content after sync | matches the offline text exactly | PASS |

---

## C. Real-browser IndexedDB verification

Performed against Chrome at `http://localhost:3000` on 2026-09-07, using the
real `indexedDB` implementation (not `fake-indexeddb`), exercising the same
object-store shape as `lib/offline/manuscript-mirror.ts`.

| Check | Result |
|---|---|
| Real browser IndexedDB (not a shim) | `true` |
| Tiptap JSON round-trips intact | `true` |
| Thai text preserved exactly (`ข้อความภาษาไทยที่พิมพ์ขณะออฟไลน์`) | `true` |
| Snapshot survives closing and reopening the connection | `true` |
| Snapshot survives a **full page reload** | `true` |
| `markMirrorClean` clears `dirty` but retains content | `true` |
| `baseVersion` advances on clean | `1` → `2` |

The Thai case is checked explicitly because the manuscript body font is Sarabun
and the primary language is Thai; a mirror that mangled multi-byte text would
lose work silently.

### Not verified in-browser

The following were proven at the coordinator and rules levels but **not** driven
through the React UI in a browser, because the studio only exposes Google
sign-in and the Auth emulator cannot complete that popup flow unattended:

- the conflict dialog and recovery dialog rendering and button wiring
- the `beforeunload` prompt actually appearing
- Ctrl+S in the real editor

These are UI-wiring risks, not durability risks: the underlying state machine,
the transaction and the rules are all covered by automated tests. Re-run
section A's browser walkthrough by hand to close them.

---

## D. Migration note for existing DraftVariant documents

No migration script is required.

`readContentVersion()` treats a missing `contentVersion` as `0`, and the rules
apply the same rule (`storedVersion()` returns `0` when the field is absent). The
first save of a legacy variant therefore writes `contentVersion: 1` and the
document is migrated in place. This is covered by the "legacy variant" case in
`tests/rules/acceptance-multidevice.test.ts`.

Consequence to be aware of: two devices both holding a legacy variant will both
compute `baseVersion = 0`, so the first to save wins and the second gets a normal
conflict — which is the intended behaviour, not a gap.
