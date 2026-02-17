import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Dimensions,
  TouchableOpacity,
} from "react-native";
import { useRouter } from "expo-router";
import { COLORS, SWIPE_CONFIG } from "@/lib/constants";
import { Button } from "@/components/ui";
import { useOnboardingStore } from "@/stores/onboardingStore";
import { useAuthStore } from "@/stores/authStore";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { isDemoMode } from "@/hooks/useConvex";
import { useDemoStore } from "@/stores/demoStore";
import { useDemoDmStore } from "@/stores/demoDmStore";

const { width } = Dimensions.get("window");

export default function TutorialScreen() {
  const router = useRouter();
  const { reset } = useOnboardingStore();
  const { setOnboardingCompleted } = useAuthStore();
  const [currentStep, setCurrentStep] = useState(0);

  const steps = [
    {
      title: "Swipe Right to Like",
      description: "Swipe right or tap the heart to like someone",
      icon: "heart",
      color: COLORS.like,
      gesture: "right",
    },
    {
      title: "Swipe Left to Pass",
      description: "Swipe left or tap the X to pass on someone",
      icon: "close",
      color: COLORS.pass,
      gesture: "left",
    },
    {
      title: "Swipe Up for Super Like",
      description: "Swipe up or tap the star to super like someone",
      icon: "star",
      color: COLORS.superLike,
      gesture: "up",
    },
    {
      title: "Tap to See More",
      description: "Tap on a profile card to see full details and photos",
      icon: "expand",
      color: COLORS.primary,
      gesture: "tap",
    },
  ];

  const handleComplete = () => {
    // OB-4 fix: Mark onboarding complete ONLY here (after tutorial is finished)
    // This ensures user sees the tutorial before being marked complete
    setOnboardingCompleted(true);
    reset();
    if (isDemoMode) {
      // OB-4: Mark demo onboarding complete (moved from review.tsx)
      const userId = useAuthStore.getState().userId;
      if (userId) {
        useDemoStore.getState().setDemoOnboardingComplete(userId);
      }
      // OB-8 fix: Only clear DM data if store is empty (fresh onboarding)
      // This prevents data loss if user somehow re-enters onboarding/tutorial
      const dmState = useDemoDmStore.getState();
      const hasExistingData = Object.keys(dmState.conversations).length > 0;
      if (!hasExistingData) {
        useDemoDmStore.setState({ conversations: {}, meta: {}, drafts: {} });
      }
      // Seed demo profiles/matches/likes
      useDemoStore.getState().seed();
    }
    router.replace("/(main)/(tabs)/home");
  };

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleComplete();
    }
  };

  const handleSkip = () => {
    handleComplete();
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[COLORS.primary, COLORS.secondary]}
        style={styles.gradient}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={handleSkip} style={styles.skipButton}>
            <Text style={styles.skipText}>Skip</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.content}>
          <View style={styles.iconContainer}>
            <View
              style={[
                styles.iconCircle,
                { backgroundColor: steps[currentStep].color + "40" },
              ]}
            >
              <Ionicons
                name={steps[currentStep].icon as any}
                size={64}
                color={steps[currentStep].color}
              />
            </View>
          </View>

          <Text style={styles.title}>{steps[currentStep].title}</Text>
          <Text style={styles.description}>
            {steps[currentStep].description}
          </Text>

          <View style={styles.gestureDemo}>
            {steps[currentStep].gesture === "right" && (
              <View style={styles.swipeDemo}>
                <View style={styles.card}>
                  <Ionicons
                    name="arrow-forward"
                    size={32}
                    color={COLORS.like}
                  />
                </View>
                <Text style={styles.gestureText}>Swipe Right →</Text>
              </View>
            )}
            {steps[currentStep].gesture === "left" && (
              <View style={styles.swipeDemo}>
                <View style={styles.card}>
                  <Ionicons name="arrow-back" size={32} color={COLORS.pass} />
                </View>
                <Text style={styles.gestureText}>← Swipe Left</Text>
              </View>
            )}
            {steps[currentStep].gesture === "up" && (
              <View style={styles.swipeDemo}>
                <View style={styles.card}>
                  <Ionicons
                    name="arrow-up"
                    size={32}
                    color={COLORS.superLike}
                  />
                </View>
                <Text style={styles.gestureText}>↑ Swipe Up</Text>
              </View>
            )}
            {steps[currentStep].gesture === "tap" && (
              <View style={styles.swipeDemo}>
                <View style={styles.card}>
                  <Ionicons name="hand-left" size={32} color={COLORS.primary} />
                </View>
                <Text style={styles.gestureText}>Tap to View</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.footer}>
          <View style={styles.dots}>
            {steps.map((_, index) => (
              <View
                key={index}
                style={[styles.dot, index === currentStep && styles.dotActive]}
              />
            ))}
          </View>

          <Button
            title={currentStep === steps.length - 1 ? "Get Started" : "Next"}
            variant="primary"
            onPress={handleNext}
            fullWidth
            style={styles.nextButton}
          />
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  gradient: {
    flex: 1,
  },
  header: {
    paddingTop: 60,
    paddingHorizontal: 24,
    alignItems: "flex-end",
  },
  skipButton: {
    padding: 8,
  },
  skipText: {
    fontSize: 16,
    color: COLORS.white,
    fontWeight: "500",
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  iconContainer: {
    marginBottom: 40,
  },
  iconCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 32,
    fontWeight: "700",
    color: COLORS.white,
    marginBottom: 16,
    textAlign: "center",
  },
  description: {
    fontSize: 18,
    color: COLORS.white,
    textAlign: "center",
    lineHeight: 26,
    opacity: 0.9,
  },
  gestureDemo: {
    marginTop: 60,
    alignItems: "center",
  },
  swipeDemo: {
    alignItems: "center",
  },
  card: {
    width: 200,
    height: 300,
    borderRadius: 20,
    backgroundColor: COLORS.white + "20",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  gestureText: {
    fontSize: 18,
    color: COLORS.white,
    fontWeight: "600",
  },
  footer: {
    padding: 24,
    paddingBottom: 40,
  },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    marginBottom: 24,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.white + "40",
  },
  dotActive: {
    backgroundColor: COLORS.white,
    width: 24,
  },
  nextButton: {
    backgroundColor: COLORS.white,
  },
});
