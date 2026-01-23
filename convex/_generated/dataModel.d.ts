/* eslint-disable */
/**
 * Generated data model types - run `npx convex dev` to regenerate
 */

import type { GenericId, GenericDataModel } from "convex/server";

// Table names from schema
export type TableNames =
  | "users"
  | "photos"
  | "likes"
  | "matches"
  | "conversations"
  | "messages"
  | "notifications"
  | "crossedPaths"
  | "dares"
  | "subscriptionRecords"
  | "purchases"
  | "reports"
  | "blocks"
  | "otpCodes"
  | "sessions"
  | "filterPresets";

export type Id<TableName extends TableNames> = GenericId<TableName>;

export interface DataModel extends GenericDataModel {
  tableName: TableNames;
}
