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
import type * as cleanup from "../cleanup.js";
import type * as crossedPaths from "../crossedPaths.js";
import type * as dares from "../dares.js";
import type * as discover from "../discover.js";
import type * as filterPresets from "../filterPresets.js";
import type * as likes from "../likes.js";
import type * as matchQuality from "../matchQuality.js";
import type * as matches from "../matches.js";
import type * as messageTemplates from "../messageTemplates.js";
import type * as messages from "../messages.js";
import type * as notifications from "../notifications.js";
import type * as photos from "../photos.js";
import type * as smartSuggestions from "../smartSuggestions.js";
import type * as subscriptions from "../subscriptions.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  cleanup: typeof cleanup;
  crossedPaths: typeof crossedPaths;
  dares: typeof dares;
  discover: typeof discover;
  filterPresets: typeof filterPresets;
  likes: typeof likes;
  matchQuality: typeof matchQuality;
  matches: typeof matches;
  messageTemplates: typeof messageTemplates;
  messages: typeof messages;
  notifications: typeof notifications;
  photos: typeof photos;
  smartSuggestions: typeof smartSuggestions;
  subscriptions: typeof subscriptions;
  users: typeof users;
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
