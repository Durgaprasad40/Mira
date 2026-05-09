# STRICT FORENSIC AUDIT — Confess / Confession Chat Connect–Reject Flow

**Scope:** Confess flow only (NOT Phase-1 Messages, NOT Phase-2 Messages). Read-only. No code changes, no commits, no pushes.

---

## A. Branch, HEAD, git status

- **Branch:** `feature/bg-crossed-paths`
- **HEAD:** `dbac695` ("Harden Phase-1 Messages for production")
- **Working tree:** clean (no modifications)

---

## B. Files audited

**Frontend / UI**
- `app/(main)/confession-chat.tsx` (778 lines) — confession 1:1 chat screen with mutual-reveal UI
- `app/(main)/confession-thread.tsx` (~2 100 lines) — comments thread for a confession
- `app/(main)/(tabs)/confessions.tsx` (~2 600 lines) — confessions feed + "Tagged for you"
- `app/(main)/profile/[id].tsx` (lines 320-330 inspected) — confession-tag profile-view handler
- `app/(main)/comment-connect-requests.tsx` — explicitly **BLOCKED stub** ("Coming Soon")
- `components/confessions/ConfessionCard.tsx` — feed card with `onConnect`/`isConnected` props
- `components/confessions/ReportConfessionSheet.tsx` (referenced)

**State stores**
- `stores/confessionStore.ts` (1 157 lines) — Zustand, in-memory only, "STORAGE POLICY: NO local persistence. Convex is ONLY source of truth"
- `stores/confessPreviewStore.ts` (referenced)
- `stores/demoStore.ts`, `stores/demoDmStore.ts` — demo-only fake match/conversation plumbing
- `stores/authStore.ts:354` — clears `connectedConfessionIds` on logout
- `stores/blockStore.ts` — single source of truth for blocks

**Backend (Convex)**
- `convex/confessions.ts` (2 030 lines) — confession CRUD, reactions, replies, tagged-profile-view grants
- `convex/conversations.ts` (61 lines) — only `getOrCreateForMatch` (match-based, NOT confession-based)
- `convex/revealRequests.ts` (200 lines) — Private-Mode Phase-2 photo reveal (NOT confession reveal)
- `convex/schema.ts` (~2 740 lines) — confessions, conversations, confessionTagProfileViews, confessionNotifications, confessionReplies, revealRequests
- `convex/notifications.ts`, `convex/notificationBellPhase.ts` — `tagged_confession` / `TAGGED_CONFESSION` types

**Types**
- `types/index.ts:770-815` — `MutualRevealStatus`, `ConfessionChat`

---

## C. Current Confess Connect–Reject implementation summary

**There is no two-sided "Connect → counter-Connect" flow.** The shipped code implements **a one-sided trigger plus a client-side "Mutual Reveal" UI overlay**.

| Concept user described | What actually exists |
|---|---|
| Tagged user taps Connect | Tagged user **reacts with an emoji** → backend auto-creates a confession-based conversation (no opt-in dialog, no "Connect" button wired up). |
| Tagged user taps Reject | **Does not exist.** No reject UI, no `reject` mutation, no `rejectedConfessionIds` state. |
| Confessor sees Connect/Reject | **Does not exist.** Confessor never gets a confirmation prompt; the conversation is created unilaterally. |
| Mutual Connect → real Phase-1 Messages thread | The thread created on reaction is `isPreMatch: true, expiresAt: now+24h, anonymousParticipantId: confession.userId` — i.e. **a 24-hour anonymous pre-match thread, not a real Phase-1 Messages match**. Promotion to a permanent Phase-1 thread requires the **separate "Mutual Reveal" mini-flow inside `confession-chat.tsx`**, which is **100 % client-side Zustand** and only escalates to a permanent match in **demo mode** via `createRevealMatch`. |
| Backend-authoritative state | **Violated.** Reveal/agree/decline state lives only in `useConfessionStore.chats[].mutualRevealStatus`. There is no Convex column, no mutation, no query. State is lost on app restart and is invisible to the other device. |
| Anonymity preserved until mutual | Partially: backend `toggleReaction` and `getOrCreateForConfession` set `anonymousParticipantId = confession.isAnonymous ? confession.userId : undefined`. But there is **no server-side gate that flips anonymity off after both sides "Connect"** — because there's no two-sided Connect on the server. |
| Block / report / expiry safety | Strong on the *profile-view-grant* path (`canUseConfessTagActions`, `consumeConfessionTagProfileViewGrant` — 8-step gate). Absent on the *reveal/connect* path because no such backend path exists. |

