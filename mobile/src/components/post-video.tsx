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
 * Oct 2026: the clip shows its own opening frame, with a play button and its
 * length over it — no course photograph, no veil (members read the veil as
 * "a cover over the video"). The player is created paused, so only enough
 * of the clip to draw that frame is fetched (a one-second buffer); nothing plays until tapped, and
 * then it plays in place, with the system controls, from the same player.
 * The course photo shows only for the moment before the frame arrives, and
 * on a binary without the video player (with "Update PinPals…").
 *
 * The frame keeps the clip's shape up to 4:5 portrait (the photo rule);
 * taller clips are letterboxed on navy.
 */
export function PostVideo({ video, club, width }: { video: FeedVideo; club: FeedClub | null; width: number }) {
  const ratio = video.width && video.height ? Math.min(video.height / video.width, 1.25) : 1.25;
  const height = Math.round(width * ratio);
  const length = durationLabel(video.durationMs);

  if (HAS_VIDEO_PLAYER) return <LiveVideo url={video.url} club={club} width={width} height={height} length={length} />;

  return (
    <View style={[styles.frame, { width, height }]}>
      <Image source={coursePhoto(club?.id ?? null, club?.name ?? null)} style={styles.poster} resizeMode="cover" />
      <View style={styles.veil} />
      <Text style={styles.update}>Update PinPals to watch videos</Text>
    </View>
  );
}

function LiveVideo({ url, club, width, height, length }: { url: string; club: FeedClub | null; width: number; height: number; length: string | null }) {
  // Required here, not imported at the top: expo-video's native half only
  // exists on newer builds, and this component only renders when it does.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useVideoPlayer, VideoView } = require("expo-video") as typeof import("expo-video");
  const [playing, setPlaying] = useState(false);
  const [frame, setFrame] = useState(false);
  const player = useVideoPlayer(url, (p) => {
    p.loop = false;
    // Paused in a feed: fetch little more than the first frame until tapped
    // (a 0 would let iOS decide, which means buffering ahead).
    p.bufferOptions = { preferredForwardBufferDuration: 1, waitsToMinimizeStalling: true };
  });

  return (
    <View style={[styles.frame, { width, height }]}>
      {!frame ? <Image source={coursePhoto(club?.id ?? null, club?.name ?? null)} style={styles.poster} resizeMode="cover" /> : null}
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        nativeControls={playing}
        contentFit={playing ? "contain" : "cover"}
        onFirstFrameRender={() => setFrame(true)}
      />
      {!playing ? (
        <Pressable
          onPress={() => {
            setPlaying(true);
            player.play();
          }}
          style={styles.tap}
          accessibilityRole="button"
          accessibilityLabel={`Play video${length ? `, ${length}` : ""}`}
        >
          <View style={styles.play}>
            <Ionicons name="play" size={26} color={colors.navy900} style={{ marginLeft: 3 }} />
          </View>
          {length ? (
            <View style={styles.length}>
              <Ionicons name="videocam" size={12} color={colors.cream50} />
              <Text style={styles.lengthText}>{length}</Text>
            </View>
          ) : null}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: radii.md, overflow: "hidden", backgroundColor: colors.navy900, alignItems: "center", justifyContent: "center" },
  poster: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%" },
  veil: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: navyAlpha(0.45) },
  tap: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  play: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.gold400,
    borderWidth: 2,
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
