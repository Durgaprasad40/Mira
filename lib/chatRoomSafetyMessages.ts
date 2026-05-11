const LINK_MESSAGE = 'For your safety, links are limited to YouTube for now.';
const CONTACT_MESSAGE = 'For safety, please keep social handles and contact info inside Mira.';
const PAYMENT_MESSAGE = 'Payments and financial details can’t be shared in chat.';
const EXPLICIT_MESSAGE = 'This message can’t be sent here. Please review the community guidelines.';
const SAFETY_MESSAGE = 'This message can’t be sent. Please keep conversations safe and respectful.';
const SPAM_MESSAGE = 'Looks like a duplicate message. Please rephrase.';
const MENTION_FLOOD_MESSAGE = 'You can mention up to 5 people per message.';
const DM_UNAVAILABLE_MESSAGE = 'You can’t message this person right now.';
export const CHAT_ROOM_TERMS_REQUIRED_MESSAGE =
  'Please accept Mira’s Terms, Privacy Policy, and Community Guidelines to continue.';

type ParsedBlockReason = {
  code: string;
  category?: string;
};

function readErrorData(error: unknown): ParsedBlockReason | null {
  const data = (error as { data?: { code?: unknown; category?: unknown; message?: unknown } } | null | undefined)
    ?.data;
  if (!data || typeof data.code !== 'string') return null;
  return {
    code: data.code,
    category: typeof data.category === 'string' ? data.category : undefined,
  };
}

function getErrorText(error: unknown): string {
  const message = (error as { message?: unknown } | null | undefined)?.message;
  const data = (error as { data?: unknown } | null | undefined)?.data;
  const parts = [
    typeof message === 'string' ? message : '',
    typeof data === 'string' ? data : '',
    typeof data === 'object' && data ? JSON.stringify(data) : '',
    String(error ?? ''),
  ];
  return parts.filter(Boolean).join(' ');
}

export function isChatRoomTermsRequiredError(error: unknown): boolean {
  return getErrorText(error).includes('TERMS_REQUIRED');
}

function parseStringReason(text: string): ParsedBlockReason | null {
  const direct = /\b(LINK_BLOCKED|CONTACT_BLOCKED|PAYMENT_BLOCKED|EXPLICIT_BLOCKED|SAFETY_BLOCKED|SPAM_BLOCKED|MENTION_FLOOD)(?::([a-z_]+))?\b/i.exec(text);
  if (direct) {
    return {
      code: direct[1].toUpperCase(),
      category: direct[2]?.toLowerCase(),
    };
  }

  const jsonCode = /"code"\s*:\s*"(LINK_BLOCKED|CONTACT_BLOCKED|PAYMENT_BLOCKED|EXPLICIT_BLOCKED|SAFETY_BLOCKED|SPAM_BLOCKED|MENTION_FLOOD)"/i.exec(text);
  if (!jsonCode) return null;
  const jsonCategory = /"category"\s*:\s*"([a-z_]+)"/i.exec(text);
  return {
    code: jsonCode[1].toUpperCase(),
    category: jsonCategory?.[1]?.toLowerCase(),
  };
}

function isDmUnavailableError(text: string): boolean {
  return (
    text.includes('You can no longer message members of this room.') ||
    text.includes("You can't message this user right now") ||
    text.includes('Cannot start conversation') ||
    text.includes('Both users must be in this room')
  );
}

export function describeChatRoomBlockReason(error: unknown): string | null {
  const errorText = getErrorText(error);
  if (isDmUnavailableError(errorText)) {
    return DM_UNAVAILABLE_MESSAGE;
  }

  const reason = readErrorData(error) ?? parseStringReason(errorText);
  if (!reason) return null;

  switch (reason.code) {
    case 'LINK_BLOCKED':
      return ['social', 'telegram', 'whatsapp'].includes(reason.category ?? '')
        ? CONTACT_MESSAGE
        : LINK_MESSAGE;
    case 'CONTACT_BLOCKED':
      return CONTACT_MESSAGE;
    case 'PAYMENT_BLOCKED':
      return PAYMENT_MESSAGE;
    case 'EXPLICIT_BLOCKED':
      return EXPLICIT_MESSAGE;
    case 'SAFETY_BLOCKED':
      return SAFETY_MESSAGE;
    case 'SPAM_BLOCKED':
      return SPAM_MESSAGE;
    case 'MENTION_FLOOD':
      return MENTION_FLOOD_MESSAGE;
    default:
      return null;
  }
}
