/*
 * LOCKED (DISCOVER TAB)
 * Do NOT modify this file unless Durga Prasad explicitly unlocks it.
 *
 * STATUS:
 * - Feature is stable and production-locked
 * - No logic/UI changes allowed
 */
import { View, StyleSheet } from "react-native";
import { DiscoverCardStack } from "@/components/screens/DiscoverCardStack";
import { useScreenTrace } from "@/lib/devTrace";

export default function HomeScreen() {
  useScreenTrace("HOME");

  return (
    <View style={styles.container}>
      <DiscoverCardStack />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
