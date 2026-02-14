/**
 * Auto-generated cluster marker mapping.
 * DO NOT EDIT MANUALLY — run: npm run gen:demo-clusters
 *
 * These are pre-composited cluster images (pink pin + count inside).
 * Using a single native Marker image eliminates all Android snapshot bugs.
 */

// Static require map (RN bundler needs static paths)
const CLUSTER_IMAGES: Record<number, any> = {
  2: require("../../assets/demo/cluster/cluster_2.png"),
  3: require("../../assets/demo/cluster/cluster_3.png"),
  4: require("../../assets/demo/cluster/cluster_4.png"),
  5: require("../../assets/demo/cluster/cluster_5.png"),
  6: require("../../assets/demo/cluster/cluster_6.png"),
  7: require("../../assets/demo/cluster/cluster_7.png"),
  8: require("../../assets/demo/cluster/cluster_8.png"),
  9: require("../../assets/demo/cluster/cluster_9.png"),
  10: require("../../assets/demo/cluster/cluster_10.png"),
  11: require("../../assets/demo/cluster/cluster_11.png"),
  12: require("../../assets/demo/cluster/cluster_12.png"),
  13: require("../../assets/demo/cluster/cluster_13.png"),
  14: require("../../assets/demo/cluster/cluster_14.png"),
  15: require("../../assets/demo/cluster/cluster_15.png"),
  16: require("../../assets/demo/cluster/cluster_16.png"),
  17: require("../../assets/demo/cluster/cluster_17.png"),
  18: require("../../assets/demo/cluster/cluster_18.png"),
  19: require("../../assets/demo/cluster/cluster_19.png"),
  20: require("../../assets/demo/cluster/cluster_20.png"),
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
