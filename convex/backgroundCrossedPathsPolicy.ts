import { Doc, Id } from './_generated/dataModel';
import { MutationCtx, QueryCtx } from './_generated/server';

export const BG_CROSSED_PATHS_FEATURE_FLAG_KEY = 'bgCrossedPathsEnabled';
export const BG_CROSSED_PATHS_REQUIRED_CONSENT_VERSION = 'bg_crossed_paths_v1';

type SystemCtx = QueryCtx | MutationCtx;

export async function isBgCrossedPathsEnabled(ctx: SystemCtx): Promise<boolean> {
  const row = await ctx.db
    .query('featureFlags')
    .withIndex('by_name', (q) => q.eq('name', BG_CROSSED_PATHS_FEATURE_FLAG_KEY))
    .first();

  return row?.value === true;
}

export function hasCurrentBgCrossedPathsConsentOnUser(user: Doc<'users'>): boolean {
  return (
    typeof user.backgroundLocationConsentAt === 'number' &&
    user.backgroundLocationConsentAt > 0 &&
    user.backgroundLocationConsentVersion === BG_CROSSED_PATHS_REQUIRED_CONSENT_VERSION
  );
}

export async function getRequiredBgCrossedPathsConsentVersion(): Promise<string> {
  return BG_CROSSED_PATHS_REQUIRED_CONSENT_VERSION;
}

export async function getUserBgCrossedPathsConsent(
  ctx: SystemCtx,
  userId: Id<'users'>,
): Promise<{ version: string | null; acceptedAt: number | null }> {
  const user = await ctx.db.get(userId);
  return {
    version: user?.backgroundLocationConsentVersion ?? null,
    acceptedAt: user?.backgroundLocationConsentAt ?? null,
  };
}

export async function hasCurrentBgCrossedPathsConsent(
  ctx: SystemCtx,
  userId: Id<'users'>,
): Promise<boolean> {
  const user = await ctx.db.get(userId);
  return user ? hasCurrentBgCrossedPathsConsentOnUser(user) : false;
}
