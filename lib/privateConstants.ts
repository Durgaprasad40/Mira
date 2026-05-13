// Private Mode Intent Categories — admin-defined, no user creation
// Phase 2 only — these categories do NOT appear in Phase 1
export const PRIVATE_INTENT_CATEGORIES = [
  { key: 'fling', label: 'Fling', icon: 'flash', color: '#FF5722' },
  { key: 'short_term', label: 'Short-term', icon: 'time', color: '#FF9800' },
  { key: 'fwb', label: 'Friends with Benefits', icon: 'people-circle', color: '#F44336' },
  { key: 'situationship', label: 'Situationship', icon: 'shuffle', color: '#E91E63' },
  { key: 'go_with_the_flow', label: 'Go with the Flow', icon: 'water', color: '#00BCD4' },
  { key: 'friends_first', label: 'Friends First', icon: 'people', color: '#2196F3' },
  { key: 'late_night', label: 'Late Night', icon: 'moon-outline', color: '#3F51B5' },
  { key: 'weekend_thing', label: 'Weekend Thing', icon: 'calendar', color: '#795548' },
  { key: 'see_where_it_goes', label: 'See Where It Goes', icon: 'help-circle', color: '#9E9E9E' },
] as const;

// Private Mode Desire Tags — chip picker options
export const PRIVATE_DESIRE_TAGS = [
  { key: 'spontaneous', label: 'Spontaneous' },
  { key: 'deep_conversations', label: 'Deep conversations' },
  { key: 'physical_chemistry', label: 'Physical chemistry' },
  { key: 'emotional_connection', label: 'Emotional connection' },
  { key: 'no_strings', label: 'No strings' },
  { key: 'travel_partner', label: 'Travel partner' },
  { key: 'late_night_talks', label: 'Late night talks' },
  { key: 'adventure_seeker', label: 'Adventure seeker' },
  { key: 'romantic_gestures', label: 'Romantic gestures' },
  { key: 'humor_wit', label: 'Humor & wit' },
  { key: 'intellectual_match', label: 'Intellectual match' },
  { key: 'creative_energy', label: 'Creative energy' },
  { key: 'fitness_partner', label: 'Fitness partner' },
  { key: 'slow_burn', label: 'Slow burn' },
  { key: 'confident_energy', label: 'Confident energy' },
  { key: 'mystery', label: 'Mystery' },
  { key: 'eye_contact', label: 'Eye contact' },
  { key: 'respectful_flirting', label: 'Respectful flirting' },
  { key: 'mutual_attraction', label: 'Mutual attraction' },
] as const;

// Private Mode Boundaries — must select at least 2
export const PRIVATE_BOUNDARIES = [
  { key: 'respect_consent', label: 'Consent is non-negotiable' },
  { key: 'no_pressure', label: 'No pressure to meet' },
  { key: 'safe_space', label: 'Safe space for expression' },
  { key: 'clear_communication', label: 'Clear communication' },
  { key: 'no_unsolicited_content', label: 'No unsolicited explicit content' },
  { key: 'mutual_respect', label: 'Mutual respect always' },
  { key: 'right_to_withdraw', label: 'Right to withdraw anytime' },
  { key: 'privacy_protected', label: 'Privacy protected' },
  { key: 'no_sharing_screenshots', label: 'No sharing or screenshots' },
  { key: 'meet_when_ready', label: 'Meet only when both ready' },
] as const;

// NOTE: PrivateIntentKey, PrivateDesireTag, PrivateBoundary types are defined in types/index.ts

// ============================================================
// Phase-2 Onboarding Prompts (Step 3)
// ============================================================

// Section 1: Multiple Choice Prompts (1-3)
export const PHASE2_SECTION1_PROMPTS = [
  {
    id: 'prompt_1',
    question: 'What matters most to you when meeting someone new?',
    options: [
      'Emotional connection',
      'Physical attraction',
      'Shared values and life goals',
      'Fun and adventure together',
      'Intellectual conversations',
    ],
  },
  {
    id: 'prompt_2',
    question: 'What type of relationship are you currently looking for?',
    options: [
      'A serious long-term relationship',
      'Something casual and fun',
      'Open to anything that feels right',
      'Friendship first, then see where it goes',
      'Just exploring and meeting people',
    ],
  },
  {
    id: 'prompt_3',
    question: 'Which kind of personality attracts you the most?',
    options: [
      'Kind and emotionally supportive',
      'Confident and ambitious',
      'Funny and playful',
      'Calm and mature',
      'Adventurous and spontaneous',
    ],
  },
] as const;

