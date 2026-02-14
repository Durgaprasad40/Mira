#!/usr/bin/env node
/**
 * generateDemoClusterMarkers.mjs
 *
 * Creates pre-composited cluster marker images (pink pin + count number inside).
 * This eliminates React children inside Marker for clusters.
 *
 * Each cluster marker is a single PNG with the count number already rendered.
 * Result: ONE native Marker image per cluster, zero drift, instant rendering.
 *
 * Usage: node scripts/generateDemoClusterMarkers.mjs
 *
 * Outputs:
 * - assets/demo/cluster/cluster_2.png through cluster_20.png (@1x)
 * - assets/demo/cluster/cluster_2@2x.png through cluster_20@2x.png (@2x)
 * - Bucket images: cluster_21.png (21+), cluster_50.png (50+), cluster_99.png (99+)
 * - Default: _default.png
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

// Circle position and size in pin head (where count goes)
// For 72x92 pin: circle center at (36, 32), radius ~20
const CIRCLE_1X = { cx: 36, cy: 32, r: 20 };
const CIRCLE_2X = { cx: 72, cy: 64, r: 40 };

// Text styling
const TEXT_COLOR = '#E91E63'; // Pink to match pin
const CIRCLE_BG = '#FFFFFF';

// Input paths
const PIN_1X_PATH = path.join(ROOT_DIR, 'assets/map/pin_pink.png');
const PIN_2X_PATH = path.join(ROOT_DIR, 'assets/map/pin_pink@2x.png');

// Output directory
const OUTPUT_DIR = path.join(ROOT_DIR, 'assets/demo/cluster');

// Index file to generate
const INDEX_FILE = path.join(ROOT_DIR, 'components/map/demoClusterIndex.ts');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create SVG overlay with white circle and centered number
 */
function createCountOverlaySvg(count, size, circle) {
  const displayText = count > 99 ? '99+' : String(count);

  // Adjust font size based on text length
  let fontSize;
  if (displayText.length === 1) {
    fontSize = circle.r * 1.1;
  } else if (displayText.length === 2) {
    fontSize = circle.r * 0.9;
  } else {
    fontSize = circle.r * 0.7;
  }

  return Buffer.from(`
    <svg width="${size.width}" height="${size.height}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${circle.cx}" cy="${circle.cy}" r="${circle.r}" fill="${CIRCLE_BG}"/>
      <text
        x="${circle.cx}"
        y="${circle.cy}"
        font-family="Arial, Helvetica, sans-serif"
        font-size="${fontSize}"
        font-weight="bold"
        fill="${TEXT_COLOR}"
        text-anchor="middle"
        dominant-baseline="central"
      >${displayText}</text>
    </svg>
  `);
}

/**
 * Create a cluster marker with count inside
 */
async function createClusterMarker(pinPath, count, size, circle, outputPath) {
  const pinBuffer = fs.readFileSync(pinPath);
  const overlaySvg = createCountOverlaySvg(count, size, circle);
  const overlayPng = await sharp(overlaySvg).png().toBuffer();

  await sharp(pinBuffer)
    .composite([
      {
        input: overlayPng,
        left: 0,
        top: 0,
      },
    ])
    .png()
    .toFile(outputPath);
}

/**
 * Create default cluster marker (empty/1)
 */
