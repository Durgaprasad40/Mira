# LOCKS.md

This file records locked areas of the codebase that must not be modified without explicit authorization.

---

## LOCKED: Full Onboarding Flow

- **Scope:** `app/(onboarding)/**`
- **Locked by:** Durgaprasad
- **Date:** 2026-02-24
- **Rule:** No changes allowed unless Durgaprasad explicitly unlocks (says "UNLOCK onboarding" or names a specific file).
- **Includes:** All screens, routes, UI, logic, styles, navigation, and behavior within the onboarding directory.

---

## LOCKED: Keyboard Behavior (Global)

- **Scope:** All keyboard-related behavior across the entire codebase
- **Locked by:** Durgaprasad
- **Date:** 2026-02-24
- **Rule:** Do not modify any keyboard handling, KeyboardAvoidingView props, keyboard listeners, or keyboard-related styling.
- **Note:** Onboarding inherits this global lock.

---

## LOCKED: Chat Composer (+ Menu) Behavior

- **Scope:** `components/chat/MessageInput.tsx` — specifically the + button menu, attachment handling, and voice recording trigger
- **Locked by:** Durgaprasad
- **Date:** 2025-02-25
- **Rule:** Do not modify the + menu UI, menu item handlers (Camera/Gallery/Voice), or the popup behavior without explicit approval.
- **Note:** The existing secure photo flow (CameraPhotoSheet) remains unchanged; only the entry point (+ menu) is locked.

---

## LOCKED: Confessions Feature

- **Scope:**
  - `app/(main)/(tabs)/confessions.tsx` — Confess feed screen
  - `app/(main)/confession-thread.tsx` — Confession reply thread
  - `app/(main)/confession-chat.tsx` — Anonymous chat between confessor and tagged user
  - `components/confessions/**` — All confession UI components
  - `stores/confessionStore.ts` — Confession state management
  - `lib/confessionsIntegrity.ts` — Confession expiry and integrity logic
  - `app/(main)/profile/[id].tsx` — Only `confess_preview` and `confess_reveal` modes
  - Related type definitions in `types/index.ts` for Confession types
- **Locked by:** Durgaprasad
- **Date:** 2026-02-26
- **Rule:** No changes allowed unless Durgaprasad explicitly unlocks.
- **Future work allowed:** Bug fixes and stability improvements ONLY if explicitly requested.

---

---

## LOCKED: Profile Tab — FINAL & FROZEN

- **Scope:**
  - `app/(main)/(tabs)/profile.tsx` — Profile tab main screen
  - `app/(main)/edit-profile.tsx` — Edit Profile screen
  - `app/(main)/profile/[id].tsx` — Profile view screen (non-confession modes)
  - `app/(main)/settings/**` — All settings screens:
    - `privacy.tsx` — Privacy settings
    - `safety.tsx` — Safety & Verification settings
    - `blocked-users.tsx` — Blocked users management
    - `report-user.tsx` — Report user flow
    - `account.tsx` — Account settings (logout, delete)
    - `help.tsx` — Help & Support
    - `notifications.tsx` — Notification settings
  - `stores/verificationStore.ts` — Face & KYC verification state
  - `stores/photoBlurStore.ts` — Per-photo blur settings
  - `stores/blockStore.ts` — Block list management
- **Locked by:** Durgaprasad
- **Date:** 2026-02-26
- **Rule:**
  - ❌ No UI, UX, flow, logic, limits, copy, layout, or behavior changes
  - ❌ No refactoring, optimization, renaming, or "improvements"
  - ❌ No enhancement suggestions or alternatives
  - ✅ ONLY critical bug fixes (crash, broken navigation, data corruption)
  - 🚫 Non-critical changes require explicit approval from Durgaprasad
- **Status:** Production-ready and frozen

---

*To request an unlock, Durgaprasad must explicitly state the unlock in a message.*

---

## LOCKED: Phase-1 Tabs (Tab-by-tab Freeze)

- **Locked by:** Durgaprasad
- **Date:** 2026-02-26
- **Rule:** No changes allowed unless Durgaprasad explicitly unlocks.
- **Status:** Phase-1 complete, stable, and frozen for beta.

### 1. Discover Tab (Phase-1)
- **Scope:**
  - `app/(main)/(tabs)/home.tsx` — Discover tab entry point
  - `components/screens/DiscoverCardStack.tsx` — Card stack logic and UI
  - `components/cards/ProfileCard.tsx` — Profile card component
  - Related Convex queries in `convex/discover.ts`
- **Status:** Locked — swipe logic, filters, and card rendering frozen.

### 2. Explore Tab (Phase-1)
- **Scope:**
  - `app/(main)/(tabs)/explore.tsx` — Explore category browsing
  - Related explore queries and pagination behavior
- **Status:** Locked — category browsing frozen as currently implemented.

