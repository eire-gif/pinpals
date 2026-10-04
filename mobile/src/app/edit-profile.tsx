import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as ImagePicker from "expo-image-picker";

import { Chip, ChipGroup, Section } from "@/components/form-bits";
import { useAuth } from "@/lib/auth";
import { ApiError, type UploadFile } from "@/lib/api";
import {
  loadMyProfile,
  looksLikeADate,
  saveMyProfile,
  type ProfileEdits,
} from "@/lib/profile";
import { COUNTRY_NAMES, regionsFor, searchClubs, type ClubHit } from "@/lib/tee-time-post";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";
import { KeyboardDoneButton } from "@/components/keyboard";
import { PHOTO_PICKER_OPTIONS, preparePhotoForUpload } from "@/lib/photo-picking";

/**
 * Editing your own profile, natively.
 *
 * The form the website has, minus its two-column layout and plus a camera.
 * Everything it collects is what other members see — which is why the two
 * visibility switches sit next to the fields they govern rather than in a
 * privacy section three screens away.
 *
 * NOTHING HERE VALIDATES THE INTERESTING PART. Whether a club exists, whether
 * a county belongs to the chosen country, whether a handicap is a real index,
 * whether a date of birth resolves to an age band — all of that is decided by
 * the server, which hands the body to the same function the website's own
 * form goes through. This screen checks only what it can check honestly
 * (a name is not blank, a date looks like a date) and shows whatever comes
 * back. An app that made its own rulings would drift from the site, and the
 * drift would look like a bug in whichever one the member tried second.
 *
 * The photo never goes to Storage from here. See lib/profile.ts.
 */
