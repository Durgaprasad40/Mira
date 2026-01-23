import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Alert,
  TextInput,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { COLORS } from '@/lib/constants';
import { Button } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';

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
  const { userId: currentUserId } = useAuthStore();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [customDare, setCustomDare] = useState('');

  const sendDare = useMutation(api.dares.sendDare);

  const handleSendDare = async (dareText: string) => {
    if (!currentUserId || !userId) return;

    try {
      await sendDare({
        fromUserId: currentUserId as any,
        toUserId: userId as any,
        content: dareText,
      });
      Alert.alert('Dare Sent!', 'Your dare has been sent. If they accept, you\'ll both be revealed!', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to send dare');
    }
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Send a Dare</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.content}>
        <Text style={styles.description}>
          Send a dare to this person. If they accept, both of your identities will be revealed and
          you'll automatically match!
        </Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Dare Categories</Text>
          {DARE_CATEGORIES.map((category) => (
            <View key={category.id} style={styles.category}>
              <TouchableOpacity
                style={styles.categoryHeader}
                onPress={() =>
                  setSelectedCategory(selectedCategory === category.id ? null : category.id)
                }
              >
                <Text style={styles.categoryTitle}>{category.title}</Text>
                <Ionicons
                  name={selectedCategory === category.id ? 'chevron-up' : 'chevron-down'}
                  size={20}
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
                      <Text style={styles.dareText}>{dare}</Text>
                      <Ionicons name="arrow-forward" size={20} color={COLORS.primary} />
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Custom Dare</Text>
          <TextInput
            style={styles.customInput}
            placeholder="Write your own dare..."
            placeholderTextColor={COLORS.textLight}
            value={customDare}
            onChangeText={setCustomDare}
            multiline
            numberOfLines={4}
            maxLength={200}
          />
          <Text style={styles.charCount}>{customDare.length}/200</Text>
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
    padding: 16,
    paddingTop: Platform.OS === 'ios' ? 50 : 16,
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
  },
  content: {
    padding: 16,
  },
  description: {
    fontSize: 14,
    color: COLORS.textLight,
    lineHeight: 20,
    marginBottom: 24,
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 16,
  },
  category: {
    marginBottom: 12,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    overflow: 'hidden',
  },
  categoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  categoryTitle: {
    fontSize: 16,
    fontWeight: '600',
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
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  dareText: {
    flex: 1,
    fontSize: 14,
    color: COLORS.text,
    marginRight: 12,
  },
  customInput: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    padding: 16,
    fontSize: 15,
    color: COLORS.text,
    minHeight: 100,
    textAlignVertical: 'top',
    marginBottom: 8,
  },
  charCount: {
    fontSize: 12,
    color: COLORS.textLight,
    textAlign: 'right',
    marginBottom: 16,
  },
  sendButton: {
    marginTop: 8,
  },
});