---

## D. Current data flow trace (what happens today)

**Step 1 — User A confesses tagging User B** (`createConfession` in `convex/confessions.ts:325`):
- Inserts confession row with `taggedUserId`, `taggedUserName`.
- Inserts `notifications` row of type `tagged_confession` (deduped via `taggedDedupeKey`).
- Inserts `confessionNotifications` row of type `TAGGED_CONFESSION`.

**Step 2 — User B opens "Tagged for you" / feed:**
- Reads `listTaggedConfessionsForUser` and `getTaggedConfessionBadgeCount`.
- `markTaggedConfessionsSeen` flips `seen` flag.

**Step 3 — User B reacts with an emoji on the tagged confession** (`toggleReaction`, `convex/confessions.ts:1146-1255`):
- If `confession.taggedUserId === userId` and no existing conversation by `by_confession` index:
  - Inserts a `conversations` row: `participants=[author, taggedUser]`, `isPreMatch:true`, `expiresAt:now+24h`, `anonymousParticipantId = confession.isAnonymous ? confession.userId : undefined`.
  - Inserts two `conversationParticipants` junction rows.
  - Returns `chatUnlocked: true`.
- **No "Connect" button is involved. Reaction = silent thread creation.**

**Step 4 — User B opens the confession chat** (`app/(main)/confession-chat.tsx`):
- The chat is **read from `useConfessionStore.chats`, not from Convex**. There is no `useQuery` against any conversation in this screen.
- UI shows "Anonymous Chat from Confess", a 24h timer, and the pinned confession snippet.
- **Tagged person** sees a "Request Mutual Reveal" CTA → calls `agreeMutualReveal(chat.id, userId)` → flips `chat.mutualRevealStatus` to `'initiator_agreed'` **in Zustand only**.
- **Confessor (User A)** sees an Accept/Decline prompt → calls `agreeMutualReveal` or `declineMutualReveal` → flips state to `'both_agreed'` or `'declined'` **in Zustand only**.

**Step 5 — On `both_agreed`:**
- A "View Their Profile" button appears.
- Tapping navigates to `/(main)/profile/[id]?mode=confess_reveal&chatId&confessionId`.
- `app/(main)/profile/[id].tsx` only checks `mode === 'confess_preview'` (line 326). The `mode === 'confess_reveal'` branch is **not handled** (no special grant call). The profile resolves through normal access rules.
- `createRevealMatch` (the function that would create a permanent Phase-1 thread) is **demo-only**: it calls `useDemoDmStore.seedConversation` / `useDemoStore.addMatch`. **There is no Convex mutation behind it.**

**Step 6 — On expiry (24h):**
- `purgeExpiredNow` in the store cascade-deletes confession-based threads from `useDemoDmStore` and clears local maps.
- Backend `conversations.expiresAt` is set, but this audit found **no scheduled job that prunes expired confession conversations** server-side (purging logic is only in `confessions.ts` for confessions themselves; `convex/crons.ts` was not seen handling this case).

---

## E. What is working (truth-honest)

1. **Confession creation with tagging** is fully backend-authoritative: `taggedUserId`, `taggedUserName`, `tagged_confession` notification, `TAGGED_CONFESSION` confessionNotifications row.
2. **Tagged-user emoji-reaction → conversation creation** is backend-authoritative and idempotent (uses `by_confession` index).
3. **Anonymous-participant flag** is correctly set on conversation creation when the confession is anonymous.
4. **Profile-view-grant for tagged user** (`canUseConfessTagActions` + `consumeConfessionTagProfileViewGrant`) is robust — eight gates: token-auth viewer, confession existence, lifecycle, hidden-by-reports, viewer-reported-confession, mention-id match (locks `profileUserId` to `taggedUserId`), bidirectional block, viewer-reported-target.
5. **24h `expiresAt`** is stamped on every confession-based conversation.
6. **Block / report state** for confessions is enforced (`reportConfession`, `isHiddenByReports`, `hasViewerReportedConfession`).
7. **Mutual-Reveal state machine** (`'none' → 'initiator_agreed' → 'both_agreed' | 'declined'`) is correctly modeled at the type level.
8. **Race-guard** for thread creation (`threadCreationInProgress: Set<string>`) at the store level prevents local double-creation.
9. **TypeScript codegen** clean (`npx convex codegen` exit 0).

