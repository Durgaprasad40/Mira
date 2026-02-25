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

*To request an unlock, Durgaprasad must explicitly state the unlock in a message.*

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
