#!/usr/bin/env node
/**
 * generateDemoMarkers.mjs
 *
 * Creates pre-composited marker images (pink pin + circular avatar inside).
 * This eliminates the 2-marker overlay approach that caused drift/delay on Android.
 *
 * Each marker is a single PNG with the avatar already composited into the pin head.
 * Result: ONE native Marker image per user, zero sliding, instant rendering.
 *
 * Usage: node scripts/generateDemoMarkers.mjs
 *
 * Outputs:
 * - assets/demo/markers/<id>.png (72x92 @1x)
 * - assets/demo/markers/<id>@2x.png (144x184 @2x)
 */

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Pin dimensions
const PIN_1X = { width: 72, height: 92 };
const PIN_2X = { width: 144, height: 184 };

// Avatar dimensions (already circular with transparency)
const AVATAR_1X = 48;
const AVATAR_2X = 96;

// Avatar placement inside pin (top-left coordinates)
// Pin head center is approximately at (36, 32) in 72x92 coordinate system
// Avatar size is 48x48, so top-left = (36 - 24, 32 - 24) = (12, 8)
const AVATAR_POS_1X = { left: 12, top: 8 };
const AVATAR_POS_2X = { left: 24, top: 16 }; // Scaled 2x

// Input paths
const PIN_1X_PATH = path.join(ROOT_DIR, 'assets/map/pin_pink.png');
const PIN_2X_PATH = path.join(ROOT_DIR, 'assets/map/pin_pink@2x.png');
const AVATARS_DIR = path.join(ROOT_DIR, 'assets/demo/avatars');

// Output directory
const OUTPUT_DIR = path.join(ROOT_DIR, 'assets/demo/markers');

// Index file to generate
const INDEX_FILE = path.join(ROOT_DIR, 'components/map/demoMarkerIndex.ts');

