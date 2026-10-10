import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { inviteMessage, inviteUrl, myInviteCode, qrImageUrl, shareVia, type ShareChannel } from "@/lib/find-pinpals";
import { colors, fonts, spacing } from "@/lib/theme";

/**
 * Bring your fourball (approved mock-up 4; rewards left out).
 *
 * Your own link — pinpals.ie/join/<code> — by WhatsApp, text or anything
 * else, and the same link as a QR code to show in the clubhouse. The phone's
 * own camera reads it: the app opens if they have it, the website if not,
 * and either way tapping Connect connects you (connect_by_invite(), 0118).
 */
export default function InviteFriendsScreen() {
  const insets = useSafeAreaInsets();
  const [code, setCode] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [big, setBig] = useState(false);

  useEffect(() => {
    void myInviteCode().then((c) => (c ? setCode(c) : setFailed(true)));
  }, []);

  const share = (channel: ShareChannel) => {
    if (code) void shareVia(channel, inviteMessage(code));
  };

  return (
    <>
      <Stack.Screen options={{ headerTitle: "", headerBackTitle: "Back" }} />
      <ScrollView style={styles.fill} contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}>
        <View style={styles.band}>
          <View style={styles.rule} />
          <Text style={styles.title}>Bring your fourball</Text>
          <Text style={styles.subtitle}>
            PinPals is better with the people you already play with. Send your link — when they join, you&apos;re connected.
          </Text>
        </View>

        <View style={styles.body}>
          <View style={styles.shareRow}>
            <ShareButton icon="logo-whatsapp" label="WhatsApp" bg="#2f7a3e" fg="#ffffff" onPress={() => share("whatsapp")} disabled={!code} />
            <ShareButton icon="chatbubble-ellipses" label="Text" bg="#3b5b8c" fg="#ffffff" onPress={() => share("sms")} disabled={!code} />
            <ShareButton icon="share-outline" label="More" bg={colors.navy900} fg={colors.gold400} onPress={() => share("more")} disabled={!code} />
          </View>

          <Pressable onPress={() => code && setBig(true)} style={styles.card} accessibilityRole="button" accessibilityLabel="Show your QR code full screen">
            <View style={styles.qrBox}>
              {code ? (
                <Image source={{ uri: qrImageUrl(code) }} style={styles.qr} accessibilityLabel="Your PinPals QR code" />
              ) : failed ? (
                <Ionicons name="cloud-offline-outline" size={30} color={colors.ink500} />
              ) : (
                <ActivityIndicator color={colors.navy900} />
              )}
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.cardTitle}>Your PinPals code</Text>
              <Text style={styles.cardBody}>In the clubhouse? They point their phone camera at it and tap Connect — no searching.</Text>
              <Text style={styles.cardLink}>Show full screen</Text>
            </View>
          </Pressable>

          {code ? (
            <View style={styles.linkBox}>
              <Text style={styles.linkLabel}>Your link</Text>
              <Text style={styles.link} selectable>
                {inviteUrl(code).replace(/^https:\/\//, "")}
              </Text>
            </View>
          ) : null}

          <View style={styles.steps}>
            <Step n={1} text="Send your link or show your code" />
            <Step n={2} text="They join PinPals — it's free" />
            <Step n={3} text="You're connected straight away, ready to share tee times" />
          </View>
        </View>
      </ScrollView>

      <Modal visible={big} animationType="fade" transparent onRequestClose={() => setBig(false)}>
        <Pressable style={styles.modal} onPress={() => setBig(false)} accessibilityRole="button" accessibilityLabel="Close">
          <View style={styles.modalCard}>
            {code ? <Image source={{ uri: qrImageUrl(code) }} style={styles.qrBig} accessibilityLabel="Your PinPals QR code" /> : null}
            <Text style={styles.modalText}>Scan with your phone camera to connect on PinPals</Text>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

function ShareButton({ icon, label, bg, fg, onPress, disabled }: { icon: keyof typeof Ionicons.glyphMap; label: string; bg: string; fg: string; onPress: () => void; disabled: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.share, (pressed || disabled) && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel={`Invite by ${label}`}>
      <View style={[styles.shareCircle, { backgroundColor: bg }]}>
        <Ionicons name={icon} size={24} color={fg} />
      </View>
      <Text style={styles.shareLabel}>{label}</Text>
    </Pressable>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepNum}>
        <Text style={styles.stepNumText}>{n}</Text>
      </View>
      <Text style={styles.stepText}>{text}</Text>
    </View>
  );
}

const shadow = {
  shadowColor: colors.navy900,
  shadowOpacity: 0.08,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 3 },
  elevation: 2,
} as const;

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  band: { backgroundColor: colors.navy900, paddingHorizontal: 20, paddingTop: spacing.md, paddingBottom: 22, gap: 6 },
  rule: { width: 34, height: 3, borderRadius: 2, backgroundColor: colors.gold400 },
  title: { fontFamily: fonts.display, fontSize: 30, color: colors.cream50 },
  subtitle: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: "#c9d2de" },

  body: { padding: spacing.md, gap: 16 },
  shareRow: { flexDirection: "row", justifyContent: "space-around" },
  share: { alignItems: "center", gap: 6, minWidth: 80 },
  shareCircle: { width: 60, height: 60, borderRadius: 30, alignItems: "center", justifyContent: "center" },
  shareLabel: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.ink900 },

  card: { flexDirection: "row", alignItems: "center", gap: 16, backgroundColor: colors.surface, borderRadius: 18, padding: 16, ...shadow },
  qrBox: { width: 112, height: 112, borderRadius: 12, borderWidth: 1.5, borderColor: "#eee7d6", backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  qr: { width: 104, height: 104 },
  cardTitle: { fontSize: 15, fontWeight: "800", color: colors.navy900 },
  cardBody: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.ink500 },
  cardLink: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.navy900, marginTop: 2 },

  linkBox: { backgroundColor: "#fbf3dd", borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, gap: 2 },
  linkLabel: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: "#7a6a3e" },
  link: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.navy900 },

  steps: { gap: 10, paddingHorizontal: 4 },
  step: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepNum: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.gold400, alignItems: "center", justifyContent: "center" },
  stepNumText: { fontSize: 13, fontWeight: "800", color: colors.navy900 },
  stepText: { flex: 1, fontFamily: fonts.body, fontSize: 14, color: colors.ink900 },

  modal: { flex: 1, backgroundColor: "rgba(12,32,56,0.85)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  modalCard: { backgroundColor: "#ffffff", borderRadius: 24, padding: 24, alignItems: "center", gap: 14 },
  qrBig: { width: 280, height: 280 },
  modalText: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.navy900, textAlign: "center", maxWidth: 260 },
});
