/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as behaviorDetection from "../behaviorDetection.js";
import type * as chatRooms from "../chatRooms.js";
import type * as cleanup from "../cleanup.js";
import type * as confessions from "../confessions.js";
import type * as contentModeration from "../contentModeration.js";
import type * as conversations from "../conversations.js";
import type * as crons from "../crons.js";
import type * as crossedPaths from "../crossedPaths.js";
import type * as dares from "../dares.js";
import type * as deviceFingerprint from "../deviceFingerprint.js";
import type * as discover from "../discover.js";
import type * as emailActions from "../emailActions.js";
import type * as events from "../events.js";
import type * as filterPresets from "../filterPresets.js";
import type * as id from "../id.js";
import type * as likes from "../likes.js";
import type * as matchQuality from "../matchQuality.js";
import type * as matches from "../matches.js";
import type * as media from "../media.js";
import type * as messageTemplates from "../messageTemplates.js";
import type * as messages from "../messages.js";
import type * as notifications from "../notifications.js";
import type * as permissions from "../permissions.js";
import type * as photos from "../photos.js";
import type * as privateDiscover from "../privateDiscover.js";
import type * as privateProfiles from "../privateProfiles.js";
import type * as protectedMedia from "../protectedMedia.js";
import type * as revealRequests from "../revealRequests.js";
import type * as smartSuggestions from "../smartSuggestions.js";
import type * as softMask from "../softMask.js";
import type * as subscriptions from "../subscriptions.js";
import type * as surveys from "../surveys.js";
import type * as trustScore from "../trustScore.js";
import type * as truthDare from "../truthDare.js";
import type * as users from "../users.js";
import type * as verification from "../verification.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  behaviorDetection: typeof behaviorDetection;
  chatRooms: typeof chatRooms;
  cleanup: typeof cleanup;
  confessions: typeof confessions;
  contentModeration: typeof contentModeration;
  conversations: typeof conversations;
  crons: typeof crons;
  crossedPaths: typeof crossedPaths;
  dares: typeof dares;
  deviceFingerprint: typeof deviceFingerprint;
  discover: typeof discover;
  emailActions: typeof emailActions;
  events: typeof events;
  filterPresets: typeof filterPresets;
  id: typeof id;
  likes: typeof likes;
  matchQuality: typeof matchQuality;
  matches: typeof matches;
  media: typeof media;
  messageTemplates: typeof messageTemplates;
  messages: typeof messages;
  notifications: typeof notifications;
  permissions: typeof permissions;
  photos: typeof photos;
  privateDiscover: typeof privateDiscover;
  privateProfiles: typeof privateProfiles;
  protectedMedia: typeof protectedMedia;
  revealRequests: typeof revealRequests;
  smartSuggestions: typeof smartSuggestions;
  softMask: typeof softMask;
  subscriptions: typeof subscriptions;
  surveys: typeof surveys;
  trustScore: typeof trustScore;
  truthDare: typeof truthDare;
  users: typeof users;
  verification: typeof verification;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
