import { Doc, Id } from '../_generated/dataModel';
import { MutationCtx, QueryCtx } from '../_generated/server';

type UserPolicyCtx = QueryCtx | MutationCtx;

export function hasAcceptedChatRoomTerms(user: Doc<'users'> | null | undefined): boolean {
  return !!(
    user?.consentAcceptedAt &&
    user.termsAcceptedAt &&
    user.communityGuidelinesAcceptedAt
  );
}

export async function requireChatRoomTermsAccepted(
  ctx: UserPolicyCtx,
  userId: Id<'users'>
): Promise<Doc<'users'>> {
  const user = await ctx.db.get(userId);
  if (!user || !hasAcceptedChatRoomTerms(user)) {
    throw new Error('TERMS_REQUIRED');
  }
  return user;
}

function getAgeFromDateOfBirth(dateOfBirth: string | undefined, now: Date): number | null {
  if (!dateOfBirth) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const birth = new Date(Date.UTC(year, month - 1, day));
  if (
    birth.getUTCFullYear() !== year ||
    birth.getUTCMonth() !== month - 1 ||
    birth.getUTCDate() !== day
  ) {
    return null;
  }

  let age = now.getUTCFullYear() - year;
  const birthdayThisYear = Date.UTC(now.getUTCFullYear(), month - 1, day);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (today < birthdayThisYear) {
    age -= 1;
  }
  return age;
}

export function isUserAdultForPrivateRooms(user: Doc<'users'> | null | undefined): boolean {
  const age = getAgeFromDateOfBirth(user?.dateOfBirth, new Date());
  return age !== null && age >= 18;
}

export async function requirePrivateRoomAdult(
  ctx: UserPolicyCtx,
  userId: Id<'users'>
): Promise<Doc<'users'>> {
  const user = await ctx.db.get(userId);
  if (!user || !isUserAdultForPrivateRooms(user)) {
    throw new Error('AGE_RESTRICTED_PRIVATE_ROOM');
  }
  return user;
}
