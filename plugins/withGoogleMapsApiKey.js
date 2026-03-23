const { withAndroidManifest } = require("@expo/config-plugins");

const withGoogleMapsApiKey = (config, { apiKey }) => {
  return withAndroidManifest(config, async (config) => {
    const androidManifest = config.modResults;
    const mainApplication = androidManifest.manifest.application[0];

    // Check if meta-data array exists
    if (!mainApplication["meta-data"]) {
      mainApplication["meta-data"] = [];
    }

    // Remove existing Google Maps API key if present
    mainApplication["meta-data"] = mainApplication["meta-data"].filter(
      (item) => item.$["android:name"] !== "com.google.android.geo.API_KEY"
    );

    // Add Google Maps API key
    mainApplication["meta-data"].push({
      $: {
        "android:name": "com.google.android.geo.API_KEY",
        "android:value": apiKey,
      },
    });

    return config;
  });
};

module.exports = withGoogleMapsApiKey;