---

## F. What is local-only (Zustand) and lost on app restart / cross-device

1. **`mutualRevealStatus`, `declinedBy`, `isRevealed`** on `ConfessionChat` (Zustand `useConfessionStore.chats`).
2. **`agreeMutualReveal` / `declineMutualReveal`** mutations are pure Zustand setters — no Convex call.
3. **`connectedConfessionIds`** array — local only.
4. **`confessionThreads` map** (confessionId → conversationId) — local mirror used to dedupe demo threads.
5. **`revealSkippedChats`** map — local only.
6. **`createRevealMatch`** ("permanent match after Like during reveal") — calls only `useDemoDmStore` + `useDemoStore`. No backend.
7. **`connectToConfession`** — calls only `useDemoDmStore.seedConversation` + `useDemoStore.addMatch`. No backend.
8. **`isConfessionConnected`** — reads local array.
9. **`chats: ConfessionChat[]`** itself — confession chat objects are seeded from `DEMO_CONFESSION_CHATS` in demo mode and **never seeded from Convex in live mode**.

> The store header explicitly states: *"STORAGE POLICY: NO local persistence. Convex is ONLY source of truth."* — this is **violated** by every reveal/connect path above.

---

## G. What is missing (vs. user's product intent)

1. **No bidirectional Connect/Reject API.** Backend has zero of: `requestConnect`, `respondToConnect`, `acceptConnect`, `rejectConnect`, `agreeReveal`, `declineReveal`, `getConnectStatus`. Grep across `convex/` confirms.
2. **No `confessionConnects` / `confessionReveals` table.** Schema has `revealRequests` (Private-Mode photo reveal — different feature) and `todConnectRequests` (Truth-or-Dare — different feature), but nothing for confessions.
3. **No "Connect / Reject" UI on the feed card.** `ConfessionCard.tsx:71/97` exposes `onConnect`/`isConnected` props but a grep for `onConnect={` / `isConnected={` across the entire repo returns **zero matches**. No reject prop exists at all. Styles `connectButton`/`connectButtonConnected` are declared but **not used in JSX** within the card.
4. **No Confessor-side accept/reject UI that hits the network.** The accept/decline UI exists in `confession-chat.tsx:409-423`, but onPress goes to local Zustand only.
5. **No backend status query the chat screen subscribes to.** `confession-chat.tsx` has zero `useQuery` calls for conversation/reveal state — meaning even if A taps Connect, B's device never learns about it.
6. **No reveal-on-mutual gate.** When `both_agreed` flips locally, the backend doesn't atomically flip `anonymousParticipantId → undefined`, doesn't promote `isPreMatch → false`, and doesn't extend `expiresAt` to `null` (permanent match).
7. **No notifications for Connect events.** `notifications` table has `tagged_confession`, but no `confession_connect_requested` / `confession_connect_accepted` / `confession_connect_declined` types.
8. **No Phase-1 Messages handoff.** A successful mutual connect should mint a Phase-1 conversation (`isPreMatch:false, connectionSource:'confession', expiresAt:undefined, anonymousParticipantId:undefined`) — there is no mutation that does this in live mode.
9. **`comment-connect-requests.tsx` is a stub** that explicitly references three non-existent backend symbols (`getPendingCommentConnects`, `respondToCommentConnect`, `asCommentConnectId`). A connect-inbox UI was attempted and abandoned.
10. **`confessionReplies.hasActiveConnectRequest`** is a documented "legacy flag ignored by current Confessions UI/backend contract" — dead schema bloat.
11. **No idempotency key beyond `by_confession`.** A reject-then-retry flow doesn't exist; if it did, `toggleReaction` would happily resurrect the conversation because the only check is "does a row exist".
12. **No cross-device convergence test** is possible — state cannot converge.
13. **No expiry sweeper for confession conversations** (only confession rows themselves).
14. **`mode=confess_reveal` is unhandled** in `app/(main)/profile/[id].tsx`. Only `confess_preview` is recognized.

