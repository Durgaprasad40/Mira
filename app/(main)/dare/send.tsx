import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  TextInput,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { COLORS, FONT_SIZE, SPACING, SIZES, lineHeight, moderateScale } from '@/lib/constants';
import { Button } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const TEXT_MAX_SCALE = 1.2;
const HEADER_ICON_SIZE = SIZES.icon.lg;
const ALERT_ICON_SIZE = moderateScale(44, 0.25);
const CATEGORY_CHEVRON_SIZE = SIZES.icon.md;

const DARE_CATEGORIES = [
  {
    id: 'fun',
    title: 'Fun & Games',
    dares: [
      'Send me a funny selfie',
      'Tell me your most embarrassing story',
      'Do your best impression',
      'Share your favorite joke',
    ],
  },
  {
    id: 'creative',
    title: 'Creative',
    dares: [
      'Draw something and send it',
      'Write a haiku about yourself',
      'Sing a song and send a voice note',
      'Create a mini dance video',
    ],
  },
  {
    id: 'personal',
    title: 'Personal',
    dares: [
      'Share a childhood memory',
      'Tell me about your biggest fear',
      'What\'s your wildest dream?',
      'Share something you\'ve never told anyone',
    ],
  },
  {
    id: 'adventure',
    title: 'Adventure',
    dares: [
      'Plan our first date',
      'Tell me where you\'d take me on a trip',
      'What adventure would you want to do together?',
      'Describe your perfect day',
    ],
  },
];

export default function SendDareScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const router = useRouter();
  const currentUserId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);
  const insets = useSafeAreaInsets();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [customDare, setCustomDare] = useState('');

  const sendDare = useMutation(api.dares.sendDare);

  // Guard: require userId param
  if (!userId) {
    return (
      <View style={[styles.container, styles.errorContainer]}>
        <Ionicons name="alert-circle-outline" size={ALERT_ICON_SIZE} color={COLORS.textMuted} />
        <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.errorText}>User not found</Text>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const handleSendDare = async (dareText: string) => {
    if (!currentUserId || !userId) return;
    if (!token) {
      Alert.alert('Error', 'Please sign in again to send a dare.');
      return;
    }

    try {
      // TOD-AUTH-1 FIX: pass session token; authUserId is now only a cross-check hint.
      await sendDare({
        token,
        toUserId: userId as any,
        content: dareText,
        authUserId: currentUserId,
      });
      Alert.alert('Dare Sent!', 'Your dare has been sent. If they accept, you\'ll both be revealed!', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to send dare');
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, SPACING.base) + SPACING.base }}
      showsVerticalScrollIndicator={false}
    >
      <View style={[styles.header, { paddingTop: insets.top + SPACING.base }]}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={HEADER_ICON_SIZE} color={COLORS.text} />
        </TouchableOpacity>
        <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.headerTitle}>Send a Dare</Text>
        <View style={{ width: HEADER_ICON_SIZE }} />
      </View>

      <View style={styles.content}>
        <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.description}>
          Send a dare to this person. If they accept, both of your identities will be revealed and
          you'll automatically match!
        </Text>

        <View style={styles.section}>
          <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.sectionTitle}>Dare Categories</Text>
          {DARE_CATEGORIES.map((category) => (
            <View key={category.id} style={styles.category}>
              <TouchableOpacity
                style={styles.categoryHeader}
                onPress={() =>
                  setSelectedCategory(selectedCategory === category.id ? null : category.id)
                }
              >
                <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.categoryTitle}>{category.title}</Text>
                <Ionicons
                  name={selectedCategory === category.id ? 'chevron-up' : 'chevron-down'}
                  size={CATEGORY_CHEVRON_SIZE}
                  color={COLORS.textLight}
                />
              </TouchableOpacity>
              {selectedCategory === category.id && (
                <View style={styles.daresList}>
                  {category.dares.map((dare, index) => (
                    <TouchableOpacity
                      key={index}
                      style={styles.dareItem}
                      onPress={() => handleSendDare(dare)}
                    >
                      <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.dareText}>{dare}</Text>
                      <Ionicons name="arrow-forward" size={CATEGORY_CHEVRON_SIZE} color={COLORS.primary} />
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.sectionTitle}>Custom Dare</Text>
          <TextInput
            style={styles.customInput}
            placeholder="Write your own dare..."
            placeholderTextColor={COLORS.textLight}
            maxFontSizeMultiplier={TEXT_MAX_SCALE}
            value={customDare}
            onChangeText={setCustomDare}
            multiline
            numberOfLines={4}
            maxLength={200}
          />
          <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.charCount}>{customDare.length}/200</Text>
          <Button
            title="Send Custom Dare"
            variant="primary"
            onPress={() => {
              if (customDare.trim()) {
                handleSendDare(customDare.trim());
              }
            }}
            disabled={!customDare.trim()}
            style={styles.sendButton}
          />
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.base,
    paddingBottom: SPACING.base,
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: FONT_SIZE.xxl,
    fontWeight: '600',
    lineHeight: lineHeight(FONT_SIZE.xxl, 1.2),
    color: COLORS.text,
  },
  content: {
    padding: SPACING.base,
  },
  description: {
    fontSize: FONT_SIZE.body,
    color: COLORS.textLight,
    lineHeight: lineHeight(FONT_SIZE.body, 1.35),
    marginBottom: SPACING.xl,
  },
  section: {
    marginBottom: SPACING.xxl,
  },
  sectionTitle: {
    fontSize: FONT_SIZE.xl,
    fontWeight: '600',
    lineHeight: lineHeight(FONT_SIZE.xl, 1.2),
    color: COLORS.text,
    marginBottom: SPACING.base,
  },
  category: {
    marginBottom: SPACING.md,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: SIZES.radius.md,
    overflow: 'hidden',
  },
  categoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACING.base,
  },
  categoryTitle: {
    fontSize: FONT_SIZE.lg,
    fontWeight: '600',
    lineHeight: lineHeight(FONT_SIZE.lg, 1.2),
    color: COLORS.text,
  },
  daresList: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  dareItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACING.base,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  dareText: {
    flex: 1,
    fontSize: FONT_SIZE.body,
    color: COLORS.text,
    lineHeight: lineHeight(FONT_SIZE.body, 1.35),
    marginRight: SPACING.md,
  },
  customInput: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: SIZES.radius.md,
    padding: SPACING.base,
    fontSize: FONT_SIZE.md,
    color: COLORS.text,
    lineHeight: lineHeight(FONT_SIZE.md, 1.35),
    minHeight: moderateScale(96, 0.25),
    textAlignVertical: 'top',
    marginBottom: SPACING.sm,
  },
  charCount: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textLight,
    lineHeight: lineHeight(FONT_SIZE.caption, 1.2),
    textAlign: 'right',
    marginBottom: SPACING.base,
  },
  sendButton: {
    marginTop: SPACING.sm,
  },
  errorContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.xxl,
  },
  errorText: {
    fontSize: FONT_SIZE.lg,
    color: COLORS.textMuted,
    lineHeight: lineHeight(FONT_SIZE.lg, 1.35),
    marginTop: SPACING.md,
    marginBottom: SPACING.lg,
  },
  backButton: {
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.primary,
    borderRadius: SIZES.radius.sm,
  },
  backButtonText: {
    fontSize: FONT_SIZE.body,
    fontWeight: '600',
    lineHeight: lineHeight(FONT_SIZE.body, 1.2),
    color: COLORS.white,
  },
});
