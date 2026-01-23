/* eslint-disable */
/**
 * Generated API types - run `npx convex dev` to regenerate
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

import type * as auth from "../auth";
import type * as crossedPaths from "../crossedPaths";
import type * as dares from "../dares";
import type * as discover from "../discover";
import type * as filterPresets from "../filterPresets";
import type * as likes from "../likes";
import type * as matches from "../matches";
import type * as matchQuality from "../matchQuality";
import type * as messages from "../messages";
import type * as messageTemplates from "../messageTemplates";
import type * as notifications from "../notifications";
import type * as photos from "../photos";
import type * as smartSuggestions from "../smartSuggestions";
import type * as subscriptions from "../subscriptions";
import type * as users from "../users";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  crossedPaths: typeof crossedPaths;
  dares: typeof dares;
  discover: typeof discover;
  filterPresets: typeof filterPresets;
  likes: typeof likes;
  matches: typeof matches;
  matchQuality: typeof matchQuality;
  messages: typeof messages;
  messageTemplates: typeof messageTemplates;
  notifications: typeof notifications;
  photos: typeof photos;
  smartSuggestions: typeof smartSuggestions;
  subscriptions: typeof subscriptions;
  users: typeof users;
}>;

export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
