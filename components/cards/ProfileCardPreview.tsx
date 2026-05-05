import React, { memo, useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { COLORS, INCOGNITO_COLORS } from "@/lib/constants";
import { getRenderableProfilePhotos } from "@/lib/profileData";

const BLUR_RADIUS = 25;

interface ProfileCardPreviewProps {
  name: string;
  age?: number;
  isVerified?: boolean;
  photos: { url: string }[];
  photoBlurred?: boolean;
  theme?: "light" | "dark";
}

export const ProfileCardPreview = memo(function ProfileCardPreview({
  name,
  age,
  photos,
  photoBlurred = false,
  theme = "light",
}: ProfileCardPreviewProps) {
  const dark = theme === "dark";
  const C = dark ? INCOGNITO_COLORS : COLORS;
  const [imageError, setImageError] = useState(false);

  const displayName = useMemo(() => name || "Anonymous", [name]);
  const ageLabel = useMemo(
    () => (typeof age === "number" && age > 0 ? String(age) : null),
    [age],
  );
  const heroPhoto = useMemo(() => getRenderableProfilePhotos(photos)[0], [photos]);
  const handleImageError = useCallback(() => setImageError(true), []);

  return (
    <View style={[styles.card, dark && styles.cardDark]}>
      <View style={styles.photoContainer}>
        {heroPhoto && !imageError ? (
          <Image
            source={{ uri: heroPhoto.url }}
            style={styles.image}
            contentFit="cover"
            cachePolicy="memory-disk"
            blurRadius={photoBlurred ? BLUR_RADIUS : undefined}
            onError={handleImageError}
          />
        ) : (
          <View style={[styles.placeholder, dark && styles.placeholderDark]}>
            <Ionicons
              name="person"
              size={56}
              color={dark ? "rgba(255,255,255,0.28)" : C.textLight}
            />
          </View>
        )}

        <LinearGradient
          colors={
            dark
              ? [
                  "transparent",
                  "rgba(0,0,0,0.2)",
                  "rgba(0,0,0,0.55)",
                  "rgba(0,0,0,0.88)",
                ]
              : [
                  "transparent",
                  "rgba(0,0,0,0.12)",
                  "rgba(0,0,0,0.4)",
                  "rgba(0,0,0,0.78)",
                ]
          }
          locations={[0, 0.3, 0.65, 1]}
          style={styles.bottomGradient}
          pointerEvents="none"
        />
      </View>

      <View style={styles.overlay} pointerEvents="none">
        <View style={styles.identityRow}>
          <Text style={styles.name}>{displayName}</Text>
          {ageLabel && <Text style={styles.age}>{ageLabel}</Text>}
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: COLORS.backgroundDark,
    overflow: "hidden",
  },
  cardDark: {
    backgroundColor: "#0a0a0a",
  },
  photoContainer: {
    ...StyleSheet.absoluteFillObject,
  },
  image: {
    ...StyleSheet.absoluteFillObject,
  },
  placeholder: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.backgroundDark,
  },
  placeholderDark: {
    backgroundColor: "#0d0d0d",
  },
  bottomGradient: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "45%",
  },
  overlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingBottom: 14,
    paddingTop: 12,
  },
  identityRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  name: {
    fontSize: 28,
    fontWeight: "700",
    color: COLORS.white,
    marginRight: 8,
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  age: {
    fontSize: 24,
    fontWeight: "400",
    color: "rgba(255,255,255,0.88)",
    marginRight: 8,
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
});
