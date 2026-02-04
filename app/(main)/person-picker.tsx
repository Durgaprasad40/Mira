import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { COLORS } from '@/lib/constants';
import { DEMO_PROFILES } from '@/lib/demoData';
import { useDemoStore } from '@/stores/demoStore';
import { useInteractionStore } from '@/stores/interactionStore';

interface PersonItem {
  id: string;
  name: string;
  photoUrl: string;
}

export default function PersonPickerScreen() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const storeMatches = useDemoStore((s) => s.matches);

  const people: PersonItem[] = useMemo(() => {
    const fromMatches: PersonItem[] = storeMatches.map((m) => ({
      id: m.otherUser.id,
      name: m.otherUser.name,
      photoUrl: m.otherUser.photoUrl,
    }));
    const fromProfiles: PersonItem[] = DEMO_PROFILES.map((p) => ({
      id: p._id,
      name: p.name,
      photoUrl: p.photos[0]?.url || '',
    }));

    const seen = new Set<string>();
    const all: PersonItem[] = [];
    for (const person of [...fromMatches, ...fromProfiles]) {
      if (!seen.has(person.id)) {
        seen.add(person.id);
        all.push(person);
      }
    }
    return all;
  }, [storeMatches]);

  const filtered = useMemo(() => {
    if (!search.trim()) return people;
    const q = search.toLowerCase();
    return people.filter((p) => p.name.toLowerCase().includes(q));
  }, [people, search]);

  const handleSelect = (userId: string, name: string) => {
    useInteractionStore.getState().setPersonPickerResult({ userId, name });
    router.back();
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="close" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Confess to Someone</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.searchRow}>
        <Ionicons name="search" size={18} color={COLORS.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search..."
          placeholderTextColor={COLORS.textMuted}
          value={search}
          onChangeText={setSearch}
          autoFocus
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.personRow}
            onPress={() => handleSelect(item.id, item.name)}
          >
            <Image source={{ uri: item.photoUrl }} style={styles.personPhoto} />
            <Text style={styles.personName}>{item.name}</Text>
            <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
          </TouchableOpacity>
        )}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.emptyText}>No people found</Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: COLORS.backgroundDark,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: COLORS.text,
  },
  list: {
    paddingBottom: 40,
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  personPhoto: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.backgroundDark,
  },
  personName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  emptyText: {
    textAlign: 'center',
    marginTop: 40,
    fontSize: 15,
    color: COLORS.textMuted,
  },
});