export default function EditProfileScreen() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<ProfileEdits>(BLANK);
  const [clubName, setClubName] = useState("");
  const [clubQuery, setClubQuery] = useState("");
  const [clubHits, setClubHits] = useState<ClubHit[]>([]);
  const [counties, setCounties] = useState<string[]>([]);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    let live = true;
    void loadMyProfile(userId)
      .then((profile) => {
        if (!live || !profile) return;
        setForm({
          firstName: profile.firstName,
          lastName: profile.lastName,
          homeClubId: profile.homeClubId,
          country: profile.country,
          county: profile.county ?? "",
          handicap: profile.handicap === null ? "" : String(profile.handicap),
          handicapVisible: profile.handicapVisible,
          bio: profile.bio ?? "",
          guiNumber: profile.guiNumber ?? "",
          dateOfBirth: profile.dateOfBirth ?? "",
          ageRangeVisible: profile.ageRangeVisible,
          photo: null,
          removePhoto: false,
        });
        setClubName(profile.homeClub ?? "");
        setAvatarUrl(profile.avatarUrl);
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [userId]);

  // Counties are fetched rather than bundled — `clubs.region` is null for
  // most clubs outside England, so this list cannot be derived locally.
  useEffect(() => {
    let live = true;
    void regionsFor(form.country).then((list) => live && setCounties(list));
    return () => {
      live = false;
    };
  }, [form.country]);

  // Searched on a delay, not a keystroke: a club name is five or six
  // characters before it means anything, and a query per letter is a query
  // per letter on somebody's mobile data.
  useEffect(() => {
    const term = clubQuery.trim();
    if (term.length < 2) {
      setClubHits([]);
      return;
    }
    const timer = setTimeout(() => {
      void searchClubs(term)
        .then(setClubHits)
        .catch(() => setClubHits([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [clubQuery]);

  const set = (patch: Partial<ProfileEdits>) => setForm((prev) => ({ ...prev, ...patch }));

  const chooseClub = (club: ClubHit) => {
    // The club's own row carries the country, so picking one settles that
    // question rather than asking it separately — and a county belonging to
    // the old country would now be wrong, so it goes.
    set({
      homeClubId: club.id,
      country: club.country,
      county: club.country === form.country ? form.county : "",
    });
    setClubName(club.name);
    setClubQuery("");
    setClubHits([]);
  };

  const pickPhoto = useCallback(async (source: "camera" | "library") => {
    const permission =
      source === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert(
        source === "camera" ? "Camera is off" : "Photos are off",
        "PinPals needs this to set your profile photo. You can turn it on in Settings.",
        [
          { text: "Not now", style: "cancel" },
          { text: "Open Settings", onPress: () => void Linking.openSettings() },
        ]
      );
      return;
    }

    const result =
      source === "camera"
        ? await ImagePicker.launchCameraAsync(PHOTO_PICKER_OPTIONS)
        : await ImagePicker.launchImageLibraryAsync(PHOTO_PICKER_OPTIONS);

    if (result.canceled || result.assets.length === 0) return;

    const asset = result.assets[0];
    // The avatar bucket takes 2 MB: resized on the phone first where the
    // build can (photo-picking.ts).
    const file: UploadFile = await preparePhotoForUpload({
      uri: asset.uri,
      name: asset.fileName ?? "avatar.jpg",
      type: asset.mimeType ?? "image/jpeg",
      width: asset.width,
      height: asset.height,
    });
    setForm((prev) => ({ ...prev, photo: file, removePhoto: false }));
    setAvatarUrl(asset.uri);
  }, []);

  const photoMenu = () =>
    Alert.alert("Profile photo", undefined, [
      { text: "Take a photo", onPress: () => void pickPhoto("camera") },
      { text: "Choose from library", onPress: () => void pickPhoto("library") },
      ...(avatarUrl
        ? [
            {
              text: "Remove photo",
              style: "destructive" as const,
              onPress: () => {
                setAvatarUrl(null);
                setForm((prev) => ({ ...prev, photo: null, removePhoto: true }));
              },
            },
          ]
        : []),
      { text: "Cancel", style: "cancel" as const },
    ]);

  async function save() {
    setError(null);

    if (!form.firstName.trim() || !form.lastName.trim()) {
      setError("First and last name can't be empty.");
      return;
    }
    if (form.dateOfBirth && !looksLikeADate(form.dateOfBirth)) {
      setError("Write your date of birth as YYYY-MM-DD.");
      return;
    }

    setSaving(true);
    try {
      await saveMyProfile(form);
      router.back();
    } catch (err) {
      // The server's wording, when it gave one — it is written to be read,
      // and it is the same sentence the website would show.
      setError(
        err instanceof ApiError
          ? err.message
          : "Couldn't save that just now. Check your signal and try again."
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={[styles.fill, styles.centre]}>
        <Stack.Screen options={{ title: "Edit profile", headerBackTitle: "Back" }} />
        <ActivityIndicator color={colors.green700} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Stack.Screen
        options={{
          title: "Edit profile",
          headerBackTitle: "Back",
          headerRight: () => (
            <Pressable
              onPress={() => void save()}
              disabled={saving}
              hitSlop={12}
              style={{ paddingHorizontal: spacing.md, opacity: saving ? 0.4 : 1 }}
              accessibilityRole="button"
            >
              <Text style={styles.saveLabel}>{saving ? "Saving…" : "Save"}</Text>
            </Pressable>
          ),
        }}
      />

      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {error ? (
          <View style={styles.error}>
            <Ionicons name="alert-circle" size={17} color={colors.red600} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.photoRow}>
          <Pressable onPress={photoMenu} accessibilityRole="button" accessibilityLabel="Change photo">
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarNone]}>
                <Ionicons name="person" size={30} color={colors.ink500} />
              </View>
            )}
          </Pressable>
          <View style={styles.photoText}>
            <Pressable onPress={photoMenu} accessibilityRole="button">
              <Text style={styles.photoAction}>
                {avatarUrl ? "Change photo" : "Add a photo"}
              </Text>
            </Pressable>
            <Text style={styles.hint}>
              Your photo is resized and its location data removed before it&apos;s stored.
            </Text>
          </View>
        </View>

        <Section title="Your name">
          <Field
            label="First name"
            value={form.firstName}
            onChangeText={(v) => set({ firstName: v })}
            autoCapitalize="words"
          />
          <Field
            label="Last name"
            value={form.lastName}
            onChangeText={(v) => set({ lastName: v })}
            autoCapitalize="words"
          />
        </Section>

        <Section title="Home club" hint="Start typing and pick from the list.">
          {form.homeClubId !== null ? (
            <View style={styles.chosen}>
              <Ionicons name="golf-outline" size={17} color={colors.green700} />
              <Text style={styles.chosenLabel} numberOfLines={1}>
                {clubName}
              </Text>
              <Pressable
                onPress={() => {
                  set({ homeClubId: null });
                  setClubName("");
                }}
                hitSlop={10}
                accessibilityLabel="Clear home club"
              >
                <Ionicons name="close-circle" size={19} color={colors.ink500} />
              </Pressable>
            </View>
          ) : (
            <>
              <Field
                label="Search clubs"
                value={clubQuery}
                onChangeText={setClubQuery}
                autoCapitalize="words"
                placeholder="Portmarnock, Lahinch…"
              />
              {clubHits.map((club) => (
                <Pressable
                  key={club.id}
                  style={styles.hit}
                  onPress={() => chooseClub(club)}
                  accessibilityRole="button"
                >
                  <Text style={styles.hitName}>{club.name}</Text>
                  <Text style={styles.hitMeta}>
                    {[club.town, COUNTRY_NAMES[club.country] ?? club.country]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                </Pressable>
              ))}
            </>
          )}
        </Section>

        <Section title="Where you play">
          <ChipGroup>
            {Object.entries(COUNTRY_NAMES).map(([code, label]) => (
              <Chip
                key={code}
                label={label}
                selected={form.country === code}
                onPress={() => set({ country: code, county: "" })}
              />
            ))}
          </ChipGroup>

          {counties.length > 0 ? (
            <ChipGroup>
              {counties.map((name) => (
                <Chip
                  key={name}
                  label={name}
                  selected={form.county === name}
                  onPress={() => set({ county: form.county === name ? "" : name })}
                />
              ))}
            </ChipGroup>
          ) : null}
        </Section>

        <Section title="Handicap">
          <Field
            label="Handicap index"
            value={form.handicap}
            onChangeText={(v) => set({ handicap: v })}
            keyboardType="numbers-and-punctuation"
            placeholder="e.g. 14.2"
          />
          <Toggle
            label="Show my handicap to other members"
            value={form.handicapVisible}
            onValueChange={(v) => set({ handicapVisible: v })}
          />
        </Section>

        <Section title="About you" hint="A line or two. Other members see this.">
          <TextInput
            style={[styles.input, styles.multiline]}
            value={form.bio}
            onChangeText={(v) => set({ bio: v })}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            placeholder="Play most Saturdays, always up for a fourball."
            placeholderTextColor={colors.ink500}
          />
        </Section>

        <Section
          title="Date of birth"
          hint="Kept private. Only an age range is ever shown, and only if you allow it."
        >
          <Field
            label="YYYY-MM-DD"
            value={form.dateOfBirth}
            onChangeText={(v) => set({ dateOfBirth: v })}
            keyboardType="numbers-and-punctuation"
            placeholder="1979-06-14"
          />
          <Toggle
            label="Show my age range on my profile"
            value={form.ageRangeVisible}
            onValueChange={(v) => set({ ageRangeVisible: v })}
          />
          {form.dateOfBirth ? (
            <Text style={styles.hint}>
              Clearing this field removes your date of birth altogether, rather than just hiding it.
            </Text>
          ) : null}
        </Section>

        <Section title="GUI membership number" hint="Optional. Never shown to other members.">
          <Field
            label="Number"
            value={form.guiNumber}
            onChangeText={(v) => set({ guiNumber: v })}
            autoCapitalize="characters"
          />
        </Section>

        <Pressable
          style={[styles.submit, saving && styles.submitOff]}
          onPress={() => void save()}
          disabled={saving}
          accessibilityRole="button"
        >
          <Text style={styles.submitLabel}>{saving ? "Saving…" : "Save changes"}</Text>
        </Pressable>
      </ScrollView>
      {/* Closes the keyboard from the multi-line fields (Return adds a line). */}
      <KeyboardDoneButton />
    </KeyboardAvoidingView>
  );
}

const BLANK: ProfileEdits = {
  firstName: "",
  lastName: "",
  homeClubId: null,
  country: "ireland",
  county: "",
  handicap: "",
  handicapVisible: false,
  bio: "",
  guiNumber: "",
  dateOfBirth: "",
  ageRangeVisible: false,
  photo: null,
  removePhoto: false,
};

function Field({
  label,
  ...input
}: { label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        placeholderTextColor={colors.ink500}
        autoCorrect={false}
        {...input}
      />
    </View>
  );
}

function Toggle({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.toggle}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ true: colors.green600, false: colors.line }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  centre: { alignItems: "center", justifyContent: "center" },

  body: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xl },

  saveLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.green700 },

  error: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    padding: 12,
    borderRadius: radii.md,
    backgroundColor: colors.red100,
  },
  errorText: { flex: 1, fontFamily: fonts.body, fontSize: type.small, color: colors.red600 },

  photoRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  avatar: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.surfaceTint },
  avatarNone: { alignItems: "center", justifyContent: "center" },
  photoText: { flex: 1, gap: 3 },
  photoAction: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.green700 },
  hint: { fontFamily: fonts.body, fontSize: type.label, lineHeight: 18, color: colors.ink500 },

  field: { gap: 5 },
  fieldLabel: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink500 },
  input: {
    height: 48,
    paddingHorizontal: 14,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    fontFamily: fonts.body,
    fontSize: type.body,
    color: colors.ink900,
  },
  multiline: { height: 110, paddingTop: 12 },

  chosen: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: 14,
    height: 48,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.green700,
    backgroundColor: colors.green100,
  },
  chosenLabel: { flex: 1, fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },

  hit: {
    gap: 1,
    padding: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  hitName: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  hitMeta: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },

  toggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingVertical: 4,
  },
  toggleLabel: { flex: 1, fontFamily: fonts.body, fontSize: type.small, color: colors.ink900 },

  submit: {
    alignItems: "center",
    paddingVertical: 15,
    borderRadius: radii.pill,
    backgroundColor: colors.green700,
  },
  submitOff: { opacity: 0.5 },
  submitLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
});