### 3. Confessions Tab (Phase-1)
- **Scope:** See "LOCKED: Confessions Feature" section above.
- **Status:** Already locked — no additional changes.

### 4. Nearby Tab (Phase-1)
- **Scope:**
  - `app/(main)/(tabs)/nearby.tsx` — Map-based discovery
  - Location-based filtering and display logic
- **Status:** Locked — nearby discovery frozen as currently implemented.

### 5. Messages Tab (Phase-1)
- **Scope:**
  - `app/(main)/(tabs)/messages/` — All chat list and chat screens
  - `app/(main)/(tabs)/messages/index.tsx` — Messages list
  - `app/(main)/(tabs)/messages/chat/[conversationId].tsx` — Chat screen
  - `components/screens/ChatScreenInner.tsx` — Chat logic
  - `components/chat/**` — Chat UI components
  - `stores/demoDmStore.ts` — Demo messaging state
  - Blocking from chat behavior
- **Status:** Locked — messaging, read receipts, and blocking behavior frozen.

### 6. Profile Tab (Phase-1)
- **Scope:** See "LOCKED: Profile Tab — FINAL & FROZEN" section above.
- **Status:** Already locked — no additional changes.

### 7. Safety & Settings (Phase-1)
- **Scope:**
  - `app/(main)/settings/**` — All settings screens
  - `stores/verificationStore.ts` — Face & KYC verification
  - `stores/privacyStore.ts` — Privacy settings persistence
  - `stores/blockStore.ts` — Block list management
  - `stores/photoBlurStore.ts` — Photo blur settings
- **Status:** Locked — Face Verification, KYC, Blocking, Reporting, Account Deletion frozen.

---

## OPEN: Private Tab (Phase-2 work allowed)

- **Scope:** `app/(main)/(tabs)/incognito.tsx` — Private/Incognito tab
- **Status:** **NOT LOCKED** — Phase-2 development will happen here.
- **Note:** This tab is explicitly excluded from the Phase-1 freeze.

---

## Onboarding Page Stability Log

Each onboarding page with a one-line summary of why it is considered stable.

- **Welcome**
  Locked: Entry point only, no logic or state.

- **Email/Phone**
  Locked: Input validation stable, no pending issues.

- **OTP**
  Locked: Verification flow stable, no pending issues.

- **Password**
  Locked: Password creation stable, SafeAreaView fixed.

- **Basic Info**
  Locked: Identity fields stable, nickname availability cleanup applied.

- **Consent**
  Locked: Terms acceptance stable, no pending issues.

- **Prompts**
  Locked: Prompt selection stable, Previous navigation fixed.

- **Profile Details**
  Locked: Height, job, education & religion merged and stable.

- **Lifestyle**
  Locked: No pending issues, navigation stable.

- **Preferences**
  Locked: Looking for, intent, filters stable.

- **Photo Upload**
  Locked: Photo overwrite bug fixed, data preserved.

- **Face Verification**
  Locked: Hydration timing fixed, no false blocking.

- **Additional Photos**
  Locked: Photo slots stable, no pending issues.

- **Permissions**
  Locked: No pending issues.

- **Review**
  Locked: Central edit hub stable, ghost data fix applied.

- **Tutorial**
  Locked: No progress bar, layout stable, button text visible.

---

## PHASE-1 TAB LOCKS (2026-03-05)

This section defines which Phase-1 tabs are LOCKED vs UNLOCKED.

### UNLOCKED TABS

| Tab | File | Status |
|-----|------|--------|
| **Nearby** | `app/(main)/(tabs)/nearby.tsx` | **UNLOCKED** — Active development allowed |

### LOCKED TABS

| Tab | Primary Files | Status |
|-----|---------------|--------|
| Tab Layout | `app/(main)/(tabs)/_layout.tsx` | LOCKED |
| Discover/Home | `app/(main)/(tabs)/home.tsx` | LOCKED |
| Explore | `app/(main)/(tabs)/explore.tsx` | LOCKED |
| Confessions | `app/(main)/(tabs)/confessions.tsx` | LOCKED (see Confessions Feature section) |
| Messages | `app/(main)/(tabs)/messages/**` | LOCKED |
| Profile | `app/(main)/(tabs)/profile.tsx` | LOCKED (see Profile Tab section) |

### Rules

- **LOCKED tabs**: No changes allowed unless Durga Prasad explicitly unlocks.
- **UNLOCKED tabs**: Development, bug fixes, and improvements are allowed.
- **Phase-1 Private area** (`app/(main)/(private)/**`): Already LOCKED — see existing rules.
- Each locked file contains a header comment block indicating its lock status.

### How to Request Unlock

To unlock a specific tab, Durga Prasad must explicitly state: "UNLOCK [tab name]" or "UNLOCK [file path]".
