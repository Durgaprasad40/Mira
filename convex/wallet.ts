import type { Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';

export type AwardWalletCoinsArgs = {
  userId: Id<'users'>;
  delta: number;
  reason: string;
  sourceType: string;
  sourceId?: string;
  peerUserId?: Id<'users'>;
  roomId?: Id<'chatRooms'>;
  dayKey?: string;
  dedupeKey?: string;
  createdAt?: number;
};

export type AwardWalletCoinsResult = {
  applied: boolean;
  walletCoins: number;
  duplicate?: boolean;
  ledgerId?: Id<'walletLedger'>;
};

export async function awardWalletCoins(
  ctx: MutationCtx,
  args: AwardWalletCoinsArgs
): Promise<AwardWalletCoinsResult> {
  const user = await ctx.db.get(args.userId);
  if (!user) {
    throw new Error('Wallet user not found');
  }

  const currentCoins = user.walletCoins ?? 0;
  if (args.delta === 0) {
    return { applied: false, walletCoins: currentCoins };
  }

  if (args.dedupeKey) {
    const existingLedgerRow = await ctx.db
      .query('walletLedger')
      .withIndex('by_dedupeKey', (q) => q.eq('dedupeKey', args.dedupeKey))
      .first();

    if (existingLedgerRow) {
      return { applied: false, duplicate: true, walletCoins: currentCoins };
    }
  }

  const createdAt = args.createdAt ?? Date.now();
  const nextCoins = currentCoins + args.delta;
  const ledgerId = await ctx.db.insert('walletLedger', {
    userId: args.userId,
    delta: args.delta,
    reason: args.reason,
    sourceType: args.sourceType,
    ...(args.sourceId ? { sourceId: args.sourceId } : {}),
    ...(args.peerUserId ? { peerUserId: args.peerUserId } : {}),
    ...(args.roomId ? { roomId: args.roomId } : {}),
    ...(args.dayKey ? { dayKey: args.dayKey } : {}),
    ...(args.dedupeKey ? { dedupeKey: args.dedupeKey } : {}),
    createdAt,
  });

  await ctx.db.patch(args.userId, { walletCoins: nextCoins });

  return { applied: true, walletCoins: nextCoins, ledgerId };
}
