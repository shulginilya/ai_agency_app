import { Ionicons } from '@expo/vector-icons';
import { Image, StyleSheet, Text, View } from 'react-native';
import { radius, spacing, useTheme } from '@/theme';
import type { Product } from '@/types';

export function ProductCard({ product }: { product: Product }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Image source={{ uri: product.thumbnail }} style={styles.image} resizeMode="cover" />
      <View style={styles.body}>
        <Text numberOfLines={1} style={[styles.title, { color: colors.text }]}>
          {product.title}
        </Text>
        <Text numberOfLines={2} style={[styles.desc, { color: colors.textMuted }]}>
          {product.description}
        </Text>
        <View style={styles.meta}>
          <Text style={[styles.price, { color: colors.accent }]}>${product.price.toFixed(2)}</Text>
          <View style={styles.rating}>
            <Ionicons name="star" size={13} color={colors.textMuted} />
            <Text style={[styles.ratingText, { color: colors.textMuted }]}>{product.rating.toFixed(1)}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.sm,
  },
  image: { width: 64, height: 64, borderRadius: radius.sm, backgroundColor: '#00000010' },
  body: { flex: 1, gap: 2 },
  title: { fontSize: 16, fontWeight: '600' },
  desc: { fontSize: 13, lineHeight: 18 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.xs },
  price: { fontSize: 15, fontWeight: '700' },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  ratingText: { fontSize: 13 },
});