// Section 2: Text Input Prompts (4-6)
export const PHASE2_SECTION2_PROMPTS = [
  {
    id: 'prompt_4',
    question: 'What does your ideal relationship look like?',
  },
  {
    id: 'prompt_5',
    question: 'What kind of connection are you hoping to build here?',
  },
  {
    id: 'prompt_6',
    question: 'What is one thing you value deeply in a partner?',
  },
] as const;

// Section 3: Text Input Prompts (7-9)
export const PHASE2_SECTION3_PROMPTS = [
  {
    id: 'prompt_7',
    question: 'What makes you different from most people?',
  },
  {
    id: 'prompt_8',
    question: 'What are you most passionate about in life right now?',
  },
  {
    id: 'prompt_9',
    question: 'What kind of people do you enjoy spending time with the most?',
  },
] as const;

// All prompts combined for easy lookup
export const PHASE2_ALL_PROMPTS = [
  ...PHASE2_SECTION1_PROMPTS,
  ...PHASE2_SECTION2_PROMPTS,
  ...PHASE2_SECTION3_PROMPTS,
] as const;

// ============================================================
// Phase-2 prompt section / priority lookup
//   Used by the Discover card planner to push typed Personality /
//   Values prompts to the front of the deck and demote multiple-choice
//   "Quick" prompts to the tail. promptId is the only piece of section
//   metadata that survives backend storage, so this is a pure client-side
//   reverse-lookup against the catalog above.
// ============================================================

export type Phase2PromptSection =
  | 'personality' // Section 3 — typed
  | 'values'      // Section 2 — typed
  | 'quick'       // Section 1 — multiple-choice
  | 'unknown';    // legacy / off-catalog

// Lower = shown earlier on the card.
export const PHASE2_PROMPT_PRIORITY: Record<Phase2PromptSection, number> = {
  personality: 0,
  values: 1,
  quick: 2,
  unknown: 3,
};

// Display label rendered above the prompt body on the Phase-2 card.
export const PHASE2_PROMPT_SECTION_LABEL: Record<Phase2PromptSection, string> = {
  personality: 'PERSONALITY',
  values: 'VALUES',
  quick: 'QUICK QUESTION',
  unknown: 'PROMPT',
};

const PHASE2_PROMPT_SECTION_BY_ID: Record<string, Phase2PromptSection> = (() => {
  const map: Record<string, Phase2PromptSection> = {};
  for (const p of PHASE2_SECTION3_PROMPTS) map[p.id] = 'personality';
  for (const p of PHASE2_SECTION2_PROMPTS) map[p.id] = 'values';
  for (const p of PHASE2_SECTION1_PROMPTS) map[p.id] = 'quick';
  return map;
})();

export function getPhase2PromptSection(
  promptId?: string | null,
): Phase2PromptSection {
  if (!promptId) return 'unknown';
  return PHASE2_PROMPT_SECTION_BY_ID[promptId] ?? 'unknown';
}

// Type for prompt answer
export interface Phase2PromptAnswer {
  promptId: string;
  question: string;
  answer: string; // Selected option for Section 1, typed text for Section 2/3
}

// Validation constants
export const PHASE2_PROMPT_MIN_TEXT_LENGTH = 20; // Minimum characters for text answers
export const PHASE2_PROMPT_MAX_TEXT_LENGTH = 200; // Maximum characters for text answers

// ============================================================
// Phase-2 Preference Strength (Ranking Signal)
// ============================================================

export type PreferenceStrengthValue =
  | 'not_important'
  | 'slight_preference'
  | 'important'
  | 'deal_breaker';

export type IntentMatchValue =
  | 'not_important'
  | 'prefer_similar'
  | 'important'
  | 'must_match_exactly';

export interface PreferenceStrength {
  smoking: PreferenceStrengthValue | null;
  drinking: PreferenceStrengthValue | null;
  intent: IntentMatchValue | null;
}

export const PREFERENCE_STRENGTH_OPTIONS: readonly { value: PreferenceStrengthValue; label: string }[] = [
  { value: 'not_important', label: 'Not important' },
  { value: 'slight_preference', label: 'Slight preference' },
  { value: 'important', label: 'Important' },
  { value: 'deal_breaker', label: 'Deal breaker' },
] as const;

export const INTENT_MATCH_OPTIONS: readonly { value: IntentMatchValue; label: string }[] = [
  { value: 'not_important', label: 'Not important' },
  { value: 'prefer_similar', label: 'Prefer similar' },
  { value: 'important', label: 'Important' },
  { value: 'must_match_exactly', label: 'Must match exactly' },
] as const;
