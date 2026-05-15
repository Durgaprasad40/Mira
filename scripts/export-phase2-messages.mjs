#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const outArgIndex = args.findIndex((arg) => arg === "--out");
const outputPath =
  outArgIndex >= 0 && args[outArgIndex + 1]
    ? path.resolve(args[outArgIndex + 1])
    : path.resolve("dist/phase2_messages_export.csv");

const passthroughArgs = args.filter((arg, index) => {
  if (arg === "--out") return false;
  if (outArgIndex >= 0 && index === outArgIndex + 1) return false;
  return true;
});

function extractJsonObject(raw) {
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("Could not find JSON object in Convex output.");
  }
  return JSON.parse(raw.slice(firstBrace, lastBrace + 1));
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const stringValue = typeof value === "string" ? value : String(value);
  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, "\"\"")}"`;
  }
  return stringValue;
}

// P1-002: exportAllPhase2Messages is now paginated. Loop until `nextCursor`
// is null (i.e. isDone === true) so we still produce a single CSV covering
// every row, without ever asking the server for an unbounded scan.
const PAGE_SIZE = 1000;
const MAX_PAGES = 10000; // hard safety cap (~10M rows) to avoid runaway loops

const aggregatedRows = [];
let cursor = null;
let pageCount = 0;
let lastExportedAt = null;

while (pageCount < MAX_PAGES) {
  pageCount += 1;

  const pageArgs = { pageSize: PAGE_SIZE };
  if (cursor !== null) pageArgs.cursor = cursor;

  const convexArgs = [
    "convex",
    "run",
    "privateConversations:exportAllPhase2Messages",
    JSON.stringify(pageArgs),
    ...passthroughArgs,
  ];

  const rawOutput = execFileSync("npx", convexArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  const payload = extractJsonObject(rawOutput);
  if (!payload || !Array.isArray(payload.rows)) {
    throw new Error("Convex export did not return a rows array.");
  }

  for (const row of payload.rows) {
    aggregatedRows.push({
      ...row,
      conversation_participants: JSON.stringify(row.conversation_participants ?? []),
    });
  }

  if (typeof payload.exportedAt === "string") {
    lastExportedAt = payload.exportedAt;
  }

  if (payload.isDone === true || payload.nextCursor === null || payload.nextCursor === undefined) {
    break;
  }
  cursor = payload.nextCursor;
}

if (pageCount >= MAX_PAGES) {
  throw new Error(`Export aborted: exceeded MAX_PAGES (${MAX_PAGES}).`);
}

const payload = {
  exportedAt: lastExportedAt ?? new Date().toISOString(),
  rowCount: aggregatedRows.length,
};
const rows = aggregatedRows;

const headers = [
  "message_id",
  "conversation_id",
  "sender_id",
  "sender_auth_user_id",
  "sender_handle",
  "receiver_id",
  "receiver_auth_user_id",
  "receiver_handle",
  "participant_1_id",
  "participant_2_id",
  "conversation_participants",
  "connection_source",
  "conversation_match_id",
  "conversation_is_pre_match",
  "conversation_created_at_ms",
  "conversation_created_at_iso",
  "timestamp_ms",
  "timestamp_iso",
  "message_type",
  "message_content",
  "status",
  "delivered_at_ms",
  "delivered_at_iso",
  "read_at_ms",
  "read_at_iso",
  "viewed_at_ms",
  "viewed_at_iso",
  "timer_ends_at_ms",
  "timer_ends_at_iso",
  "image_storage_id",
  "audio_storage_id",
  "audio_duration_ms",
  "is_protected",
  "protected_media_timer",
  "protected_media_viewing_mode",
  "protected_media_is_mirrored",
  "is_expired",
  "client_message_id",
  "metadata_json",
];

const csvLines = [
  headers.join(","),
  ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
];

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${csvLines.join("\n")}\n`, "utf8");

console.log(
  JSON.stringify(
    {
      exportedAt: payload.exportedAt,
      rowCount: payload.rowCount,
      outputPath,
    },
    null,
    2
  )
);
