// Private Mode Intent Categories — admin-defined, no user creation
export const PRIVATE_INTENT_CATEGORIES = [
  { key: 'casual_connection', label: 'Casual connection', icon: 'heart-half', color: '#E91E63' },
  { key: 'fling', label: 'Fling', icon: 'flash', color: '#FF5722' },
  { key: 'flirty_chats', label: 'Flirty chats', icon: 'chatbubble-ellipses', color: '#6C5CE7' },
  { key: 'situationship', label: 'Situationship', icon: 'shuffle', color: '#FF9800' },
  { key: 'fwb', label: 'Friends with benefits', icon: 'people', color: '#F44336' },
  { key: 'low_commitment', label: 'Low-commitment', icon: 'leaf', color: '#4CAF50' },
  { key: 'discreet', label: 'Discreet', icon: 'eye-off', color: '#607D8B' },
  { key: 'open_to_exploring', label: 'Open to exploring', icon: 'compass', color: '#00BCD4' },
  { key: 'chat_first', label: 'Chat first', icon: 'chatbubbles', color: '#795548' },
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
  { key: 'open_minded', label: 'Open-minded' },
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

export type PrivateIntentKey = typeof PRIVATE_INTENT_CATEGORIES[number]['key'];
export type PrivateDesireTagKey = typeof PRIVATE_DESIRE_TAGS[number]['key'];
export type PrivateBoundaryKey = typeof PRIVATE_BOUNDARIES[number]['key'];
