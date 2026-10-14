import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CourseSearch } from "@/components/course-search";
import { Section } from "@/components/form-bits";
import { TimeSheet } from "@/components/time-sheet";
import { placeLabel, type Club } from "@/lib/courses";
import { addDays, isTrip, OUTING_KINDS, tripLengthLabel, type OutingKind } from "@/lib/itinerary-rules";
import { compactIban, formatIban, ibanIsValid, normaliseRevtag } from "@/lib/outing-payments";
import { closesLabel, entriesCloseAt, irishToday, outingDateLabel, parseFee } from "@/lib/outing-rules";
import { lastPaymentDetails, loadClub, loadOuting, saveOuting, type EntryMode } from "@/lib/outings";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/** "YYYY-MM-DD" ↔ a Date at local noon (noon: no time zone can tip it into another day). */
const toDate = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
};
const fromDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** What opens when a trip is chosen — the sections of its itinerary. */
const TRIP_SECTIONS = (kind: OutingKind) => [
  { icon: "location-outline" as const, title: "Location", body: kind === "abroad" ? "Where you're based, e.g. Vale do Lobo, Portugal" : "Where you're based, e.g. Ballybunion, Co. Kerry" },
  { icon: "calendar-outline" as const, title: "Days & dates", body: "A day for each date, from the first day to the last" },
  { icon: "flag-outline" as const, title: "Rounds & tee times", body: "A course each day, groups and start times" },
  { icon: "bed-outline" as const, title: "Accommodation", body: "Hotel, nights, who's in which room" },
  kind === "abroad"
    ? { icon: "airplane-outline" as const, title: "Flights & transfers", body: "Out and back, who's on which flight, the airport bus" }
    : { icon: "bus-outline" as const, title: "Travel", body: "Car-share or coach, where and when to meet" },
  { icon: "document-text-outline" as const, title: "Notes", body: "Dinners, dress code, kitty, what to pack" },
];

/**
 * A new society outing, or (with ?edit=<outingId>) changing one.
 * Captain, secretary or owner only — the database refuses anyone else.
 *
 * First the kind (0126): a day out (0125: one course, one date, a first
 * tee), or an overnight or abroad trip. A trip has a first and last day and
 * a place instead of a course; its rounds, flights, rooms and notes go on
 * its itinerary, which opens straight after it's created.
 */
