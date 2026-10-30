import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, router, useFocusEffect } from "expo-router";

import { Kicker, proStyles } from "@/components/pro-bits";
import { useAuth } from "@/lib/auth";
import { loadMyProfile } from "@/lib/profile";
import { POLICY_LABEL, PRO_KIND_LABEL, type CancelPolicy, type ProKind } from "@/lib/pro-rules";
import { applyAsPro, loadMyPro } from "@/lib/pros";
import { SMART_COUNTIES } from "@/lib/smart-search";
import { colors, fonts, spacing } from "@/lib/theme";

const KINDS: ProKind[] = ["pga", "teaching", "fitter"];
const POLICIES: CancelPolicy[] = ["24h", "48h", "none"];
const BIO_MAX = 500;

/**
 * Book a pro (0204): apply to teach, or change your details. A PGA pro gives
 * their PGA number; a teaching pro or club fitter their qualification. A
 * short bio golfers read on your page, and your cancellation terms. Changing
 * your PGA number or qualification sends you back to PinPals to check.
 */
export default function ApplyScreen() {
  const { session } = useAuth();
  const me = session?.user?.id ?? null;
  const [ready, setReady] = useState(false);
  const [existing, setExisting] = useState(false);
  const [kind, setKind] = useState<ProKind>("pga");
  const [pga, setPga] = useState("");
  const [qual, setQual] = useState("");
  const [club, setClub] = useState("");
  const [county, setCounty] = useState<string | null>(null);
  const [countyOpen, setCountyOpen] = useState(false);
  const [bio, setBio] = useState("");
  const [policy, setPolicy] = useState<CancelPolicy>("24h");
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!me || ready) return;
      void (async () => {
        const [pro, profile] = await Promise.all([loadMyPro(me).catch(() => null), loadMyProfile(me).catch(() => null)]);
        if (pro) {
          setExisting(true);
          setKind(pro.kind);
          setPga(pro.pgaNumber ?? "");
          setQual(pro.qualification ?? "");
          setClub(pro.club);
          setCounty(pro.county);
          setBio(pro.bio ?? "");
          setPolicy(pro.cancelPolicy);
        } else if (profile) {
          setClub(profile.homeClub ?? "");
          setCounty(profile.county);
        }
        setReady(true);
      })();
    }, [me, ready])
  );

  if (!ready) {
    return (
      <View style={[proStyles.screen, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator color={colors.green700} />
      </View>
    );
  }

  const save = async () => {
    setBusy(true);
    try {
      await applyAsPro({ kind, pga_number: pga, qualification: qual, club, county, bio, cancel_policy: policy });
      if (!existing) Alert.alert("Sent to PinPals", "We'll check your details and tell you when you're live. Set up your lessons and hours meanwhile.");
      router.back();
    } catch (e) {
      Alert.alert("Couldn't save that", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={proStyles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Stack.Screen options={{ title: existing ? "Your details" : "Apply to teach" }} />
      <ScrollView contentContainerStyle={[proStyles.body, { paddingBottom: spacing.xl * 2 }]} keyboardShouldPersistTaps="handled">
        <Kicker>YOU ARE A…</Kicker>
        <View style={styles.row}>
          {KINDS.map((k) => (
            <Pressable key={k} onPress={() => setKind(k)} style={[proStyles.chip, kind === k && proStyles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: kind === k }}>
              <Text style={[proStyles.chipText, kind === k && proStyles.chipTextOn]}>{PRO_KIND_LABEL[k]}</Text>
            </Pressable>
          ))}
        </View>

        {kind === "pga" ? (
          <Field label="PGA membership number">
            <TextInput value={pga} onChangeText={setPga} maxLength={30} autoCapitalize="characters" style={proStyles.input} placeholder="Your PGA number" placeholderTextColor={colors.ink500} />
          </Field>
        ) : (
          <Field label="Your qualification" hint="What you hold and who it's from, e.g. Golf Ireland Level 3 coach, or a fitting certification.">
            <TextInput value={qual} onChangeText={setQual} maxLength={120} style={proStyles.input} placeholder="Qualification and who issued it" placeholderTextColor={colors.ink500} />
          </Field>
        )}

        <Field label="Where you teach">
          <TextInput value={club} onChangeText={setClub} maxLength={80} style={proStyles.input} placeholder="Club, range or studio" placeholderTextColor={colors.ink500} />
        </Field>

        <Field label="County">
          <Pressable style={[proStyles.input, { justifyContent: "center" }]} onPress={() => setCountyOpen((o) => !o)} accessibilityRole="button">
            <Text style={{ fontFamily: fonts.body, fontSize: 16, color: county ? colors.ink900 : colors.ink500 }}>{county ?? "Pick a county"}</Text>
          </Pressable>
          {countyOpen ? (
            <View style={[styles.row, { marginTop: 8 }]}>
              {SMART_COUNTIES.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => {
                    setCounty(c);
                    setCountyOpen(false);
                  }}
                  style={[proStyles.chip, county === c && proStyles.chipOn]}
                  accessibilityRole="button"
                >
                  <Text style={[proStyles.chipText, county === c && proStyles.chipTextOn]}>{c}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </Field>

        <Field label="A short bio" hint={`What golfers read on your page: who you teach, what you work on. ${BIO_MAX - bio.length} letters left.`}>
          <TextInput
            value={bio}
            onChangeText={setBio}
            maxLength={BIO_MAX}
            multiline
            style={[proStyles.input, { minHeight: 120, paddingTop: 12, textAlignVertical: "top" }]}
            placeholder="e.g. Head pro at the club for twelve years. I help golfers of every level find a swing they trust — beginners, juniors and single figures."
            placeholderTextColor={colors.ink500}
          />
        </Field>

        <Kicker>YOUR CANCELLATION TERMS</Kicker>
        <View style={styles.row}>
          {POLICIES.map((p) => (
            <Pressable key={p} onPress={() => setPolicy(p)} style={[proStyles.chip, { flex: 1 }, policy === p && proStyles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: policy === p }}>
              <Text style={[proStyles.chipText, policy === p && proStyles.chipTextOn]}>{POLICY_LABEL[p]}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={proStyles.hint}>
          {policy === "none" ? "Golfers who cancel don't get a refund." : `Golfers who cancel at least ${POLICY_LABEL[policy]} before get everything back; later, nothing.`} If you cancel, they always get everything back. Golfers see this before they pay.
        </Text>

        <View style={[proStyles.card, { padding: spacing.md, gap: 4 }]}>
          <Text style={proStyles.label}>You keep 90%</Text>
          <Text style={proStyles.hint}>PinPals keeps 10% of each lesson. The rest goes to your bank through Stripe once the lesson's time has passed.</Text>
        </View>

        <Pressable style={proStyles.primary} onPress={() => void save()} disabled={busy} accessibilityRole="button">
          {busy ? <ActivityIndicator color={colors.cream50} /> : <Text style={proStyles.primaryText}>{existing ? "Save" : "Send for approval"}</Text>}
        </Pressable>
        <Text style={[proStyles.hint, { textAlign: "center" }]}>
          {kind === "pga" ? "PinPals checks your PGA membership" : "PinPals checks your qualification"} before you appear in Book a pro.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={proStyles.label}>{label}</Text>
      {children}
      {hint ? <Text style={proStyles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
