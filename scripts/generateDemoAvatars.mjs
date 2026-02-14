#!/usr/bin/env node
/**
 * generateDemoAvatars.mjs
 *
 * Downloads demo profile photos from Unsplash URLs and converts them to
 * circular PNG avatars for use as native Marker images on Android.
 *
 * This eliminates the Android snapshot bug (1/4 quadrant / white circles)
 * by using pre-generated local PNGs instead of React Image components.
 *
 * Usage: node scripts/generateDemoAvatars.mjs
 *
 * Outputs:
 * - assets/demo/avatars/<id>.png (48x48 @1x)
 * - assets/demo/avatars/<id>@2x.png (96x96 @2x)
 * - components/map/demoAvatarIndex.ts (require mapping)
 */

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Demo Crossed Paths Data (must match lib/demoData.ts)
// ---------------------------------------------------------------------------

const DEMO_AVATARS = [
  {
    id: 'demo_profile_12',
    photoUrl: 'https://images.unsplash.com/photo-1485893086445-ed75865251e0?w=400',
    name: 'Isha',
  },
  {
    id: 'demo_profile_18',
    photoUrl: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=400',
    name: 'Kriti',
  },
  {
    id: 'demo_profile_9',
    photoUrl: 'https://images.unsplash.com/photo-1491349174775-aaafddd81942?w=400',
    name: 'Nisha',
  },
];

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const AVATAR_SIZE_1X = 48;
const AVATAR_SIZE_2X = 96;
const OUTPUT_DIR = path.join(ROOT_DIR, 'assets/demo/avatars');
const INDEX_FILE = path.join(ROOT_DIR, 'components/map/demoAvatarIndex.ts');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a circular mask SVG
 */
function createCircleMaskSvg(size) {
  return Buffer.from(`
    <svg width="${size}" height="${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="white"/>
    </svg>
  `);
}

/**
 * Download image from URL and return as Buffer
 */
async function downloadImage(url) {
  console.log(`  Downloading: ${url.substring(0, 60)}...`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Convert image buffer to circular PNG
 */
async function makeCircularAvatar(imageBuffer, size) {
  const mask = createCircleMaskSvg(size);

  return sharp(imageBuffer)
    .resize(size, size, { fit: 'cover', position: 'center' })
    .composite([
      {
        input: mask,
        blend: 'dest-in',
      },
    ])
    .png()
    .toBuffer();
}

/**
 * Create a default gray avatar placeholder
 */
async function createDefaultAvatar(size) {
  // Gray circle with a simple person silhouette hint
  const svg = Buffer.from(`
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#CCCCCC"/>
      <circle cx="${size / 2}" cy="${size * 0.38}" r="${size * 0.18}" fill="#999999"/>
      <ellipse cx="${size / 2}" cy="${size * 0.85}" rx="${size * 0.28}" ry="${size * 0.22}" fill="#999999"/>
    </svg>
  `);

  return sharp(svg).png().toBuffer();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== Generating Demo Avatar PNGs ===\n');

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    console.log(`Created: ${OUTPUT_DIR}\n`);
  }

  const generated = [];
  const failed = [];

  // Generate avatars for each demo profile
  for (const avatar of DEMO_AVATARS) {
    console.log(`Processing: ${avatar.id} (${avatar.name})`);

    try {
      const imageBuffer = await downloadImage(avatar.photoUrl);

      // Generate 1x (48x48)
      const avatar1x = await makeCircularAvatar(imageBuffer, AVATAR_SIZE_1X);
      const path1x = path.join(OUTPUT_DIR, `${avatar.id}.png`);
      fs.writeFileSync(path1x, avatar1x);
      console.log(`  Created: ${avatar.id}.png (${AVATAR_SIZE_1X}x${AVATAR_SIZE_1X})`);

      // Generate 2x (96x96)
      const avatar2x = await makeCircularAvatar(imageBuffer, AVATAR_SIZE_2X);
      const path2x = path.join(OUTPUT_DIR, `${avatar.id}@2x.png`);
      fs.writeFileSync(path2x, avatar2x);
      console.log(`  Created: ${avatar.id}@2x.png (${AVATAR_SIZE_2X}x${AVATAR_SIZE_2X})`);

      generated.push(avatar.id);
    } catch (error) {
      console.error(`  ERROR: ${error.message}`);
      failed.push(avatar.id);
    }

    console.log('');
  }

  // Generate default avatar
  console.log('Generating default avatar...');
  try {
    const default1x = await createDefaultAvatar(AVATAR_SIZE_1X);
    fs.writeFileSync(path.join(OUTPUT_DIR, '_default.png'), default1x);
    console.log(`  Created: _default.png (${AVATAR_SIZE_1X}x${AVATAR_SIZE_1X})`);

    const default2x = await createDefaultAvatar(AVATAR_SIZE_2X);
    fs.writeFileSync(path.join(OUTPUT_DIR, '_default@2x.png'), default2x);
    console.log(`  Created: _default@2x.png (${AVATAR_SIZE_2X}x${AVATAR_SIZE_2X})`);
  } catch (error) {
    console.error(`  ERROR creating default: ${error.message}`);
  }
  console.log('');

  // Generate TypeScript index file
  console.log('Generating demoAvatarIndex.ts...');

  const indexContent = `/**
 * Auto-generated demo avatar mapping.
 * DO NOT EDIT MANUALLY — run: node scripts/generateDemoAvatars.mjs
 *
 * These are pre-generated circular PNG avatars for use as native Marker images.
 * Using native images avoids Android snapshot bugs (1/4 quadrant / white circles).
 */

// Avatar images keyed by profile ID
export const DEMO_AVATAR_IMG: Record<string, any> = {
${generated.map(id => `  "${id}": require("../../assets/demo/avatars/${id}.png"),`).join('\n')}
};

// Fallback avatar for unknown IDs
export const DEMO_AVATAR_FALLBACK = require("../../assets/demo/avatars/_default.png");

/**
 * Get the avatar image source for a demo profile.
 * Returns a require() reference suitable for Marker image prop.
 */
export function getDemoAvatarImage(id: string): any {
  return DEMO_AVATAR_IMG[id] ?? DEMO_AVATAR_FALLBACK;
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
  console.log(`Generated: ${generated.length} avatars`);
  if (failed.length > 0) {
    console.log(`Failed: ${failed.length} (${failed.join(', ')})`);
  }
  console.log('\nDone! Now update nearby.tsx to use getDemoAvatarImage().');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
