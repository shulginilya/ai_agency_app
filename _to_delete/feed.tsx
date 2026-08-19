import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { EmptyState } from '@/components/EmptyState';
import { ProductCard } from '@/components/ProductCard';
import { Screen } from '@/components/Screen';
import { useProducts } from '@/hooks/useProducts';
import { radius, spacing, useTheme } from '@/theme';

export default function FeedScreen() {
  const { colors } = useTheme();
  const { data, loading, refreshing, error, reload, refresh } = useProducts();

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={[styles.h1, { color: colors.text }]}>Feed</Text>
        <Text style={[styles.sub, { color: colors.textMuted }]}>Live data from a public REST API</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <EmptyState icon="cloud-offline-outline" title="Couldn't load the feed" subtitle={error} />
          <Pressable onPress={reload} style={[styles.retry, { backgroundColor: colors.accent }]}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => <ProductCard product={item} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md },
  h1: { fontSize: 30, fontWeight: '700' },
  sub: { fontSize: 14, marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  retry: { paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.md },
  retryText: { color: '#fff', fontWeight: '600' },
});