async function createDefaultMarker(pinPath, size, circle, outputPath) {
  // Just the pin with a white circle (no number)
  const pinBuffer = fs.readFileSync(pinPath);

  const circleSvg = Buffer.from(`
    <svg width="${size.width}" height="${size.height}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${circle.cx}" cy="${circle.cy}" r="${circle.r}" fill="${CIRCLE_BG}"/>
    </svg>
  `);

  const circlePng = await sharp(circleSvg).png().toBuffer();

  await sharp(pinBuffer)
    .composite([
      {
        input: circlePng,
        left: 0,
        top: 0,
      },
    ])
    .png()
    .toFile(outputPath);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== Generating Pre-Composited Cluster Markers ===\n');

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

  // Generate cluster markers for counts 2-20
  console.log('Generating cluster markers 2-20...');
  for (let count = 2; count <= 20; count++) {
    try {
      // 1x
      const out1x = path.join(OUTPUT_DIR, `cluster_${count}.png`);
      await createClusterMarker(PIN_1X_PATH, count, PIN_1X, CIRCLE_1X, out1x);

      // 2x
      const out2x = path.join(OUTPUT_DIR, `cluster_${count}@2x.png`);
      await createClusterMarker(PIN_2X_PATH, count, PIN_2X, CIRCLE_2X, out2x);

      generated.push(count);
      process.stdout.write(`  ${count}`);
    } catch (error) {
      console.error(`\n  ERROR for count ${count}: ${error.message}`);
    }
  }
  console.log('\n');

  // Generate bucket markers
  console.log('Generating bucket markers...');

  // 21+ bucket (displays "21+")
  try {
    await createClusterMarker(PIN_1X_PATH, 21, PIN_1X, CIRCLE_1X, path.join(OUTPUT_DIR, 'cluster_21.png'));
    await createClusterMarker(PIN_2X_PATH, 21, PIN_2X, CIRCLE_2X, path.join(OUTPUT_DIR, 'cluster_21@2x.png'));
    console.log('  Created: cluster_21.png (for 21-50)');

    // 50+ bucket (displays "50+")
    await createClusterMarker(PIN_1X_PATH, 50, PIN_1X, CIRCLE_1X, path.join(OUTPUT_DIR, 'cluster_50.png'));
    await createClusterMarker(PIN_2X_PATH, 50, PIN_2X, CIRCLE_2X, path.join(OUTPUT_DIR, 'cluster_50@2x.png'));
    console.log('  Created: cluster_50.png (for 51-99)');

    // 99+ bucket (displays "99+")
    await createClusterMarker(PIN_1X_PATH, 100, PIN_1X, CIRCLE_1X, path.join(OUTPUT_DIR, 'cluster_99.png'));
    await createClusterMarker(PIN_2X_PATH, 100, PIN_2X, CIRCLE_2X, path.join(OUTPUT_DIR, 'cluster_99@2x.png'));
    console.log('  Created: cluster_99.png (for 100+)');
  } catch (error) {
    console.error(`  ERROR creating bucket markers: ${error.message}`);
  }
  console.log('');

  // Generate default marker
  console.log('Generating default marker...');
  try {
    await createDefaultMarker(PIN_1X_PATH, PIN_1X, CIRCLE_1X, path.join(OUTPUT_DIR, '_default.png'));
    await createDefaultMarker(PIN_2X_PATH, PIN_2X, CIRCLE_2X, path.join(OUTPUT_DIR, '_default@2x.png'));
    console.log('  Created: _default.png');
  } catch (error) {
    console.error(`  ERROR creating default: ${error.message}`);
  }
  console.log('');

  // Generate TypeScript index file
  console.log('Generating demoClusterIndex.ts...');

  // Build static object map (RN bundler doesn't support dynamic require)
  const indexContent = `/**
 * Auto-generated cluster marker mapping.
 * DO NOT EDIT MANUALLY — run: npm run gen:demo-clusters
 *
 * These are pre-composited cluster images (pink pin + count inside).
 * Using a single native Marker image eliminates all Android snapshot bugs.
 */

// Static require map (RN bundler needs static paths)
const CLUSTER_IMAGES: Record<number, any> = {
${generated.map(n => `  ${n}: require("../../assets/demo/cluster/cluster_${n}.png"),`).join('\n')}
};

// Bucket images for larger counts
const CLUSTER_21_PLUS = require("../../assets/demo/cluster/cluster_21.png");
const CLUSTER_50_PLUS = require("../../assets/demo/cluster/cluster_50.png");
const CLUSTER_99_PLUS = require("../../assets/demo/cluster/cluster_99.png");
const CLUSTER_DEFAULT = require("../../assets/demo/cluster/_default.png");

/**
 * Get the pre-composited cluster marker image for a given count.
 * Returns a require() reference for Marker image prop.
 *
 * @param count - Number of items in the cluster
 */
export function getDemoClusterImage(count: number): any {
  if (count <= 1) {
    return CLUSTER_DEFAULT;
  }
  if (count <= 20) {
    return CLUSTER_IMAGES[count] ?? CLUSTER_DEFAULT;
  }
  if (count <= 50) {
    return CLUSTER_21_PLUS;
  }
  if (count <= 99) {
    return CLUSTER_50_PLUS;
  }
  return CLUSTER_99_PLUS;
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
  console.log(`Generated: ${generated.length} count markers + 3 buckets + default`);
  console.log('\nDone! Now update nearby.tsx to use getDemoClusterImage().');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
