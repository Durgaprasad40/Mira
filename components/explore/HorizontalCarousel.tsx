import React from 'react';
import { FlatList, StyleSheet } from 'react-native';
import { ProfileCard } from './ProfileCard';

interface HorizontalCarouselProps {
  profiles: any[];
  onPressProfile: (profile: any) => void;
}

export function HorizontalCarousel({ profiles, onPressProfile }: HorizontalCarouselProps) {
  if (profiles.length === 0) return null;

  return (
    <FlatList
      data={profiles}
      horizontal
      showsHorizontalScrollIndicator={false}
      keyExtractor={(item, index) => item._id ?? item.id ?? `profile_${index}`}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => (
        <ProfileCard profile={item} onPress={() => onPressProfile(item)} />
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    paddingHorizontal: 16,
    gap: 10,
  },
});
