import { useState } from "react";
import { Image, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { useKeyboardHeight } from "@/components/keyboard";
import { PostVideo } from "@/components/post-video";
import type { FeedPost } from "@/lib/feed";
import { colors, fonts, navyAlpha } from "@/lib/theme";

/**
 * The post's photos or video, pinned above the comments (Oct 2026: "I want
 * to see the images while I make comments").
 *
 * Stays put while the comments scroll under it, and shrinks — never
 * disappears — while the keyboard is up, so the photo you're talking about
 * is on screen the whole time you type. Whole photos (contain, on navy),
 * because a crop can cut out exactly what the comment is about; swipe
 * between several. A post with neither shows nothing.
 */
export function PostMediaPane({ post }: { post: FeedPost }) {
  const { width, height: screen } = useWindowDimensions();
  const keyboard = useKeyboardHeight();
  const photos = post.photos.filter((p) => p.url);
  const [page, setPage] = useState(0);

  if (photos.length === 0 && !post.video) return null;

  const height = Math.round(screen * (keyboard > 0 ? 0.2 : 0.36));

  if (post.video) {
    // PostVideo sizes itself from its width; pick the width that makes it this tall.
    const v = post.video;
    const ratio = v.width && v.height ? Math.min(v.height / v.width, 1.25) : 1.25;
    const w = Math.min(width, Math.round(height / ratio));
    return (
      <View style={[styles.pane, { height }]}>
        <PostVideo video={v} club={post.club} width={w} />
      </View>
    );
  }

  return (
    <View style={[styles.pane, { height }]}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
        style={{ width, height }}
      >
        {photos.map((p, i) => (
          <Image
            key={p.path}
            source={{ uri: p.url! }}
            style={{ width, height }}
            resizeMode="contain"
            accessibilityLabel={photos.length > 1 ? `Photo ${i + 1} of ${photos.length}` : "Photo"}
            accessibilityIgnoresInvertColors
          />
        ))}
      </ScrollView>
      {photos.length > 1 ? (
        <View style={styles.counter} pointerEvents="none">
          <Text style={styles.counterText}>
            {page + 1}/{photos.length}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pane: { backgroundColor: colors.navy900, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  counter: { position: "absolute", top: 8, right: 10, backgroundColor: navyAlpha(0.7), borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  counterText: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.cream50 },
});
