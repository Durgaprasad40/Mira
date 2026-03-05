import { DiscoverCardStack } from "@/components/screens/DiscoverCardStack";
import { useScreenTrace } from "@/lib/devTrace";

export default function DesireLandScreen() {
  useScreenTrace("P2_DESIRE_LAND");
  return <DiscoverCardStack theme="dark" mode="phase2" />;
}
