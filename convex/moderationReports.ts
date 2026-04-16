import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { Id } from './_generated/dataModel';

type EvidenceItem = { storageId: Id<'_storage'>; type: 'photo' | 'video' };
type BehaviorFlagSummary = {
  flagId: Id<'behaviorFlags'>;
  flagType: string;
  severity: 'low' | 'medium' | 'high';
  description?: string;
  createdAt: number;
};

async function resolveUserSummary(ctx: any, userId: Id<'users'>) {
  const user = await ctx.db.get(userId);
  if (!user) {
    return { userId, name: 'Unknown', photoUrl: null as string | null };
  }
  return {
    userId,
    name: user.name || 'Unknown',
    photoUrl: user.primaryPhotoUrl || null,
  };
}

async function resolveEvidenceUrls(ctx: any, evidence: EvidenceItem[] | undefined) {
  if (!evidence || evidence.length === 0) return [];
  const resolved = await Promise.all(
    evidence.map(async (e) => {
      const url = await ctx.storage.getUrl(e.storageId);
      return {
        storageId: e.storageId,
        type: e.type,
        url,
      };
    })
  );
  return resolved;
}

async function resolveActiveFlagsForUser(ctx: any, userId: Id<'users'>): Promise<BehaviorFlagSummary[]> {
  const flags = await ctx.db
    .query('behaviorFlags')
    .withIndex('by_user', (q: any) => q.eq('userId', userId))
    .collect();

  // Treat flags without resolvedAt as active
  const active = flags.filter((f: any) => !f.resolvedAt);

  return active.map((f: any) => ({
    flagId: f._id as Id<'behaviorFlags'>,
    flagType: f.flagType as string,
    severity: f.severity as 'low' | 'medium' | 'high',
    description: f.description as string | undefined,
    createdAt: f.createdAt as number,
  }));
}

/**
 * Require admin access using session token (matches adminLog.ts pattern).
 */
async function requireAdmin(ctx: any, token: string) {
  const now = Date.now();

  const session = await ctx.db
    .query('sessions')
    .withIndex('by_token', (q: any) => q.eq('token', token))
    .first();

  if (!session || session.expiresAt < now) {
    throw new Error('Unauthorized: Invalid or expired session');
  }

  const user = await ctx.db.get(session.userId);
  if (!user || !user.isActive || user.isBanned) {
    throw new Error('Unauthorized: Invalid user');
  }

  if (user.sessionsRevokedAt && session.createdAt < user.sessionsRevokedAt) {
    throw new Error('Unauthorized: Session revoked');
  }

  if (!user.isAdmin) {
    throw new Error('Unauthorized: Admin access required');
  }

  return user;
}

export const listRecentReports = query({
  args: {
    token: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const limit = Math.max(1, Math.min(args.limit ?? 50, 200));

    // Note: ordering by document creation time (desc). The report has its own `createdAt` field too.
    const reports = await ctx.db.query('reports').order('desc').take(limit);

    const enriched = await Promise.all(
      reports.map(async (r: any) => {
        const [reporter, reportedUser, evidence, reportedUserFlags] = await Promise.all([
          resolveUserSummary(ctx, r.reporterId),
          resolveUserSummary(ctx, r.reportedUserId),
          resolveEvidenceUrls(ctx, r.evidence as EvidenceItem[] | undefined),
          resolveActiveFlagsForUser(ctx, r.reportedUserId as Id<'users'>),
        ]);

        const repeatedReportFlag = reportedUserFlags.find((f) => f.flagType === 'reported_by_multiple') || null;

        return {
          reportId: r._id as Id<'reports'>,
          reporter,
          reportedUser,
          reason: r.reason as string,
          description: r.description as string | undefined,
          evidence,
          reportedUserFlags,
          repeatedReportFlag,
          status: r.status as string,
          createdAt: r.createdAt as number,
        };
      })
    );

    return enriched;
  },
});

export const getReportById = query({
  args: {
    token: v.string(),
    reportId: v.id('reports'),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const r: any = await ctx.db.get(args.reportId);
    if (!r) return null;

    const [reporter, reportedUser, evidence, reportedUserFlags] = await Promise.all([
      resolveUserSummary(ctx, r.reporterId),
      resolveUserSummary(ctx, r.reportedUserId),
      resolveEvidenceUrls(ctx, r.evidence as EvidenceItem[] | undefined),
      resolveActiveFlagsForUser(ctx, r.reportedUserId as Id<'users'>),
    ]);

    return {
      reportId: r._id as Id<'reports'>,
      reporter,
      reportedUser,
      reason: r.reason as string,
      description: r.description as string | undefined,
      evidence,
      reportedUserFlags,
      status: r.status as string,
      createdAt: r.createdAt as number,
    };
  },
});

export const updateReportStatus = mutation({
  args: {
    token: v.string(),
    reportId: v.id('reports'),
    status: v.union(v.literal('pending'), v.literal('reviewed'), v.literal('resolved')),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const existing: any = await ctx.db.get(args.reportId);
    if (!existing) {
      return { success: false, error: 'not_found' as const };
    }

    const now = Date.now();
    const patch: Record<string, unknown> = { status: args.status };
    if (args.status === 'reviewed' || args.status === 'resolved') {
      patch.reviewedAt = now;
    }

    await ctx.db.patch(args.reportId, patch);
    return { success: true };
  },
});