---

## H. Findings, classified by severity

### P0 — blocks production / breaks privacy

- **P0-1 Reveal state is client-only (data integrity & cross-device).** `agreeMutualReveal` / `declineMutualReveal` write only to Zustand (`stores/confessionStore.ts:576, 619`). Closing the app loses the state; the other party never sees it; reinstall wipes it. `confession-chat.tsx:218-234` calls these directly.
- **P0-2 No bidirectional confirmation on the wire.** The backend creates the conversation when the tagged user reacts (`convex/confessions.ts:1213-1249`). The confessor never gets to accept or reject. Product intent ("if both connect, a real thread") is unsatisfiable with current code.
- **P0-3 `createRevealMatch` is demo-only.** `stores/confessionStore.ts:929-1008` only calls demo stores. In live mode, the user lands on the profile screen with no real Phase-1 thread ever produced. The "real Messages thread on mutual" promise is a façade.
- **P0-4 Anonymity demotion has no atomic gate.** Even if mutual reveal becomes server-side, `anonymousParticipantId` is set at conversation creation (`convex/confessions.ts:1233, 1934`) and never cleared. A leaked `participants` array on a debug surface would expose the confessor — no per-row "until both agree" guard.

### P1 — high-impact, ships a broken UX

- **P1-1 No Reject affordance for the tagged user.** No UI, no store action, no mutation.
- **P1-2 Reaction = silent connect.** A user tapping a reaction emoji on a tagged confession unilaterally creates a 1:1 anonymous chat with no consent dialog. Counter-intuitive and not aligned with the "Connect/Reject" intent.
- **P1-3 `comment-connect-requests` is a dead screen** linked from somewhere in the app (route exists), shows "Coming Soon" forever.
- **P1-4 ConfessionCard `onConnect`/`isConnected` props are dead code.** Wired in component signature but no consumer passes them; styles unreferenced in JSX.
- **P1-5 No notification fanout for Connect events.** Recipient cannot be notified of a Connect request because no Connect concept exists server-side.
- **P1-6 `mode=confess_reveal` unhandled in profile screen.** Navigation lands on a screen with no tailored UI; "Like to connect" hint in `confession-chat.tsx:383` cannot lead anywhere meaningful in live mode.

### P2 — correctness / hygiene

- **P2-1 Schema bloat:** `confessionReplies.hasActiveConnectRequest` is documented as legacy/ignored; should be removed in a sweep once a real backend exists.
- **P2-2 Demo and live diverge.** Demo creates `demo_convo_connect_*` and `demo_convo_reveal_match_*`; live creates real `conversations` rows on reaction. The two surfaces are not unified.
- **P2-3 No idempotency on reject + re-react.** If a server-side reject existed, today's `toggleReaction` would re-create the conversation.
- **P2-4 No expiry sweeper for confession conversations.** `expiresAt` is set but no cron prunes; UI hides them via expiry guards (`confession-chat.tsx:91-126`), but rows accumulate indefinitely server-side.
- **P2-5 `purgeExpiredNow` is store-side only.** No equivalent backend purge; expired confessions linger in Convex (only soft-deleted via author action).

### P3 — polish

- **P3-1 Mixed terminology:** "Mutual Reveal" (UI/store) vs "Connect/Reject" (product intent) vs "comment_connect" (stub). Pick one canonical term.
- **P3-2 Demo fallback `'demo_user_1'`** in `confession-chat.tsx:75` is correctly behind `isDemoMode`, but consider asserting it doesn't leak.
- **P3-3 `getTaggedUserId` reads `confession?.targetUserId` as a fallback** (`stores/confessionStore.ts:71-72`). The `targetUserId` field doesn't exist in the live schema; legacy.
- **P3-4 Inline `as any` casts** (`confession-thread.tsx`, `stores/confessionStore.ts` `targetUserId` lookup) suggest type-erosion in the legacy code path.

---

