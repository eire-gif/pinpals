import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { InviteBanner, SuggestionRow } from "@/components/pinpals";
import { OnboardingFrame } from "@/components/onboarding-frame";
import { useAuth } from "@/lib/auth";
import { markOnboarded, suggestedPinPals, type Suggestion } from "@/lib/onboarding";
import { colors, fonts, radii } from "@/lib/theme";

/**
 * Step 5 — Meet your PinPals.
 *
 * The step the whole builder leads up to: the home club and the courses are
 * what make these suggestions possible. Then the invite, because at launch
 * the suggestions list will often be short, and a member's own friends are
 * the cheapest new members PinPals will ever get.
 *
 * Finishing (or skipping) here is what sets `onboarded_at`, so the builder is
 * not offered again on the next sign-in.
 */
export default function PinPalsStep() {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const [people, setPeople] = useState<Suggestion[] | null>(null);

  useEffect(() => {
    void suggestedPinPals(8).then(setPeople);
  }, []);

  const finish = async () => {
    if (userId) await markOnboarded(userId);
    router.replace("/(tabs)");
  };

  return (
    <OnboardingFrame
      step={5}
      title="Meet your PinPals"
      sub="Golfers at your club and clubs nearby. Connect, and you'll see their tee times first."
      onBack={() => router.back()}
      onSkip={finish}
      onContinue={finish}
      continueLabel="Finish — take me in"
    >
      {people === null ? <ActivityIndicator color={colors.green700} /> : null}

      {people && people.length > 0 ? (
        <View style={styles.card}>
          {people.map((p, i) => (
            <SuggestionRow key={p.id} person={p} last={i === people.length - 1} />
          ))}
        </View>
      ) : null}

      {people && people.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>You&apos;re one of the first here.</Text>
          <Text style={styles.emptyBody}>
            Nobody at your club or nearby has joined yet. Invite the people you play with, and
            they&apos;ll be your first PinPals.
          </Text>
        </View>
      ) : null}

      <View style={styles.invite}>
        <InviteBanner />
      </View>
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.lg,
    paddingHorizontal: 14,
  },
  empty: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.lg,
    padding: 16,
  },
  emptyTitle: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink900 },
  emptyBody: { fontFamily: fonts.body, fontSize: 14.5, lineHeight: 21, color: "#3d4757", marginTop: 6 },
  invite: { marginTop: 12 },
});
