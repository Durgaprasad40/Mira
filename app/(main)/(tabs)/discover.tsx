import React from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DiscoverFeed } from "@/components/screens/DiscoverFeed";

export default function DiscoverScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, paddingTop: insets.top }}>
      <DiscoverFeed />
    </View>
  );
}
