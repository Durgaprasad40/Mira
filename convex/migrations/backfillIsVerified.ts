import { internalMutation } from "../_generated/server";

export const backfillIsVerified = internalMutation({
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();

    let patched = 0;

    for (const u of users) {
      if (u.verificationStatus === "verified" && u.isVerified !== true) {
        await ctx.db.patch(u._id, { isVerified: true });
        patched++;
      }
    }

    return { patched };
  },
});
