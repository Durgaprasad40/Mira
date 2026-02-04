# Dev Notes — Regression Checklist

> If you change X, test Y.

## Send Hi Flow (`app/(main)/match-celebration.tsx`)

The "Say Hi" button executes a strict 3-step sequence:

1. `ensureConversation` — creates (or finds) a conversation row for the match
2. `sendMessageMut` — sends the "Hi" message into that conversation
3. `router.replace` — navigates to the chat screen

**If you change any step:**
- Verify the chat screen opens with the "Hi" message already visible (no empty flash).
- Verify tapping "Say Hi" twice rapidly does NOT send two messages or navigate twice.
- Verify demo mode still works (it bypasses steps A/B and seeds `demoDmStore` directly).
- Verify the celebration screen is NOT in the back stack after navigation (uses `replace`, not `push`).

## Demo vs Live Chat (`components/screens/ChatScreenInner.tsx`)

`isDemo` is true when:
- `isDemoMode` global flag is set, OR
- `conversationId` starts with `match_` (hardcoded demo seeds), OR
- `conversationId` starts with `demo_` (dynamically created via match-celebration)

**If you change demo detection:**
- Verify hardcoded demo matches (`match_1`, `match_2`) still open correctly.
- Verify dynamically created matches (from "Say Hi") still open correctly.
- Verify Convex queries are skipped (passed `'skip'`) in demo mode — no network calls.
- Verify live mode still works when `isDemoMode` is false.

## Loading vs Not Found (`components/screens/ChatScreenInner.tsx`)

The `!activeConversation` guard distinguishes two states:
- `conversation === undefined` → Convex query still loading → show spinner
- `conversation === null` → query returned nothing → show "Chat not found"

**If you change this guard:**
- NEVER auto-navigate away on null — the user must tap "Go Back" themselves.
- Verify slow networks show the spinner, not the error state.
- Verify invalid conversation IDs show "Chat not found" (not infinite spinner).

## Block / Report Auto-Hide (`stores/demoStore.ts`)

`reportUser()` auto-blocks (adds to `blockedUserIds`). Every consumer filters by `blockedUserIds`:
- `DiscoverCardStack` — swipe stack
- `useExploreProfiles` — explore grid
- `nearby.tsx` — nearby map/list
- `messages/index.tsx` — conversations and likes

**If you add a new screen that shows profiles:**
- It MUST filter by `blockedUserIds` in demo mode.
- Check that blocking from the chat header (3-dot menu) hides the user everywhere.
- Check that `clearSafety()` in the Demo Panel restores all hidden users.

## DEV Guards

| Guard | File | What it catches |
|-------|------|-----------------|
| Missing `conversationId` | `app/(main)/chat/[id].tsx` | Navigation bug — `console.warn` in DEV only |
| Double-press "Say Hi" | `match-celebration.tsx` | Ref-based guard (`sendingRef`) prevents duplicate sends |

## General Testing Checklist

- [ ] Swipe right on a profile → match celebration → "Say Hi" → lands in chat with message
- [ ] Block a user from chat header → they disappear from Discover, Explore, Nearby, Messages
- [ ] Report a user → auto-blocked + report stored
- [ ] Demo Panel "Reset All" → everything returns to initial state
- [ ] Open a demo chat, send messages, navigate away, come back → messages persist
- [ ] Open a live chat (non-demo) → Convex queries fire, demo store is not used
