import { v } from 'convex/values';
import { query } from './_generated/server';

// Get message templates based on user tier
export const getMessageTemplates = query({
  args: {
    userId: v.id('users'),
    targetUserId: v.optional(v.id('users')),
  },
  handler: async (ctx, args) => {
    const { userId, targetUserId } = args;

    const user = await ctx.db.get(userId);
    if (!user) return [];

    // Get target user for personalization
    let targetUser = null;
    if (targetUserId) {
      targetUser = await ctx.db.get(targetUserId);
    }

    // Determine template count based on subscription
    let templateCount = 10; // Free tier
    if (user.gender === 'female') {
      templateCount = 50; // Women get all templates
    } else if (user.subscriptionTier === 'premium') {
      templateCount = 50;
    } else if (user.subscriptionTier === 'basic') {
      templateCount = 25;
    }

    // Base templates
    const templates = [
      {
        id: 'interest-1',
        category: 'interest',
        text: targetUser?.activities?.[0]
          ? `Hey! I noticed we both love ${formatActivity(targetUser.activities[0])}. What's your favorite part about it?`
          : "Hey! I noticed we have some things in common. I'd love to chat!",
      },
      {
        id: 'interest-2',
        category: 'interest',
        text: targetUser?.activities?.[0]
          ? `I see you're into ${formatActivity(targetUser.activities[0])}. Me too! What got you started?`
          : "I see we share some interests. Want to talk about them?",
      },
      {
        id: 'compliment-1',
        category: 'compliment',
        text: targetUser?.name
          ? `Hi ${targetUser.name}! Your profile caught my eye. I'd love to get to know you better.`
          : "Your profile caught my eye! I'd love to chat.",
      },
      {
        id: 'compliment-2',
        category: 'compliment',
        text: "You seem like an interesting person. What's your story?",
      },
      {
        id: 'question-1',
        category: 'question',
        text: "If you could travel anywhere tomorrow, where would you go?",
      },
      {
        id: 'question-2',
        category: 'question',
        text: "What's something you're passionate about?",
      },
      {
        id: 'fun-1',
        category: 'fun',
        text: "Quick question: Coffee or tea? (This is important 😄)",
      },
      {
        id: 'fun-2',
        category: 'fun',
        text: "Two truths and a lie - go!",
      },
      {
        id: 'straightforward-1',
        category: 'straightforward',
        text: "Hi! I'd love to get to know you better.",
      },
      {
        id: 'straightforward-2',
        category: 'straightforward',
        text: "Hey there! Want to chat?",
      },
    ];

    // Add more templates for higher tiers
    if (templateCount >= 25) {
      templates.push(
        {
          id: 'interest-3',
          category: 'interest',
          text: targetUser?.bio
            ? `I loved reading your bio! The part about ${extractBioHighlight(targetUser.bio)} really resonated with me.`
            : "I really enjoyed reading your profile. Want to chat?",
        },
        {
          id: 'question-3',
          category: 'question',
          text: "What's the best thing that happened to you this week?",
        },
        {
          id: 'fun-3',
          category: 'fun',
          text: "If you were a pizza topping, what would you be and why?",
        }
      );
    }

    if (templateCount >= 50) {
      templates.push(
        {
          id: 'interest-4',
          category: 'interest',
          text: targetUser?.jobTitle
            ? `I see you're a ${targetUser.jobTitle}. That's fascinating! What do you love most about it?`
            : "Your work sounds interesting! Tell me more about it.",
        },
        {
          id: 'question-4',
          category: 'question',
          text: "What's something on your bucket list?",
        },
        {
          id: 'fun-4',
          category: 'fun',
          text: "Would you rather fight 100 duck-sized horses or 1 horse-sized duck?",
        }
      );
    }

    return templates.slice(0, templateCount);
  },
});

function formatActivity(activity: string): string {
  const labels: Record<string, string> = {
    coffee: 'coffee',
    date_night: 'dining out',
    sports: 'sports',
    movies: 'movies',
    free_tonight: 'spontaneous plans',
    foodie: 'food',
    gym_partner: 'fitness',
    concerts: 'live music',
    travel: 'travel',
    outdoors: 'outdoor activities',
    art_culture: 'art and culture',
    gaming: 'gaming',
    nightlife: 'nightlife',
    brunch: 'brunch',
    study_date: 'learning',
    this_weekend: 'weekend plans',
    beach_pool: 'beach activities',
    road_trip: 'road trips',
    photography: 'photography',
    volunteering: 'volunteering',
  };
  return labels[activity] || activity;
}

function extractBioHighlight(bio: string): string {
  // Simple extraction - take first 20 characters
  return bio.substring(0, 20) + '...';
}
