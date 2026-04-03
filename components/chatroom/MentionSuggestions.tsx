import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { GENDER_COLORS } from '@/lib/responsive';

const C = INCOGNITO_COLORS;

export interface MentionMember {
  id: string;           // User ID
  nickname: string;     // Chat room nickname
  avatar?: string;      // Avatar URL
  age?: number;         // Age for display
  gender?: 'male' | 'female' | 'other';
}

interface MentionSuggestionsProps {
  members: MentionMember[];
  searchText: string;
  onSelect: (member: MentionMember) => void;
  isLoading?: boolean;
}

/**
 * Dropdown suggestion list for @mentions
 * Shows filtered room members when user types "@"
 */
export default function MentionSuggestions({
  members,
  searchText,
  onSelect,
  isLoading = false,
}: MentionSuggestionsProps) {
  // Filter members by search text (case insensitive)
  const filteredMembers = React.useMemo(() => {
    if (!searchText) return members;
    const search = searchText.toLowerCase();
    return members.filter((m) =>
      m.nickname.toLowerCase().includes(search)
    );
  }, [members, searchText]);

  // Don't render if no matches
  if (!isLoading && filteredMembers.length === 0) {
    return null;
  }

  const renderMember = ({ item }: { item: MentionMember }) => {
    const ringColor = GENDER_COLORS[item.gender || 'default'];
    const displayName = item.age ? `${item.nickname}, ${item.age}` : item.nickname;

    return (
      <TouchableOpacity
        style={styles.memberRow}
        onPress={() => onSelect(item)}
        activeOpacity={0.7}
      >
        {/* Avatar with gender ring */}
        <View style={[styles.avatarContainer, { borderColor: ringColor }]}>
          {item.avatar ? (
            <Image
              source={{ uri: item.avatar }}
              style={styles.avatar}
              contentFit="cover"
            />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarInitial}>
                {item.nickname.charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
        </View>

        {/* Nickname with age */}
        <Text style={styles.nickname} numberOfLines={1}>
          {displayName}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={C.accent} />
        </View>
      ) : (
        <FlatList
          data={filteredMembers}
          keyExtractor={(item) => item.id}
          renderItem={renderMember}
          keyboardShouldPersistTaps="always"
          showsVerticalScrollIndicator={false}
          style={styles.list}
          maxToRenderPerBatch={10}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: C.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.1)',
    maxHeight: 200,
  },
  loadingContainer: {
    padding: 16,
    alignItems: 'center',
  },
  list: {
    maxHeight: 200,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  avatarContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    overflow: 'hidden',
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  avatarPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitial: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
  },
  nickname: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: C.text,
  },
});
