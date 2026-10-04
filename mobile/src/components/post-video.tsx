import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { coursePhoto } from "@/components/course-photos";
import type { FeedClub, FeedVideo } from "@/lib/feed";
import { HAS_VIDEO_PLAYER } from "@/lib/native-capabilities";
import { durationLabel } from "@/lib/post-video";
import { colors, creamAlpha, fonts, navyAlpha, radii } from "@/lib/theme";

/**
 * A post's video (0102), in the feed card and on the post screen.
 *
 * Nothing loads until it's tapped: a poster (the course's photograph under a
 * navy veil, a play button and the length), then the player in place with
 * the system controls. A feed of autoplaying players would cost every
 * member the data and battery of every clip they scroll past.
 *
 * The frame keeps the clip's shape up to 4:5 portrait (the photo rule);
 * taller clips are letterboxed on navy.
 */
export function PostVideo({ video, club, width }: { video: FeedVideo; club: FeedClub | null; width: number }) {
  const [playing, setPlaying] = useState(false);
  const ratio = video.width && video.height ? Math.min(video.height / video.width, 1.25) : 1.25;
  const height = Math.round(width * ratio);
  const length = durationLabel(video.durationMs);

  if (playing && HAS_VIDEO_PLAYER) {
    return <PlayingVideo url={video.url} width={width} height={height} />;
  }

  return (
    <Pressable
      onPress={() => setPlaying(true)}
      disabled={!HAS_VIDEO_PLAYER}
      style={[styles.frame, { width, height }]}
      accessibilityRole="button"
      accessibilityLabel={`Play video${length ? `, ${length}` : ""}`}
    >
      <Image source={coursePhoto(club?.id ?? null, club?.name ?? null)} style={styles.poster} resizeMode="cover" />
      <View style={styles.veil} />
      <View style={styles.play}>
        <Ionicons name="play" size={30} color={colors.navy900} style={{ marginLeft: 4 }} />
      </View>
      {HAS_VIDEO_PLAYER ? (
        length ? (
          <View style={styles.length}>
            <Ionicons name="videocam" size={12} color={colors.cream50} />
            <Text style={styles.lengthText}>{length}</Text>
          </View>
        ) : null
      ) : (
        <Text style={styles.update}>Update PinPals to watch videos</Text>
      )}
    </Pressable>
  );
}

function PlayingVideo({ url, width, height }: { url: string; width: number; height: number }) {
  // Required here, not imported at the top: expo-video's native half only
  // exists on newer builds, and this component only renders when it does.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useVideoPlayer, VideoView } = require("expo-video") as typeof import("expo-video");
  const player = useVideoPlayer(url, (p) => {
    p.loop = false;
    p.play();
  });
  return (
    <View style={[styles.frame, { width, height }]}>
      <VideoView player={player} style={StyleSheet.absoluteFill} nativeControls contentFit="contain" />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: radii.md, overflow: "hidden", backgroundColor: colors.navy900, alignItems: "center", justifyContent: "center" },
  poster: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%" },
  veil: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: navyAlpha(0.45) },
  play: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.gold400,
    borderWidth: 3,
    borderColor: creamAlpha(0.9),
    alignItems: "center",
    justifyContent: "center",
  },
  length: {
    position: "absolute",
    left: 10,
    bottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: navyAlpha(0.7),
    borderRadius: radii.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  lengthText: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.cream50 },
  update: { position: "absolute", bottom: 12, fontFamily: fonts.bodySemi, fontSize: 13, color: colors.cream50 },
});
