/*
 * LOCKED (PHASE-1 TAB)
 * Do NOT modify this file unless Durga Prasad explicitly unlocks it.
 * Nearby tab is the only Phase-1 tab currently unlocked.
 */
import { DiscoverCardStack } from "@/components/screens/DiscoverCardStack";
import { useScreenTrace } from "@/lib/devTrace";

export default function HomeScreen() {
  useScreenTrace("HOME");
  return <DiscoverCardStack />;
}