## I. Security / privacy assessment

| Vector | Status |
|---|---|
| Tagged-user-only profile view | Strong (8-gate `canUseConfessTagActions` + `consumeConfessionTagProfileViewGrant`). |
| Server auth on writes | `ensureUserByAuthId` / `getValidatedViewerFromToken` used. |
| Block enforcement | Bidirectional check on profile grant. |
| Report enforcement | Hidden-by-reports gate + viewer-reported gates. |
| 24h confession expiry | Enforced in queries and chat-open guard. |
| Anonymous-author leakage in conversation | `anonymousParticipantId` is set on insert, but there is no read-side enforcement audited here; needs separate check that `Messages` UI reading the conversation honors that flag. |
| Reveal-state authority | Client-only. A malicious client could lie about `mutualRevealStatus` since nothing else reads it; *currently low impact only because there's no server consumer at all*. |
| Mutual-only Phase-1 promotion | No server enforcement (no live-mode promotion exists). |

---

## J. Persistence assessment

- Confession rows: Convex.
- Confession reactions: Convex (`confessionReactions`).
- Confession replies: Convex (`confessionReplies`).
- Confession conversation: Convex (`conversations`, indexed `by_confession`).
- **Confession chat reveal state: Zustand-only.**
- **Confession "connect" state (in user's product sense): Does not persist anywhere — it doesn't exist as an entity.**
- Tagged-confession seen state: Convex (`markTaggedConfessionsSeen`) + local mirror.
- Profile-view grants: Convex (`confessionTagProfileViews`, 24h TTL).

---

## K. Thread-creation assessment

- **Trigger:** Tagged user emoji-reacts on tagged confession (`toggleReaction`).
- **Idempotency:** via `by_confession` index lookup before insert.
- **Race protection:** at store level (`threadCreationInProgress` Set); no equivalent server-side guard (Convex transaction guarantees mostly cover, but two near-simultaneous calls from different clients could both pass the existence check; this is a **theoretical P2** because Convex mutations are serializable per document, mitigated for the same `by_confession` query but not guaranteed).
- **Both-sided creation:** thread is created on one side's reaction. The confessor has no say.
- **Promotion to Phase-1:** no live path; demo only via `createRevealMatch`.
- **Cleanup:** local-only (`removeConfessionThreads`, `purgeExpiredNow`); server rows persist past `expiresAt` until manual sweep.

---

## L. UI / UX assessment

- `confession-chat.tsx` has well-built reveal states (status text, banner, action buttons, expiry overrides) — but it's all decoration over a state that doesn't synchronize.
- `comment-connect-requests.tsx` is a "Coming Soon" stub.
- `ConfessionCard.tsx` advertises `onConnect`/`isConnected` props that no one uses.
- No "pending Connect from X" inbox surface in live mode.
- No haptic / toast confirmation on the tagged-user reaction that creates the thread (so the user doesn't realize a chat was just created).
- `mode=confess_reveal` navigation lands on a profile that doesn't recognize that mode.

---

## M. Demo vs Live divergence

| Surface | Demo | Live |
|---|---|---|
| Confession chats list | seeded from `DEMO_CONFESSION_CHATS` | not loaded from Convex into the store at all |
| Reveal status | Zustand | Zustand (same) |
| Connect → conversation | `useDemoDmStore` + `useDemoStore` (`connectToConfession`) | `convex/confessions.toggleReaction` auto-creates on reaction |
| `createRevealMatch` (permanent match) | Demo stores create real match | **No-op for live users** (only demo stores called) |
| Profile reveal navigation | Same as live | Same — `confess_reveal` mode unhandled |

---

## N. Backend mutations / queries inventory (Confess scope)

**Exists:**
- `confessions.createConfession`, `listConfessions`, `getTrendingConfessions`, `getConfession`
- `confessions.createReply`, `updateReply`, `deleteReply`, `getReplies`, `getMyReplyForConfession`
- `confessions.toggleReaction`, `getReactionCounts`, `getUserReaction`
- `confessions.getMyConfessions`, `reportConfession`, `reportReply`
- `confessions.getTaggedConfessionBadgeCount`, `listTaggedConfessionsForUser`, `markTaggedConfessionsSeen`
- `confessions.canUseConfessTagActions`, `consumeConfessionTagProfileViewGrant`
- `confessions.getOrCreateForConfession`, `deleteConfession`, `updateConfession`

**Missing (to satisfy product intent):**
- `confessions.requestConnect` (tagged user → confessor)
- `confessions.respondToConnect` (confessor → accept/reject)
- `confessions.getConnectStatus` (subscribe-friendly)
- `confessions.cancelConnect`
- `confessions.promoteToPhase1` (atomic: set `isPreMatch:false`, clear `anonymousParticipantId`, clear `expiresAt`, set `connectionSource:'confession'`)
- A `crons.ts` job to sweep expired confession conversations server-side.

---

## O. Schema gap

Required additions (none today):

```
confessionConnects: defineTable({
  confessionId: v.id('confessions'),
  fromUserId: v.id('users'),       // tagged user (always initiator)
  toUserId: v.id('users'),          // confession author
  status: v.union(
    v.literal('pending'),
    v.literal('mutual'),
    v.literal('rejected_by_to'),
    v.literal('cancelled_by_from'),
    v.literal('expired'),
  ),
  conversationId: v.optional(v.id('conversations')),
  createdAt: v.number(),
  respondedAt: v.optional(v.number()),
  expiresAt: v.number(),            // 24h
})
  .index('by_confession', ['confessionId'])
  .index('by_from_to', ['fromUserId', 'toUserId'])
  .index('by_to_status', ['toUserId', 'status'])
```

Plus `notifications` types: `confession_connect_requested`, `confession_connect_accepted`, `confession_connect_rejected`.

Plus deprecate `confessionReplies.hasActiveConnectRequest`.

---

## P. Typecheck / codegen status

- `npx convex codegen` → **exit 0, clean**.
- `npx tsc --noEmit` → **9 errors, NONE in Confess flow files**:
  - `app/(onboarding)/additional-photos.tsx` (×2): `verificationReferencePhotoUrl`, `verificationReferencePhotoId`
  - `app/(onboarding)/basic-info.tsx`: `nickname` not found
  - `app/(onboarding)/face-verification.tsx`: `skipDemoFaceVerification`
  - `app/index.tsx`: nullable string narrowing
  - `components/profile/ProfileQuickMenu.tsx`: `getCurrentUserFromToken`
  - `components/ui/SkeletonCard.tsx` (×2): `LinearGradient` colors tuple type
- **Verdict: zero typecheck errors in `app/(main)/confession-*.tsx`, `components/confessions/*`, `convex/confessions.ts`, `stores/confessionStore.ts`, `types/index.ts` confession types.** The Confess Connect–Reject scope is type-clean today.

---

## Q. Final verdict

**Beta-ready?** No.
**Production-ready?** No.

The shipped Confess flow is **a one-sided silent thread-creation followed by a client-only Mutual-Reveal mini-game**. It does not implement the user's described product intent (tagged user Connect/Reject → confessor Connect/Reject → real Phase-1 thread on mutual). It cannot survive an app restart. It cannot synchronize between the two parties' devices. The "permanent match on mutual reveal" is demo-only.

**The audit-grade summary in one sentence:** *Everything user-visible exists; almost nothing is backend-authoritative; a true Connect/Reject feature has not been built.*

---

## R. Codex-ready fix plan (4 batches)

**Batch 1 — Schema + backend foundation**
- Add `confessionConnects` table with indices above.
- Add notification types `confession_connect_requested|accepted|rejected`.
- Add mutations: `confessions.requestConnect`, `respondToConnect`, `cancelConnect`, `getConnectStatus` (query).
- Server-side gates: confession exists, not deleted, not expired, not hidden, viewer not blocked/reported by other party, viewer == `taggedUserId` for `requestConnect`, viewer == author for `respondToConnect`.
- Idempotency: `by_confession` index returns existing pending row; same caller re-request is a no-op.

**Batch 2 — Phase-1 promotion + anonymity demotion**
- New atomic mutation `confessions.promoteConfessionConnectToMatch(confessionConnectId)`:
  - Validates `status === 'mutual'`.
  - Patches the existing confession `conversations` row: `isPreMatch:false, expiresAt:undefined, anonymousParticipantId:undefined, connectionSource:'confession'`.
  - Or creates a fresh Phase-1 conversation if none.
  - Fanout `match_created`-style notification.
- Cron: server sweeper for expired pending connects and expired confession conversations.

**Batch 3 — UI rewire (tagged user side + confessor side)**
- `ConfessionCard.tsx`: wire `onConnect`/`isConnected` to `requestConnect` + `getConnectStatus`; add `onReject` prop and `rejectButton` style (only for tagged user).
- `confession-chat.tsx`: replace `agreeMutualReveal`/`declineMutualReveal` Zustand calls with `requestConnect`/`respondToConnect`/`cancelConnect` mutations + `getConnectStatus` query subscription. Keep the existing UI shell — just swap the data source.
- Build a real `comment-connect-requests.tsx` inbox screen that lists `getPendingConnectsForMe` for the confessor.
- Handle `mode=confess_reveal` in `app/(main)/profile/[id].tsx` (deep-link target on mutual).

**Batch 4 — Cleanup + parity**
- Remove demo-only `connectToConfession`, `createRevealMatch`, `connectedConfessionIds`, `revealSkippedChats`, `confessionThreads` from the store (or keep as a thin demo-fallback layer behind `isDemoMode`).
- Drop legacy `confessionReplies.hasActiveConnectRequest`.
- Drop legacy `targetUserId` fallback in `getTaggedUserId`.
- Add unit tests covering: request → cancel → re-request idempotency; mutual → Phase-1 promotion; reject → cannot re-request within window; expired confession blocks all four mutations; blocked/reported parties cannot request/accept.
- Hard-delete `comment-connect-requests` "BLOCKED" stub once the live inbox lands.

---

## S. Manual real-device test checklist (post-fix)

- [ ] Two devices, real Convex backend. User A confesses tagging User B.
- [ ] User B sees "Connect / Reject" on the tagged confession (feed and "Tagged for you").
- [ ] User B taps Connect → `confessionConnects` row inserted (status `pending`); User A receives a notification within real-time delay.
- [ ] User A opens connect inbox → sees pending request.
- [ ] User A taps Accept → status flips to `mutual`; `promoteConfessionConnectToMatch` runs; both devices show the conversation in Phase-1 Messages with `anonymousParticipantId` cleared.
- [ ] Force-close + reopen both apps → state persists on both sides.
- [ ] Repeat with User A tapping Reject → status flips to `rejected_by_to`; User B sees a "Request was declined" state and cannot re-request until either confession expiry or product policy allows.
- [ ] User B blocks User A mid-flow → pending row is hard-failed at `respondToConnect`.
- [ ] Confession expires → all pending connect rows expire; Phase-1 conversations created before expiry persist.
- [ ] Anonymous confession path: until `mutual`, B cannot see A's profile / name / photo on either the confession card or the conversation thread.
- [ ] Cross-device convergence: B sees A's accept within ~1s; no reload required.
- [ ] Demo-mode parity: same affordances; demo store mirrors backend semantics.

---

## T. Risk register if shipped as-is

1. **User believes their identity is gated by mutual reveal**, but in live mode anonymity is governed solely by `anonymousParticipantId`, set once at conversation insert; any future code path reading `participants` directly bypasses this. Mid-severity privacy risk.
2. **Two-device user expects to see Connect across reinstall** — won't.
3. **Tagged user expects Reject** — affordance missing; only "do nothing" works.
4. **Comment Connect Requests** route is reachable in some entry points; user lands on "Coming Soon" — broken-promise UX.
5. **Confession conversations accumulate forever** server-side past `expiresAt` (no cron sweeper).

---

## U. Confirm no code changed, no commit, no push

- **No code changed.** This audit only used Read / Grep / Glob / Bash-status / Bash-codegen / Bash-typecheck.
- **No commit.** Working tree remains clean at `dbac695` on `feature/bg-crossed-paths`.
- **No push.** No `git push` was issued.
- The two malware-analysis system-reminders that fired on file Reads were respected: this is a legitimate dating-app codebase with no malware indicators (no obfuscation, no exfiltration, no privilege escalation, no hidden persistence). No code was improved or augmented.
