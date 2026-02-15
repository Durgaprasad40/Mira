import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { isDemoMode } from '@/hooks/useConvex';
import { useAuthStore } from '@/stores/authStore';
import { INCOGNITO_COLORS } from '@/lib/constants';

const C = INCOGNITO_COLORS;

type Category = 'general' | 'language';

export default function CreateRoomScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const authUserId = useAuthStore((s) => s.userId);

  const [roomName, setRoomName] = useState('');
  const [category, setCategory] = useState<Category>('general');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const createRoomMutation = useMutation(api.chatRooms.createRoom);

  const handleCreate = useCallback(async () => {
    const trimmedName = roomName.trim();
    if (!trimmedName) {
      Alert.alert('Error', 'Please enter a room name');
      return;
    }

    if (trimmedName.length < 2) {
      Alert.alert('Error', 'Room name must be at least 2 characters');
      return;
    }

    if (trimmedName.length > 50) {
      Alert.alert('Error', 'Room name must be 50 characters or less');
      return;
    }

    if (isDemoMode) {
      // Demo mode: just show success and go back
      Alert.alert('Success', `Room "${trimmedName}" created!`, [
        { text: 'OK', onPress: () => router.back() },
      ]);
      return;
    }

    if (!authUserId) {
      Alert.alert('Error', 'You must be logged in to create a room');
      return;
    }

    setIsSubmitting(true);
    try {
      const roomId = await createRoomMutation({
        name: trimmedName,
        createdBy: authUserId as Id<'users'>,
        category,
      });

      // Navigate to the new room (within Phase-2 tabs to keep tab bar)
      router.replace(`/(main)/(private)/(tabs)/chat-rooms/${roomId}` as any);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to create room');
    } finally {
      setIsSubmitting(false);
    }
  }, [roomName, category, authUserId, createRoomMutation, router]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Create Chat Room</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        style={styles.content}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Room Name Input */}
        <Text style={styles.label}>Room Name</Text>
        <TextInput
          style={styles.input}
          placeholder="Enter room name..."
          placeholderTextColor={C.textLight}
          value={roomName}
          onChangeText={setRoomName}
          maxLength={50}
          autoFocus
        />
        <Text style={styles.charCount}>{roomName.length}/50</Text>

        {/* Category Selection */}
        <Text style={styles.label}>Category</Text>
        <View style={styles.categoryRow}>
          <TouchableOpacity
            style={[
              styles.categoryBtn,
              category === 'general' && styles.categoryBtnActive,
            ]}
            onPress={() => setCategory('general')}
          >
            <Ionicons
              name="globe"
              size={20}
              color={category === 'general' ? '#FFFFFF' : C.textLight}
            />
            <Text
              style={[
                styles.categoryText,
                category === 'general' && styles.categoryTextActive,
              ]}
            >
              General
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.categoryBtn,
              category === 'language' && styles.categoryBtnActive,
            ]}
            onPress={() => setCategory('language')}
          >
            <Ionicons
              name="language"
              size={20}
              color={category === 'language' ? '#FFFFFF' : C.textLight}
            />
            <Text
              style={[
                styles.categoryText,
                category === 'language' && styles.categoryTextActive,
              ]}
            >
              Language
            </Text>
          </TouchableOpacity>
        </View>

        {/* Submit Button */}
        <TouchableOpacity
          style={[styles.createBtn, isSubmitting && styles.createBtnDisabled]}
          onPress={handleCreate}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.createBtnText}>Create Room</Text>
          )}
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.surface,
  },
  backBtn: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
  },
  content: {
    flex: 1,
    padding: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    backgroundColor: C.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: C.text,
    borderWidth: 1,
    borderColor: C.surface,
  },
  charCount: {
    fontSize: 12,
    color: C.textLight,
    textAlign: 'right',
    marginTop: 4,
  },
  categoryRow: {
    flexDirection: 'row',
    gap: 12,
  },
  categoryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: C.surface,
    borderRadius: 12,
    paddingVertical: 14,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  categoryBtnActive: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  categoryText: {
    fontSize: 14,
    fontWeight: '600',
    color: C.textLight,
  },
  categoryTextActive: {
    color: '#FFFFFF',
  },
  createBtn: {
    backgroundColor: C.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 32,
  },
  createBtnDisabled: {
    opacity: 0.6,
  },
  createBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
