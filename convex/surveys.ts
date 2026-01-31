import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

export const submitSurveyResponse = mutation({
  args: {
    userId: v.id('users'),
    questionId: v.string(),
    questionText: v.string(),
    response: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId, questionId, questionText, response } = args;

    await ctx.db.insert('surveyResponses', {
      userId,
      questionId,
      questionText,
      response,
      createdAt: Date.now(),
    });

    return { success: true };
  },
});

export const getSurveyResponses = query({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('surveyResponses')
      .filter((q) => q.eq(q.field('userId'), args.userId))
      .order('desc')
      .take(50);
  },
});
