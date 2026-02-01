import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  Modal,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';

const C = INCOGNITO_COLORS;
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const NUM_COLUMNS = 2;
const GIF_SIZE = (SCREEN_WIDTH - 48) / NUM_COLUMNS;

// Tenor v2 API — get a free key at https://developers.google.com/tenor/guides/quickstart
// For demo: uses a limited key; replace with your own
const TENOR_API_KEY = 'AIzaSyA0Dx0YlhgiKPEQPBwDbfMBOHB7MUEqjGU';
const TENOR_BASE = 'https://tenor.googleapis.com/v2';

interface GifItem {
  id: string;
  url: string;       // full GIF URL
  previewUrl: string; // smaller preview
  width: number;
  height: number;
}

// Curated fallback GIFs in case API fails
const FALLBACK_GIFS: GifItem[] = [
  { id: 'f1', url: 'https://media.tenor.com/images/a385e11839249af6de6a9a0c09e0e261/tenor.gif', previewUrl: 'https://media.tenor.com/images/a385e11839249af6de6a9a0c09e0e261/tenor.gif', width: 220, height: 164 },
  { id: 'f2', url: 'https://media.tenor.com/images/69fe6b4efd51e21ee71bbfa1540ceec9/tenor.gif', previewUrl: 'https://media.tenor.com/images/69fe6b4efd51e21ee71bbfa1540ceec9/tenor.gif', width: 220, height: 220 },
  { id: 'f3', url: 'https://media.tenor.com/images/b97a95a4310180e1ee02914d42bca541/tenor.gif', previewUrl: 'https://media.tenor.com/images/b97a95a4310180e1ee02914d42bca541/tenor.gif', width: 220, height: 166 },
  { id: 'f4', url: 'https://media.tenor.com/images/2f9d1dcfac4040164e4c22d7e7b67e8e/tenor.gif', previewUrl: 'https://media.tenor.com/images/2f9d1dcfac4040164e4c22d7e7b67e8e/tenor.gif', width: 220, height: 220 },
  { id: 'f5', url: 'https://media.tenor.com/images/5e32be2a24e3441413bdc70e6e8f021b/tenor.gif', previewUrl: 'https://media.tenor.com/images/5e32be2a24e3441413bdc70e6e8f021b/tenor.gif', width: 220, height: 220 },
  { id: 'f6', url: 'https://media.tenor.com/images/3533bf7b2b624285e4c519e4b3e94d64/tenor.gif', previewUrl: 'https://media.tenor.com/images/3533bf7b2b624285e4c519e4b3e94d64/tenor.gif', width: 220, height: 124 },
  { id: 'f7', url: 'https://media.tenor.com/images/18c4890a86f45eab90b2e8b7ca817584/tenor.gif', previewUrl: 'https://media.tenor.com/images/18c4890a86f45eab90b2e8b7ca817584/tenor.gif', width: 220, height: 220 },
  { id: 'f8', url: 'https://media.tenor.com/images/87e2baa50dddda0d6db9ab8d168550d0/tenor.gif', previewUrl: 'https://media.tenor.com/images/87e2baa50dddda0d6db9ab8d168550d0/tenor.gif', width: 220, height: 220 },
];

function parseTenorResults(data: any): GifItem[] {
  if (!data?.results) return [];
  return data.results.map((r: any) => {
    const gif = r.media_formats?.gif || r.media_formats?.tinygif;
    const preview = r.media_formats?.tinygif || r.media_formats?.gif;
    return {
      id: r.id,
      url: gif?.url || '',
      previewUrl: preview?.url || gif?.url || '',
      width: gif?.dims?.[0] || 220,
      height: gif?.dims?.[1] || 220,
    };
  }).filter((g: GifItem) => g.url);
}

interface GifPickerModalProps {
  visible: boolean;
  onClose: () => void;
  onGifSelected: (gifUrl: string) => void;
}

