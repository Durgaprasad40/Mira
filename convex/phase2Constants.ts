export const CURRENT_PHASE2_SETUP_VERSION = 2 as const;

export const PHASE2_SECTION1_PROMPT_IDS = [
  'prompt_1',
  'prompt_2',
  'prompt_3',
] as const;

export const PHASE2_SECTION2_PROMPT_IDS = [
  'prompt_4',
  'prompt_5',
  'prompt_6',
] as const;

export const PHASE2_SECTION3_PROMPT_IDS = [
  'prompt_7',
  'prompt_8',
  'prompt_9',
] as const;

export const PHASE2_INTENT_KEYS = [
  'fling',
  'short_term',
  'fwb',
  'situationship',
  'go_with_the_flow',
  'friends_first',
  'late_night',
  'weekend_thing',
  'see_where_it_goes',
] as const;

export const PHASE2_DESIRE_TAG_KEYS = [
  'spontaneous',
  'deep_conversations',
  'physical_chemistry',
  'emotional_connection',
  'no_strings',
  'travel_partner',
  'late_night_talks',
  'adventure_seeker',
  'romantic_gestures',
  'humor_wit',
  'intellectual_match',
  'creative_energy',
  'fitness_partner',
  'slow_burn',
  'confident_energy',
  'mystery',
  'eye_contact',
  'respectful_flirting',
  'mutual_attraction',
] as const;

export const PHASE2_BOUNDARY_KEYS = [
  'respect_consent',
  'no_pressure',
  'safe_space',
  'clear_communication',
  'no_unsolicited_content',
  'mutual_respect',
  'right_to_withdraw',
  'privacy_protected',
  'no_sharing_screenshots',
  'meet_when_ready',
] as const;

export const PHASE2_PROMPT_TEXT_ANSWER_MIN_LENGTH = 20;
export const PHASE2_PROMPT_TEXT_ANSWER_MAX_LENGTH = 200;
export const PHASE2_MAX_PROMPTS = 10;

export const PHASE2_PROMPT_CATALOG = [
  {
    id: 'prompt_1',
    question: 'What matters most to you when meeting someone new?',
    kind: 'choice',
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
    kind: 'choice',
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
    kind: 'choice',
    options: [
      'Kind and emotionally supportive',
      'Confident and ambitious',
      'Funny and playful',
      'Calm and mature',
      'Adventurous and spontaneous',
    ],
  },
  {
    id: 'prompt_4',
    question: 'What does your ideal relationship look like?',
    kind: 'text',
  },
  {
    id: 'prompt_5',
    question: 'What kind of connection are you hoping to build here?',
    kind: 'text',
  },
  {
    id: 'prompt_6',
    question: 'What is one thing you value deeply in a partner?',
    kind: 'text',
  },
  {
    id: 'prompt_7',
    question: 'What makes you different from most people?',
    kind: 'text',
  },
  {
    id: 'prompt_8',
    question: 'What are you most passionate about in life right now?',
    kind: 'text',
  },
  {
    id: 'prompt_9',
    question: 'What kind of people do you enjoy spending time with the most?',
    kind: 'text',
  },
] as const;

type Phase2PromptCatalogItem = (typeof PHASE2_PROMPT_CATALOG)[number];
export type Phase2PromptAnswerInput = {
  promptId: string;
  question?: string;
  answer: string;
};

export const PHASE2_ALLOWED_PROMPT_IDS = PHASE2_PROMPT_CATALOG.map((prompt) => prompt.id);

const PHASE2_PROMPT_BY_ID = new Map<string, Phase2PromptCatalogItem>(
  PHASE2_PROMPT_CATALOG.map((prompt) => [prompt.id, prompt])
);

export function sanitizePhase2PromptAnswersForBackend(
  promptAnswers: Phase2PromptAnswerInput[] | undefined,
):
  | { ok: true; value?: Array<{ promptId: string; question: string; answer: string }> }
  | { ok: false; error: string } {
  if (promptAnswers === undefined) {
    return { ok: true };
  }

  if (!Array.isArray(promptAnswers) || promptAnswers.length > PHASE2_MAX_PROMPTS) {
    return {
      ok: false,
      error: `promptAnswers must contain ${PHASE2_MAX_PROMPTS} or fewer items`,
    };
  }

  const byPromptId = new Map<string, Phase2PromptAnswerInput>();
  for (const prompt of promptAnswers) {
    const promptId = typeof prompt.promptId === 'string' ? prompt.promptId.trim() : '';
    if (!promptId) {
      return { ok: false, error: 'invalid_prompt_id' };
    }
    byPromptId.set(promptId, prompt);
  }

  const sanitized: Array<{ promptId: string; question: string; answer: string }> = [];
  for (const [promptId, prompt] of byPromptId) {
    const catalogPrompt = PHASE2_PROMPT_BY_ID.get(promptId);
    if (!catalogPrompt) {
      return { ok: false, error: 'invalid_prompt_id' };
    }

    const answer = typeof prompt.answer === 'string' ? prompt.answer.trim() : '';
    if (catalogPrompt.kind === 'choice') {
      const options = 'options' in catalogPrompt ? catalogPrompt.options : [];
      if (!(options as readonly string[]).includes(answer)) {
        return { ok: false, error: 'invalid_prompt_answer' };
      }
    } else if (
      answer.length < PHASE2_PROMPT_TEXT_ANSWER_MIN_LENGTH ||
      answer.length > PHASE2_PROMPT_TEXT_ANSWER_MAX_LENGTH
    ) {
      return {
        ok: false,
        error: `promptAnswers text answers must be ${PHASE2_PROMPT_TEXT_ANSWER_MIN_LENGTH}-${PHASE2_PROMPT_TEXT_ANSWER_MAX_LENGTH} characters`,
      };
    }

    sanitized.push({
      promptId: catalogPrompt.id,
      question: catalogPrompt.question,
      answer,
    });
  }

  return { ok: true, value: sanitized };
}