export default function NewOutingScreen() {
  const { id: rawId, edit } = useLocalSearchParams<{ id: string; edit?: string }>();
  const groupId = Number(rawId);
  const editId = edit ? Number(edit) : null;
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(editId != null);
  const [kind, setKind] = useState<OutingKind>("day");
  const [title, setTitle] = useState("");
  const [club, setClub] = useState<Club | null>(null);
  const [courseName, setCourseName] = useState<string | null>(null);
  const [playsOn, setPlaysOn] = useState(() => addDays(irishToday(), 14));
  const [endsOn, setEndsOn] = useState(() => addDays(irishToday(), 17));
  const [location, setLocation] = useState("");
  const [firstTee, setFirstTee] = useState("");
  const [feeText, setFeeText] = useState("");
  const [maxText, setMaxText] = useState("");
  const [details, setDetails] = useState("");
  // How members pay (0127)
  const [revtag, setRevtag] = useState("");
  const [iban, setIban] = useState("");
  const [accountName, setAccountName] = useState("");
  const [payCash, setPayCash] = useState(true);
  const [payNote, setPayNote] = useState("");
  // 0142: how members get a place, and the day's details.
  const [entryMode, setEntryMode] = useState<EntryMode>("join");
  const [waitingList, setWaitingList] = useState(true);
  const [autoOffer, setAutoOffer] = useState(true);
  const [guestsAllowed, setGuestsAllowed] = useState(true);
  const [guestFeeText, setGuestFeeText] = useState("");
  /** Entries close: 0 = midnight before the day (the default), else days before. */
  const [closeDays, setCloseDays] = useState(0);
  const [arriveBy, setArriveBy] = useState("");
  const [formatLabel, setFormatLabel] = useState("");
  const [dressCode, setDressCode] = useState("");
  const [mealsText, setMealsText] = useState("");
  const [dateOpen, setDateOpen] = useState<"start" | "end" | null>(null);
  const [draftDate, setDraftDate] = useState(() => toDate(playsOn));
  const [teeOpen, setTeeOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // A new outing starts with the society's last payment details.
  useEffect(() => {
    if (editId != null) return;
    void lastPaymentDetails(groupId)
      .then((p) => {
        if (!p) return;
        setRevtag(p.payRevtag ? `@${p.payRevtag}` : "");
        setIban(p.payIban ? formatIban(p.payIban) : "");
        setAccountName(p.payAccountName ?? "");
        setPayCash(p.payCash);
        setPayNote(p.payNote ?? "");
      })
      .catch(() => undefined);
  }, [editId, groupId]);

  useEffect(() => {
    if (editId == null) return;
    void (async () => {
      try {
        const page = await loadOuting(editId);
        if (!page) return;
        const o = page.outing;
        setKind(o.kind);
        setTitle(o.title);
        setPlaysOn(o.playsOn);
        if (o.endsOn) setEndsOn(o.endsOn);
        setLocation(o.location ?? "");
        setFirstTee(o.firstTee ? o.firstTee.slice(0, 5) : "");
        setFeeText(o.entryFeeCents != null ? (o.entryFeeCents / 100).toFixed(o.entryFeeCents % 100 ? 2 : 0) : "");
        setMaxText(o.maxEntries != null ? String(o.maxEntries) : "");
        setDetails(o.details ?? "");
        setRevtag(o.payRevtag ? `@${o.payRevtag}` : "");
        setIban(o.payIban ? formatIban(o.payIban) : "");
        setAccountName(o.payAccountName ?? "");
        setPayCash(o.payCash);
        setPayNote(o.payNote ?? "");
        setEntryMode(o.entryMode);
        setWaitingList(o.waitingList);
        setAutoOffer(o.autoOffer);
        setGuestsAllowed(o.guestsAllowed);
        setGuestFeeText(o.guestFeeCents != null ? (o.guestFeeCents / 100).toFixed(o.guestFeeCents % 100 ? 2 : 0) : "");
        setCloseDays(o.entriesCloseAt ? Math.max(1, Math.round((entriesCloseAt(o.playsOn).getTime() - new Date(o.entriesCloseAt).getTime()) / 86_400_000) + 1) : 0);
        setArriveBy(o.arriveBy ? o.arriveBy.slice(0, 5) : "");
        setFormatLabel(o.formatLabel ?? "");
        setDressCode(o.dressCode ?? "");
        setMealsText(o.mealOptions.join(", "));
        setCourseName(o.courseName);
        if (o.clubId) setClub(await loadClub(o.clubId));
      } finally {
        setLoading(false);
      }
    })();
  }, [editId]);

  const trip = isTrip(kind);
  const fee = parseFee(feeText);
  const max = maxText.trim() === "" ? null : /^\d{1,3}$/.test(maxText.trim()) ? Number(maxText.trim()) : undefined;
  const course = club?.name ?? courseName;
  const tag = normaliseRevtag(revtag);
  const ibanCompact = compactIban(iban);
  const guestFee = parseFee(guestFeeText);
  const arriveOk = arriveBy.trim() === "" || /^([01]?\d|2[0-3]):[0-5]\d$/.test(arriveBy.trim());
  const meals = [...new Set(mealsText.split(",").map((m) => m.trim()).filter(Boolean))];

  const problem =
    title.trim() === ""
      ? `Give the ${trip ? "trip" : "outing"} a name`
      : !trip && !course
        ? "Choose the course"
        : playsOn < irishToday()
          ? "Choose a date from today on"
          : trip && endsOn <= playsOn
            ? "The last day is after the first"
            : trip && endsOn > addDays(playsOn, 20)
              ? "A trip is three weeks at most"
              : fee === undefined
                ? "The cost should be an amount, like 60"
                : max === undefined || max === 0
                  ? "Places should be a number"
                  : tag === undefined
                    ? "The Revolut username is the @name in Revolut, no spaces"
                    : ibanCompact && !ibanIsValid(ibanCompact)
                      ? "That IBAN doesn't look right — check the numbers"
                      : ibanCompact && !accountName.trim()
                        ? "Add the name on the bank account"
                        : guestFee === undefined
                          ? "The guest fee should be an amount, like 80"
                          : !arriveOk
                            ? "Arrive by is a time, like 09:15"
                            : meals.length > 6 || meals.some((m) => m.length > 40)
                              ? "Up to six meals, 40 characters each"
                              : null;

  async function save() {
    if (problem) return;
    setSaving(true);
    try {
      const id = await saveOuting(groupId, editId, {
        kind,
        title: title.trim(),
        clubId: trip ? null : (club?.id ?? null),
        courseName: trip ? null : course,
        playsOn,
        endsOn: trip ? endsOn : null,
        location: trip ? location.trim() || null : null,
        firstTee: trip ? null : firstTee || null,
        details: details.trim() || null,
        entryFeeCents: fee ?? null,
        maxEntries: max ?? null,
        payRevtag: tag ?? null,
        payIban: ibanCompact,
        payAccountName: ibanCompact ? accountName.trim() : null,
        payCash,
        payNote: payNote.trim() || null,
        entryMode,
        waitingList,
        autoOffer,
        guestsAllowed,
        guestFeeCents: guestsAllowed ? (guestFee ?? null) : null,
        // N days before: midnight at the start of the day N−1 days before.
        entriesCloseAt: closeDays === 0 ? null : entriesCloseAt(addDays(playsOn, -(closeDays - 1))).toISOString(),
        arriveBy: trip ? null : arriveBy.trim() || null,
        formatLabel: trip ? null : formatLabel.trim() || null,
        dressCode: dressCode.trim() || null,
        mealOptions: trip ? [] : meals,
      });
      if (trip && editId == null) {
        // Straight into building the itinerary, with the outing page behind it.
        router.replace({ pathname: "/group/[id]/outing/[outingId]", params: { id: String(groupId), outingId: String(id), saved: "1" } });
        router.push({ pathname: "/group/[id]/itinerary/[outingId]", params: { id: String(groupId), outingId: String(id), saved: "1" } });
      } else {
        router.replace({ pathname: "/group/[id]/outing/[outingId]", params: { id: String(groupId), outingId: String(id), saved: "1" } });
      }
    } catch (err) {
      Alert.alert(`Couldn't save the ${trip ? "trip" : "outing"}`, err instanceof Error ? err.message : "Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function pickKind(k: OutingKind) {
    setKind(k);
    // Keep a sensible last day when switching to a trip.
    if (isTrip(k) && endsOn <= playsOn) setEndsOn(addDays(playsOn, 3));
  }

  function setDate(which: "start" | "end", value: string) {
    if (which === "start") {
      // Move the last day with the first, keeping the trip's length.
      const days = Math.max(1, Math.round((toDate(endsOn).getTime() - toDate(playsOn).getTime()) / 86_400_000));
      setPlaysOn(value);
      setEndsOn(addDays(value, days));
    } else setEndsOn(value);
  }

  const today = toDate(irishToday());
  const latest = new Date(today);
  latest.setDate(latest.getDate() + 730);
  const pickerMin = dateOpen === "end" ? toDate(addDays(playsOn, 1)) : today;
  const pickerMax = dateOpen === "end" ? toDate(addDays(playsOn, 20)) : latest;
  const noun = trip ? "trip" : "outing";

  if (loading) {
    return (
      <View style={styles.fill}>
        <Stack.Screen options={{ title: "Edit event", headerBackTitle: "Back" }} />
        <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: editId ? (trip ? "Edit trip" : "Edit outing") : "New event", headerBackTitle: "Back" }} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Section title="Name">
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder={trip ? "e.g. Algarve 2027" : "e.g. Captain's Day"}
            placeholderTextColor={colors.ink500}
            style={styles.input}
            maxLength={80}
            accessibilityLabel={`Name of the ${noun}`}
          />
        </Section>

        <Section title="What kind of outing?">
          <View style={styles.kinds} accessibilityRole="radiogroup">
            {OUTING_KINDS.map((k) => {
              const on = kind === k.kind;
              return (
                <Pressable key={k.kind} style={[styles.kind, on && styles.kindOn]} onPress={() => pickKind(k.kind)} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.kindTitle}>{k.label}</Text>
                    <Text style={styles.kindBlurb}>{k.blurb}</Text>
                  </View>
                  <Ionicons name={on ? "checkmark-circle" : "ellipse-outline"} size={24} color={on ? colors.navy900 : colors.line} />
                </Pressable>
              );
            })}
          </View>
        </Section>

        <View style={styles.pair}>
          <View style={{ flex: 1 }}>
            <Section title={trip ? "First day" : "Date"}>
              <Pressable
                style={styles.picker}
                onPress={() => {
                  setDraftDate(toDate(playsOn));
                  setDateOpen("start");
                }}
                accessibilityRole="button"
                accessibilityLabel={`${trip ? "First day" : "Date"}, ${outingDateLabel(playsOn)}. Change`}
              >
                <Ionicons name="calendar-outline" size={20} color={colors.navy900} />
                <Text style={styles.pickerText}>{outingDateLabel(playsOn)}</Text>
              </Pressable>
            </Section>
          </View>
          {trip ? (
            <View style={{ flex: 1 }}>
              <Section title="Last day">
                <Pressable
                  style={styles.picker}
                  onPress={() => {
                    setDraftDate(toDate(endsOn));
                    setDateOpen("end");
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Last day, ${outingDateLabel(endsOn)}. Change`}
                >
                  <Ionicons name="calendar-outline" size={20} color={colors.navy900} />
                  <Text style={styles.pickerText}>{outingDateLabel(endsOn)}</Text>
                </Pressable>
              </Section>
            </View>
          ) : null}
        </View>
        <Text style={styles.hint}>{closesLabel(playsOn)}</Text>

        {trip ? (
          <>
            <Section title="Location" hint="Optional. Where you're based.">
              <TextInput
                value={location}
                onChangeText={setLocation}
                placeholder={kind === "abroad" ? "e.g. Vale do Lobo, Portugal" : "e.g. Ballybunion, Co. Kerry"}
                placeholderTextColor={colors.ink500}
                style={styles.input}
                maxLength={120}
                accessibilityLabel="Location"
              />
            </Section>

            <View style={styles.unlocked} accessibilityLabel="The full itinerary">
              <Text style={styles.unlockedKicker}>FULL ITINERARY</Text>
              <Text style={styles.unlockedTitle}>{endsOn > playsOn ? `${tripLengthLabel(playsOn, endsOn)}${kind === "abroad" ? " abroad" : ""}` : "Your trip"}</Text>
              {TRIP_SECTIONS(kind).map((s) => (
                <View key={s.title} style={styles.unlockedRow}>
                  <Ionicons name={s.icon} size={18} color={colors.gold400} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.unlockedRowTitle}>{s.title}</Text>
                    <Text style={styles.unlockedRowBody}>{s.body}</Text>
                  </View>
                </View>
              ))}
              <Text style={styles.unlockedFoot}>{editId ? "Change these on the itinerary." : "You build these day by day as soon as the trip is created."}</Text>
            </View>
          </>
        ) : (
          <>
            <Section title="Course">
              {course ? (
                <View style={styles.picker}>
                  <Ionicons name="flag-outline" size={20} color={colors.navy900} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pickerText}>{course}</Text>
                    {club ? <Text style={styles.meta}>{placeLabel(club)}</Text> : null}
                  </View>
                  <Pressable
                    onPress={() => {
                      setClub(null);
                      setCourseName(null);
                    }}
                    hitSlop={8}
                    accessibilityRole="button"
                  >
                    <Text style={styles.change}>Change</Text>
                  </Pressable>
                </View>
              ) : (
                <CourseSearch placeholder="Search for the course" onPick={setClub} />
              )}
            </Section>

            <Section title="First tee" hint="Optional. The draw spaces the groups from here.">
              <Pressable style={styles.picker} onPress={() => setTeeOpen(true)} accessibilityRole="button" accessibilityLabel={`First tee, ${firstTee || "not set"}. Change`}>
                <Ionicons name="time-outline" size={20} color={colors.navy900} />
                <Text style={styles.pickerText}>{firstTee || "Not set"}</Text>
                <Text style={styles.change}>{firstTee ? "Change" : "Set"}</Text>
              </Pressable>
            </Section>
          </>
        )}

        <View style={styles.pair}>
          <View style={{ flex: 1 }}>
            <Section title={trip ? "Cost per person" : "Entry fee"} hint="Optional, in euro.">
              <TextInput
                value={feeText}
                onChangeText={setFeeText}
                placeholder={trip ? "e.g. 650" : "e.g. 60"}
                placeholderTextColor={colors.ink500}
                keyboardType="decimal-pad"
                style={[styles.input, fee === undefined && styles.inputBad]}
                accessibilityLabel={trip ? "Cost per person in euro" : "Entry fee in euro"}
              />
            </Section>
          </View>
          <View style={{ flex: 1 }}>
            <Section title="Places" hint="Optional limit.">
              <TextInput
                value={maxText}
                onChangeText={setMaxText}
                placeholder={trip ? "e.g. 12" : "e.g. 40"}
                placeholderTextColor={colors.ink500}
                keyboardType="number-pad"
                style={[styles.input, max === undefined && styles.inputBad]}
                accessibilityLabel="Number of places"
              />
            </Section>
          </View>
        </View>

        <View style={styles.pay}>
          <Text style={styles.payTitle}>How members get a place</Text>
          {(
            [
              { mode: "join", label: "Join straight away", hint: "First come, first served." },
              { mode: "request", label: "Request a place", hint: "Members ask; you approve each one, or put them on the waiting list." },
            ] as const
          ).map((o) => (
            <Pressable key={o.mode} style={[styles.choice, entryMode === o.mode && styles.choiceOn]} onPress={() => setEntryMode(o.mode)} accessibilityRole="radio" accessibilityState={{ selected: entryMode === o.mode }}>
              <Ionicons name={entryMode === o.mode ? "radio-button-on" : "radio-button-off"} size={20} color={colors.navy900} />
              <View style={{ flex: 1 }}>
                <Text style={styles.cashTitle}>{o.label}</Text>
                <Text style={styles.payHint}>{o.hint}</Text>
              </View>
            </Pressable>
          ))}
          <View style={styles.cashRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cashTitle}>Waiting list when it&apos;s full</Text>
              <Text style={styles.payHint}>Needs a limit on places.</Text>
            </View>
            <Switch value={waitingList} onValueChange={setWaitingList} trackColor={{ true: colors.green600, false: colors.line }} accessibilityLabel="Waiting list when it's full" />
          </View>
          {waitingList ? (
            <View style={styles.cashRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cashTitle}>Offer freed places automatically</Text>
                <Text style={styles.payHint}>The next in line gets 24 hours to take it.</Text>
              </View>
              <Switch value={autoOffer} onValueChange={setAutoOffer} trackColor={{ true: colors.green600, false: colors.line }} accessibilityLabel="Offer freed places automatically" />
            </View>
          ) : null}
          <View style={styles.cashRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cashTitle}>Members can bring guests</Text>
            </View>
            <Switch value={guestsAllowed} onValueChange={setGuestsAllowed} trackColor={{ true: colors.green600, false: colors.line }} accessibilityLabel="Members can bring guests" />
          </View>
          {guestsAllowed ? (
            <Section title="Guest fee" hint="Optional. Blank: the same as the entry fee.">
              <TextInput value={guestFeeText} onChangeText={setGuestFeeText} placeholder="e.g. 80" placeholderTextColor={colors.ink500} keyboardType="decimal-pad" style={[styles.input, guestFee === undefined && styles.inputBad]} accessibilityLabel="Guest fee in euro" />
            </Section>
          ) : null}
          <Section title="Entries close" hint="Members can join, ask or cancel until then; you can change the list any time.">
            <View style={styles.chips}>
              {[0, 2, 3, 5, 7].map((d) => (
                <Pressable key={d} style={[styles.chipPick, closeDays === d && styles.chipPickOn]} onPress={() => setCloseDays(d)} accessibilityRole="radio" accessibilityState={{ selected: closeDays === d }}>
                  <Text style={[styles.chipPickText, closeDays === d && styles.chipPickTextOn]}>{d === 0 ? "Midnight before" : d === 7 ? "A week before" : `${d} days before`}</Text>
                </Pressable>
              ))}
            </View>
          </Section>
        </View>

        {!trip ? (
          <View style={styles.pay}>
            <Text style={styles.payTitle}>On the day</Text>
            <View style={styles.pair}>
              <View style={{ flex: 1 }}>
                <Section title="Arrive by" hint="Optional.">
                  <TextInput value={arriveBy} onChangeText={setArriveBy} placeholder="09:15" placeholderTextColor={colors.ink500} keyboardType="numbers-and-punctuation" maxLength={5} style={[styles.input, !arriveOk && styles.inputBad]} accessibilityLabel="Arrive by, a time like 09:15" />
                </Section>
              </View>
              <View style={{ flex: 1 }}>
                <Section title="Format" hint="Optional.">
                  <TextInput value={formatLabel} onChangeText={setFormatLabel} placeholder="Stableford" placeholderTextColor={colors.ink500} maxLength={60} style={styles.input} accessibilityLabel="Format" />
                </Section>
              </View>
            </View>
            <Section title="Dress code" hint="Optional.">
              <TextInput value={dressCode} onChangeText={setDressCode} placeholder="Collared shirts, no denim, soft spikes" placeholderTextColor={colors.ink500} maxLength={200} style={styles.input} accessibilityLabel="Dress code" />
            </Section>
            <Section title="Meal choices" hint="Optional, separated by commas — members pick one when they get a place.">
              <TextInput value={mealsText} onChangeText={setMealsText} placeholder="Beef, Salmon, Vegetarian" placeholderTextColor={colors.ink500} maxLength={260} style={styles.input} accessibilityLabel="Meal choices, separated by commas" />
            </Section>
          </View>
        ) : null}

        <View style={styles.pay}>
          <Text style={styles.payTitle}>How members pay</Text>
          <Text style={styles.payHint}>Members see these on the {noun}&apos;s page with a Pay button. Only people in the group can see them.</Text>
          <Section title="Revolut username" hint="Optional. Your @name in Revolut — members tap to open Revolut and pay you.">
            <TextInput
              value={revtag}
              onChangeText={setRevtag}
              placeholder="@yourname"
              placeholderTextColor={colors.ink500}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, tag === undefined && styles.inputBad]}
              maxLength={41}
              accessibilityLabel="Revolut username"
            />
          </Section>
          <Section title="Bank transfer" hint="Optional. IBAN and the name on the account.">
            <TextInput
              value={iban}
              onChangeText={setIban}
              placeholder="IE29 AIBK 9311 5212 3456 78"
              placeholderTextColor={colors.ink500}
              autoCapitalize="characters"
              autoCorrect={false}
              style={[styles.input, ibanCompact != null && !ibanIsValid(ibanCompact) && styles.inputBad]}
              maxLength={42}
              accessibilityLabel="IBAN"
            />
            <TextInput
              value={accountName}
              onChangeText={setAccountName}
              placeholder="Name on the account"
              placeholderTextColor={colors.ink500}
              style={styles.input}
              maxLength={70}
              accessibilityLabel="Name on the bank account"
            />
          </Section>
          <View style={styles.cashRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cashTitle}>Cash is fine</Text>
              <Text style={styles.payHint}>Members can pay you in person.</Text>
            </View>
            <Switch value={payCash} onValueChange={setPayCash} trackColor={{ true: colors.green600, false: colors.line }} accessibilityLabel="Cash is fine" />
          </View>
          <Section title="Payment note" hint="Optional, e.g. a deadline.">
            <TextInput value={payNote} onChangeText={setPayNote} placeholder="By 1 May, please" placeholderTextColor={colors.ink500} style={styles.input} maxLength={200} accessibilityLabel="Payment note" />
          </Section>
        </View>

        <Section title={trip ? "Trip notes" : "Details"} hint={trip ? "For every day: kitty, dress code, what to pack." : "What the fee covers, dress code, dinner, prizes — anything members should know."}>
          <TextInput
            value={details}
            onChangeText={setDetails}
            placeholder={trip ? "Kitty €100 each to the organiser by 1 May. Collared shirts. Bring your passport." : "Green fee, soup and sandwich, prizes for the top three"}
            placeholderTextColor={colors.ink500}
            style={[styles.input, styles.multi]}
            multiline
            maxLength={1000}
            accessibilityLabel={trip ? "Trip notes" : "Details"}
          />
        </Section>

        {problem ? <Text style={styles.problem}>{problem}</Text> : null}
        <Pressable style={[styles.cta, (problem || saving) && styles.ctaOff]} onPress={() => void save()} disabled={!!problem || saving} accessibilityRole="button">
          {saving ? <ActivityIndicator color={colors.cream50} /> : <Text style={styles.ctaText}>{editId ? "Save changes" : trip ? "Build the itinerary" : "Create the outing"}</Text>}
        </Pressable>
        {!editId ? (
          <Text style={styles.foot}>{trip ? "Members see it under Events and can join it straight away; the itinerary fills in as you add to it." : "It appears under Events for everyone in the group, and they can join it straight away."}</Text>
        ) : null}
      </ScrollView>

      <TimeSheet open={teeOpen} title="First tee" value={firstTee} onClose={() => setTeeOpen(false)} onChange={setFirstTee} />

      {Platform.OS === "ios" ? (
        <Modal visible={dateOpen != null} transparent animationType="slide" onRequestClose={() => setDateOpen(null)}>
          <Pressable style={styles.backdrop} onPress={() => setDateOpen(null)} accessibilityRole="button" accessibilityLabel="Close" />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
            <Text style={styles.sheetTitle}>{dateOpen === "end" ? "Last day of the trip" : trip ? "First day of the trip" : "Date of the outing"}</Text>
            <DateTimePicker value={draftDate} mode="date" display="spinner" minimumDate={pickerMin} maximumDate={pickerMax} onChange={(_e, d) => d && setDraftDate(d)} style={styles.wheel} />
            <Pressable
              style={styles.cta}
              onPress={() => {
                if (dateOpen) setDate(dateOpen, fromDate(draftDate));
                setDateOpen(null);
              }}
              accessibilityRole="button"
            >
              <Text style={styles.ctaText}>Done</Text>
            </Pressable>
          </View>
        </Modal>
      ) : dateOpen ? (
        <DateTimePicker
          value={toDate(dateOpen === "end" ? endsOn : playsOn)}
          mode="date"
          minimumDate={pickerMin}
          maximumDate={pickerMax}
          onChange={(e: DateTimePickerEvent, d?: Date) => {
            const which = dateOpen;
            setDateOpen(null);
            if (e.type === "set" && d) setDate(which, fromDate(d));
          }}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  choice: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, minHeight: 50, borderRadius: radii.md, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.surface },
  choiceOn: { borderColor: colors.navy900, backgroundColor: colors.cream100 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chipPick: { minHeight: 40, paddingHorizontal: 12, justifyContent: "center", borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.surface },
  chipPickOn: { borderColor: colors.navy900, backgroundColor: colors.navy900 },
  chipPickText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.navy900 },
  chipPickTextOn: { color: colors.cream50 },
  fill: { flex: 1, backgroundColor: colors.cream50 },
  body: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, backgroundColor: colors.surface, paddingHorizontal: spacing.md, fontFamily: fonts.body, fontSize: type.body, color: colors.ink900 },
  inputBad: { borderColor: colors.red600 },
  multi: { minHeight: 96, paddingTop: 12, textAlignVertical: "top" },
  kinds: { gap: spacing.sm },
  kind: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 64, padding: 12, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceTint },
  kindOn: { borderWidth: 2, borderColor: colors.navy900, backgroundColor: colors.surface },
  kindTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  kindBlurb: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  picker: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 52, paddingHorizontal: spacing.md, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  pickerText: { flex: 1, fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  meta: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500 },
  hint: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500, marginTop: -spacing.sm },
  change: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },
  pair: { flexDirection: "row", gap: spacing.sm },
  unlocked: { gap: 12, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.navy900 },
  unlockedKicker: { fontFamily: fonts.bodyBold, fontSize: 11.5, letterSpacing: 1.4, color: colors.gold400 },
  unlockedTitle: { fontFamily: fonts.display, fontSize: 22, color: colors.cream50, marginTop: -6 },
  unlockedRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  unlockedRowTitle: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.cream50 },
  unlockedRowBody: { fontFamily: fonts.body, fontSize: 13, color: colors.cream100 },
  unlockedFoot: { fontFamily: fonts.body, fontSize: 12.5, color: colors.cream100 },
  pay: { gap: spacing.sm + 2, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceTint },
  payTitle: { fontFamily: fonts.bodyBold, fontSize: type.heading, color: colors.ink900 },
  payHint: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  cashRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  cashTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  problem: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.red600, textAlign: "center" },
  cta: { minHeight: 52, borderRadius: radii.pill, backgroundColor: colors.green700, alignItems: "center", justifyContent: "center" },
  ctaOff: { opacity: 0.5 },
  ctaText: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
  foot: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500, textAlign: "center" },
  backdrop: { flex: 1, backgroundColor: "rgba(12,32,56,0.35)" },
  sheet: { backgroundColor: colors.cream50, padding: spacing.md, gap: spacing.sm, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg },
  sheetTitle: { fontFamily: fonts.bodyBold, fontSize: type.heading, color: colors.ink900, textAlign: "center" },
  wheel: { alignSelf: "stretch" },
});