export default function GifPickerModal({ visible, onClose, onGifSelected }: GifPickerModalProps) {
  const [query, setQuery] = useState('');
  const [gifs, setGifs] = useState<GifItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch trending on open
  useEffect(() => {
    if (visible) {
      fetchTrending();
    }
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [visible]);

  const fetchTrending = async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(
        `${TENOR_BASE}/featured?key=${TENOR_API_KEY}&limit=30&media_filter=gif,tinygif&contentfilter=medium`
      );
      if (!res.ok) throw new Error('API error');
      const data = await res.json();
      const parsed = parseTenorResults(data);
      setGifs(parsed.length > 0 ? parsed : FALLBACK_GIFS);
    } catch {
      setGifs(FALLBACK_GIFS);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const fetchSearch = async (q: string) => {
    if (!q.trim()) {
      fetchTrending();
      return;
    }
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(
        `${TENOR_BASE}/search?q=${encodeURIComponent(q)}&key=${TENOR_API_KEY}&limit=30&media_filter=gif,tinygif&contentfilter=medium`
      );
      if (!res.ok) throw new Error('API error');
      const data = await res.json();
      const parsed = parseTenorResults(data);
      setGifs(parsed.length > 0 ? parsed : FALLBACK_GIFS);
    } catch {
      setGifs(FALLBACK_GIFS);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const handleSearchChange = useCallback((text: string) => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchSearch(text);
    }, 500);
  }, []);

  const handleSelect = useCallback((gif: GifItem) => {
    onGifSelected(gif.url);
    onClose();
    setQuery('');
  }, [onGifSelected, onClose]);

  const renderGif = useCallback(({ item }: { item: GifItem }) => (
    <TouchableOpacity
      style={styles.gifItem}
      onPress={() => handleSelect(item)}
      activeOpacity={0.7}
    >
      <Image
        source={{ uri: item.previewUrl }}
        style={styles.gifImage}
        contentFit="cover"
        recyclingKey={item.id}
      />
    </TouchableOpacity>
  ), [handleSelect]);

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={24} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.title}>GIFs</Text>
          <View style={{ width: 24 }} />
        </View>

        {/* Search */}
        <View style={styles.searchRow}>
          <Ionicons name="search" size={18} color={C.textLight} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search GIFs..."
            placeholderTextColor={C.textLight}
            value={query}
            onChangeText={handleSearchChange}
            autoFocus={false}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => { setQuery(''); fetchTrending(); }}>
              <Ionicons name="close-circle" size={18} color={C.textLight} />
            </TouchableOpacity>
          )}
        </View>

        {error && (
          <Text style={styles.errorText}>Using cached GIFs — check your connection</Text>
        )}

        {/* GIF Grid */}
        {loading && gifs.length === 0 ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={C.primary} />
          </View>
        ) : (
          <FlatList
            data={gifs}
            keyExtractor={(item) => item.id}
            renderItem={renderGif}
            numColumns={NUM_COLUMNS}
            contentContainerStyle={styles.gridContent}
            showsVerticalScrollIndicator={false}
          />
        )}

        {/* Tenor attribution */}
        <View style={styles.attribution}>
          <Text style={styles.attributionText}>Powered by Tenor</Text>
        </View>
      </View>
    </Modal>
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
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.accent,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: C.text,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: C.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.accent,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: C.text,
    padding: 0,
  },
  errorText: {
    fontSize: 11,
    color: C.textLight,
    textAlign: 'center',
    marginBottom: 4,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  gridContent: {
    paddingHorizontal: 12,
    paddingBottom: 24,
  },
  gifItem: {
    width: GIF_SIZE,
    height: GIF_SIZE,
    margin: 4,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: C.surface,
  },
  gifImage: {
    width: '100%',
    height: '100%',
  },
  attribution: {
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: C.surface,
    borderTopWidth: 1,
    borderTopColor: C.accent,
  },
  attributionText: {
    fontSize: 10,
    color: C.textLight,
  },
});
