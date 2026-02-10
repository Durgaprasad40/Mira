import { Platform, View, Text, StyleSheet } from 'react-native';

/**
 * Custom sitemap route that safely handles native platforms.
 * Expo Router's built-in Sitemap uses window.location.origin which is undefined on Android.
 * This override prevents the crash by providing a safe fallback on native.
 */
export default function Sitemap() {
  // Sitemap is only useful on web - show a safe message on native
  if (Platform.OS !== 'web') {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>Sitemap is only available on web</Text>
      </View>
    );
  }

  // On web, we could render the actual sitemap, but for safety just show info
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Sitemap</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1a1a2e',
  },
  text: {
    fontSize: 16,
    color: '#888',
  },
});
