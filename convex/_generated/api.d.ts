/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as adminLog from "../adminLog.js";
import type * as auth from "../auth.js";
import type * as behaviorDetection from "../behaviorDetection.js";
import type * as chatRooms from "../chatRooms.js";
import type * as chatTod from "../chatTod.js";
import type * as cleanup from "../cleanup.js";
import type * as confessions from "../confessions.js";
import type * as contentModeration from "../contentModeration.js";
import type * as conversations from "../conversations.js";
import type * as crons from "../crons.js";
import type * as crossedPaths from "../crossedPaths.js";
import type * as cryptoUtils from "../cryptoUtils.js";
import type * as dares from "../dares.js";
import type * as devReset from "../devReset.js";
import type * as deviceFingerprint from "../deviceFingerprint.js";
import type * as discover from "../discover.js";
import type * as discoverCategories from "../discoverCategories.js";
import type * as discoverRanking from "../discoverRanking.js";
import type * as discoveryFilters from "../discoveryFilters.js";
import type * as discoveryMixer from "../discoveryMixer.js";
import type * as discoveryScoring from "../discoveryScoring.js";
import type * as discoveryTypes from "../discoveryTypes.js";
import type * as emailActions from "../emailActions.js";
import type * as events from "../events.js";
import type * as faceVerification from "../faceVerification.js";
import type * as filterPresets from "../filterPresets.js";
import type * as games from "../games.js";
import type * as helpers from "../helpers.js";
import type * as id from "../id.js";
import type * as likes from "../likes.js";
import type * as matchQuality from "../matchQuality.js";
import type * as matches from "../matches.js";
import type * as media from "../media.js";
import type * as messageTemplates from "../messageTemplates.js";
import type * as messages from "../messages.js";
import type * as migrations from "../migrations.js";
import type * as notifications from "../notifications.js";
import type * as permissions from "../permissions.js";
import type * as phase1DiscoveryAdapter from "../phase1DiscoveryAdapter.js";
import type * as phase2DiscoveryAdapter from "../phase2DiscoveryAdapter.js";
import type * as phase2Ranking from "../phase2Ranking.js";
import type * as photos from "../photos.js";
import type * as privateDeletion from "../privateDeletion.js";
import type * as privateDiscover from "../privateDiscover.js";
import type * as privateProfiles from "../privateProfiles.js";
import type * as protectedMedia from "../protectedMedia.js";
import type * as ranking_phase1Adapter from "../ranking/phase1Adapter.js";
import type * as ranking_phase2Adapter from "../ranking/phase2Adapter.js";
import type * as ranking_rankingConfig from "../ranking/rankingConfig.js";
import type * as ranking_rankingTypes from "../ranking/rankingTypes.js";
import type * as ranking_sharedRankingEngine from "../ranking/sharedRankingEngine.js";
import type * as revealRequests from "../revealRequests.js";
import type * as scripts_assignAllCategories from "../scripts/assignAllCategories.js";
import type * as scripts_checkSessions from "../scripts/checkSessions.js";
import type * as scripts_checkUserIds from "../scripts/checkUserIds.js";
import type * as scripts_clearExploreTestData from "../scripts/clearExploreTestData.js";
import type * as scripts_clearPostUnmatchLikes from "../scripts/clearPostUnmatchLikes.js";
import type * as scripts_clearTestCooldowns from "../scripts/clearTestCooldowns.js";
import type * as scripts_debugExploreEligibility from "../scripts/debugExploreEligibility.js";
import type * as scripts_debugPostUnmatch from "../scripts/debugPostUnmatch.js";
import type * as scripts_migrateCategoryTaxonomy from "../scripts/migrateCategoryTaxonomy.js";
import type * as scripts_resetTestPair from "../scripts/resetTestPair.js";
import type * as sharedDiscoveryEngine from "../sharedDiscoveryEngine.js";
import type * as smartSuggestions from "../smartSuggestions.js";
import type * as softMask from "../softMask.js";
import type * as subscriptions from "../subscriptions.js";
import type * as support from "../support.js";
import type * as surveys from "../surveys.js";
import type * as system from "../system.js";
import type * as trustScore from "../trustScore.js";
import type * as truthDare from "../truthDare.js";
import type * as users from "../users.js";
import type * as verification from "../verification.js";
import type * as verificationProviders from "../verificationProviders.js";
import type * as verifyFaceMatch from "../verifyFaceMatch.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  adminLog: typeof adminLog;
  auth: typeof auth;
  behaviorDetection: typeof behaviorDetection;
  chatRooms: typeof chatRooms;
  chatTod: typeof chatTod;
  cleanup: typeof cleanup;
  confessions: typeof confessions;
  contentModeration: typeof contentModeration;
  conversations: typeof conversations;
  crons: typeof crons;
  crossedPaths: typeof crossedPaths;
  cryptoUtils: typeof cryptoUtils;
  dares: typeof dares;
  devReset: typeof devReset;
  deviceFingerprint: typeof deviceFingerprint;
  discover: typeof discover;
  discoverCategories: typeof discoverCategories;
  discoverRanking: typeof discoverRanking;
  discoveryFilters: typeof discoveryFilters;
  discoveryMixer: typeof discoveryMixer;
  discoveryScoring: typeof discoveryScoring;
  discoveryTypes: typeof discoveryTypes;
  emailActions: typeof emailActions;
  events: typeof events;
  faceVerification: typeof faceVerification;
  filterPresets: typeof filterPresets;
  games: typeof games;
  helpers: typeof helpers;
  id: typeof id;
  likes: typeof likes;
  matchQuality: typeof matchQuality;
  matches: typeof matches;
  media: typeof media;
  messageTemplates: typeof messageTemplates;
  messages: typeof messages;
  migrations: typeof migrations;
  notifications: typeof notifications;
  permissions: typeof permissions;
  phase1DiscoveryAdapter: typeof phase1DiscoveryAdapter;
  phase2DiscoveryAdapter: typeof phase2DiscoveryAdapter;
  phase2Ranking: typeof phase2Ranking;
  photos: typeof photos;
  privateDeletion: typeof privateDeletion;
  privateDiscover: typeof privateDiscover;
  privateProfiles: typeof privateProfiles;
  protectedMedia: typeof protectedMedia;
  "ranking/phase1Adapter": typeof ranking_phase1Adapter;
  "ranking/phase2Adapter": typeof ranking_phase2Adapter;
  "ranking/rankingConfig": typeof ranking_rankingConfig;
  "ranking/rankingTypes": typeof ranking_rankingTypes;
  "ranking/sharedRankingEngine": typeof ranking_sharedRankingEngine;
  revealRequests: typeof revealRequests;
  "scripts/assignAllCategories": typeof scripts_assignAllCategories;
  "scripts/checkSessions": typeof scripts_checkSessions;
  "scripts/checkUserIds": typeof scripts_checkUserIds;
  "scripts/clearExploreTestData": typeof scripts_clearExploreTestData;
  "scripts/clearPostUnmatchLikes": typeof scripts_clearPostUnmatchLikes;
  "scripts/clearTestCooldowns": typeof scripts_clearTestCooldowns;
  "scripts/debugExploreEligibility": typeof scripts_debugExploreEligibility;
  "scripts/debugPostUnmatch": typeof scripts_debugPostUnmatch;
  "scripts/migrateCategoryTaxonomy": typeof scripts_migrateCategoryTaxonomy;
  "scripts/resetTestPair": typeof scripts_resetTestPair;
  sharedDiscoveryEngine: typeof sharedDiscoveryEngine;
  smartSuggestions: typeof smartSuggestions;
  softMask: typeof softMask;
  subscriptions: typeof subscriptions;
  support: typeof support;
  surveys: typeof surveys;
  system: typeof system;
  trustScore: typeof trustScore;
  truthDare: typeof truthDare;
  users: typeof users;
  verification: typeof verification;
  verificationProviders: typeof verificationProviders;
  verifyFaceMatch: typeof verifyFaceMatch;
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