// Demo profile IDs (must match the avatar files)
const DEMO_PROFILES = [
  'demo_profile_12',
  'demo_profile_18',
  'demo_profile_9',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Composite avatar onto pin background
 */
async function compositeMarker(pinPath, avatarPath, avatarPos, outputPath) {
  // Read both images
  const pinBuffer = fs.readFileSync(pinPath);
  const avatarBuffer = fs.readFileSync(avatarPath);

  // Composite: place avatar on top of pin at specified position
  await sharp(pinBuffer)
    .composite([
      {
        input: avatarBuffer,
        left: avatarPos.left,
        top: avatarPos.top,
      },
    ])
    .png()
    .toFile(outputPath);
}

/**
 * Create a default marker (pin with gray circle placeholder)
 */
async function createDefaultMarker(pinPath, size, avatarSize, avatarPos, outputPath) {
  // Create a gray circle placeholder
  const placeholderSvg = Buffer.from(`
    <svg width="${avatarSize}" height="${avatarSize}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${avatarSize / 2}" cy="${avatarSize / 2}" r="${avatarSize / 2}" fill="#CCCCCC"/>
      <circle cx="${avatarSize / 2}" cy="${avatarSize * 0.38}" r="${avatarSize * 0.18}" fill="#999999"/>
      <ellipse cx="${avatarSize / 2}" cy="${avatarSize * 0.85}" rx="${avatarSize * 0.28}" ry="${avatarSize * 0.22}" fill="#999999"/>
    </svg>
  `);

  const placeholder = await sharp(placeholderSvg).png().toBuffer();

  // Composite onto pin
  const pinBuffer = fs.readFileSync(pinPath);
  await sharp(pinBuffer)
    .composite([
      {
        input: placeholder,
        left: avatarPos.left,
        top: avatarPos.top,
      },
    ])
    .png()
    .toFile(outputPath);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== Generating Pre-Composited Demo Markers ===\n');

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    console.log(`Created: ${OUTPUT_DIR}\n`);
  }

  // Verify pin assets exist
  if (!fs.existsSync(PIN_1X_PATH) || !fs.existsSync(PIN_2X_PATH)) {
    console.error('ERROR: Pin assets not found!');
    console.error(`  Expected: ${PIN_1X_PATH}`);
    console.error(`  Expected: ${PIN_2X_PATH}`);
    process.exit(1);
  }

  const generated = [];
  const failed = [];

  // Generate markers for each demo profile
  for (const profileId of DEMO_PROFILES) {
    console.log(`Processing: ${profileId}`);

    const avatar1xPath = path.join(AVATARS_DIR, `${profileId}.png`);
    const avatar2xPath = path.join(AVATARS_DIR, `${profileId}@2x.png`);

    // Check avatar exists
    if (!fs.existsSync(avatar1xPath) || !fs.existsSync(avatar2xPath)) {
      console.error(`  ERROR: Avatar not found for ${profileId}`);
      failed.push(profileId);
      continue;
    }

    try {
      // Generate 1x marker
      const out1x = path.join(OUTPUT_DIR, `${profileId}.png`);
      await compositeMarker(PIN_1X_PATH, avatar1xPath, AVATAR_POS_1X, out1x);
      console.log(`  Created: ${profileId}.png (72x92)`);

      // Generate 2x marker
      const out2x = path.join(OUTPUT_DIR, `${profileId}@2x.png`);
      await compositeMarker(PIN_2X_PATH, avatar2xPath, AVATAR_POS_2X, out2x);
      console.log(`  Created: ${profileId}@2x.png (144x184)`);

      generated.push(profileId);
    } catch (error) {
      console.error(`  ERROR: ${error.message}`);
      failed.push(profileId);
    }

    console.log('');
  }

  // Generate default markers (placeholder)
  console.log('Generating default markers...');
  try {
    const default1x = path.join(OUTPUT_DIR, '_default.png');
    await createDefaultMarker(PIN_1X_PATH, PIN_1X, AVATAR_1X, AVATAR_POS_1X, default1x);
    console.log(`  Created: _default.png (72x92)`);

    const default2x = path.join(OUTPUT_DIR, '_default@2x.png');
    await createDefaultMarker(PIN_2X_PATH, PIN_2X, AVATAR_2X, AVATAR_POS_2X, default2x);
    console.log(`  Created: _default@2x.png (144x184)`);
  } catch (error) {
    console.error(`  ERROR creating default: ${error.message}`);
  }
  console.log('');

  // Generate TypeScript index file
  console.log('Generating demoMarkerIndex.ts...');

  const indexContent = `/**
 * Auto-generated demo marker mapping.
 * DO NOT EDIT MANUALLY — run: npm run gen:demo-markers
 *
 * These are pre-composited marker images (pink pin + avatar inside).
 * Using a single native Marker image eliminates drift/delay on Android.
 */

/**
 * Get the composited marker image for a demo profile.
 * Returns a require() reference for Marker image prop.
 *
 * @param id - Profile ID (e.g., "demo_profile_12")
 */
export function getDemoMarkerImage(id: string): any {
  switch (id) {
${generated.map(profileId => `    case "${profileId}":\n      return require("../../assets/demo/markers/${profileId}.png");`).join('\n')}
    default:
      return require("../../assets/demo/markers/_default.png");
  }
}
`;

  // Ensure components/map directory exists
  const indexDir = path.dirname(INDEX_FILE);
  if (!fs.existsSync(indexDir)) {
    fs.mkdirSync(indexDir, { recursive: true });
  }

  fs.writeFileSync(INDEX_FILE, indexContent);
  console.log(`  Created: ${INDEX_FILE}\n`);

  // Summary
  console.log('=== Summary ===');
  console.log(`Generated: ${generated.length} markers`);
  if (failed.length > 0) {
    console.log(`Failed: ${failed.length} (${failed.join(', ')})`);
  }
  console.log('\nDone! Now update nearby.tsx to use getDemoMarkerImage().');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
