/**
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
    case "demo_profile_12":
      return require("../../assets/demo/markers/demo_profile_12.png");
    case "demo_profile_18":
      return require("../../assets/demo/markers/demo_profile_18.png");
    case "demo_profile_9":
      return require("../../assets/demo/markers/demo_profile_9.png");
    default:
      return require("../../assets/demo/markers/_default.png");
  }
}
