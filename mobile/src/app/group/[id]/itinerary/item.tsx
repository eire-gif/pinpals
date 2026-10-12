import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { CourseSearch } from "@/components/course-search";
import { Chip, ChipGroup, Section } from "@/components/form-bits";
import { StateMessage } from "@/components/state-message";
import { TimeSheet } from "@/components/time-sheet";
import { useAuth } from "@/lib/auth";
import { placeLabel, type Club } from "@/lib/courses";
import { shuffle } from "@/lib/group-draw";
import { loadGroupPage } from "@/lib/groups-data";
import { deleteItineraryItem, loadItineraryItem, saveItineraryItem, setItemPeople, type ItineraryItem } from "@/lib/itinerary";
import {
  bySlot,
  checkOutDate,
  dayHeading,
  dayTab,
  dealIntoSlots,
  FORMAT_LABELS,
  ITEM_INFO,
  routeLabel,
  teeTimeFor,
  tripDays,
  type ItemKind,
  type PlayFormat,
} from "@/lib/itinerary-rules";
import { clock, outingDateLabel } from "@/lib/outing-rules";
import { loadClub, loadOuting, type OutingEntry, type OutingPage } from "@/lib/outings";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

const GAPS = [8, 9, 10, 12];
const FORMATS = Object.keys(FORMAT_LABELS) as PlayFormat[];
/** Who goes on what: a group or room each (round, stay), on or off (flight, transfer), nobody (meal, note). */
const placement = (kind: ItemKind): "slots" | "list" | "none" => (kind === "round" || kind === "stay" ? "slots" : kind === "flight" || kind === "transfer" ? "list" : "none");

/**
 * Adding or changing one thing on a trip's itinerary (0126):
 *   ?kind=round&day=2027-05-14   add
 *   ?itemId=12                   change (officers) or look (members)
 *
 * Officers set the details and who's on it: a group each on a round (dealt
 * at random or picked), a room each in a stay, ticked on a flight or a bus.
 * Only people on the trip are listed — the database allows nobody else.
 */
export default function ItineraryItemScreen() {
  const params = useLocalSearchParams<{ id: string; outingId: string; itemId?: string; kind?: ItemKind; day?: string }>();
  const groupId = Number(params.id);
  const outingId = Number(params.outingId);
  const itemId = params.itemId ? Number(params.itemId) : null;
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [page, setPage] = useState<OutingPage | null>(null);
  const [item, setItem] = useState<ItineraryItem | null>(null);
  const [officer, setOfficer] = useState(false);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  // The form
  const [kind, setKind] = useState<ItemKind>(params.kind ?? "note");
  const [onDate, setOnDate] = useState(params.day ?? "");
  const [title, setTitle] = useState("");
  const [club, setClub] = useState<Club | null>(null);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [fromPlace, setFromPlace] = useState("");
  const [toPlace, setToPlace] = useState("");
  const [carrier, setCarrier] = useState("");
  const [nights, setNights] = useState(1);
  const [gap, setGap] = useState(10);
  const [format, setFormat] = useState<PlayFormat | null>("stableford");
  const [details, setDetails] = useState("");
  const [timeOpen, setTimeOpen] = useState<"start" | "end" | null>(null);
  // Who's on it: member → slot (0 = on it, no slot; absent = not on it).
  const [seats, setSeats] = useState<Map<string, number>>(new Map());
  const [slotCount, setSlotCount] = useState(1);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const [o, g, it] = await Promise.all([loadOuting(outingId), loadGroupPage(groupId, userId), itemId ? loadItineraryItem(itemId) : Promise.resolve(null)]);
      setPage(o);
      setOfficer(g?.myRole === "owner" || g?.myRole === "admin");
      if (!o || (itemId && !it)) {
        setMissing(true);
        return;
      }
      if (it) {
        setItem(it);
        setKind(it.kind);
        setOnDate(it.onDate);
        setTitle(it.title);
        setStartsAt(clock(it.startsAt) ?? "");
        setEndsAt(clock(it.endsAt) ?? "");
        setFromPlace(it.fromPlace ?? "");
        setToPlace(it.toPlace ?? "");
        setCarrier(it.carrier ?? "");
        setNights(it.nights ?? 1);
        setGap(it.teeInterval ?? 10);
        setFormat(it.playFormat);
        setDetails(it.details ?? "");
        setSeats(new Map(it.people.map((p) => [p.memberId, p.slot ?? 0])));
        setSlotCount(Math.max(1, ...it.people.map((p) => p.slot ?? 1)));
        if (it.clubId) setClub(await loadClub(it.clubId));
      } else {
        if (!params.day) setOnDate(o.outing.playsOn);
        // A sensible start: everyone on the flight or bus; groups of four, rooms of two.
        const entrants = o.entries.map((e) => e.memberId);
        if (placement(params.kind ?? "note") === "list") setSeats(new Map(entrants.map((m) => [m, 0])));
        if (params.kind === "round") setSlotCount(Math.max(1, Math.ceil(entrants.length / 4)));
        if (params.kind === "stay") {
          setSlotCount(Math.max(1, Math.ceil(entrants.length / 2)));
          setNights(Math.max(1, tripDays(params.day ?? o.outing.playsOn, o.outing.endsOn ?? o.outing.playsOn).length - 1));
        }
      }
    } finally {
      setLoading(false);
    }
  }, [groupId, outingId, itemId, userId, params.day, params.kind]);

  useEffect(() => {
    void load();
  }, [load]);

  const outing = page?.outing ?? null;
  const entrants: OutingEntry[] = useMemo(() => page?.entries ?? [], [page]);
  const days = outing?.endsOn ? tripDays(outing.playsOn, outing.endsOn) : [];
  const info = ITEM_INFO[kind];
  const place = placement(kind);
  const slotWord = kind === "round" ? "Group" : "Room";
  const roundTitle = club?.name ?? title;

  if (loading) {
    return (
      <View style={styles.fill}>
        <Stack.Screen options={{ title: info.label, headerBackTitle: "Back" }} />
        <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />
      </View>
    );
  }
  if (missing || !outing) {
    return (
      <View style={styles.fill}>
        <Stack.Screen options={{ title: "Itinerary", headerBackTitle: "Back" }} />
        <StateMessage icon="map-outline" title="That's no longer on the itinerary" size="screen" />
      </View>
    );
  }

  // Members look; they don't edit.
  if (!officer) {
    return item ? (
      <ItemView item={item} playsOn={outing.playsOn} userId={userId} />
    ) : (
      <View style={styles.fill}>
        <Stack.Screen options={{ title: "Itinerary", headerBackTitle: "Back" }} />
        <StateMessage icon="lock-closed-outline" title="Only the captain or secretary adds to the itinerary" size="screen" />
      </View>
    );
  }

  const finalTitle = kind === "round" ? roundTitle.trim() : title.trim();
  const problem =
    finalTitle === ""
      ? kind === "round"
        ? "Choose the course"
        : kind === "stay"
          ? "Name the hotel or house"
          : kind === "flight"
            ? "Name the flight, e.g. Outbound"
            : "Give it a name"
      : kind === "flight" && (!fromPlace.trim() || !toPlace.trim())
        ? "Say where the flight is from and to"
        : kind === "stay" && outing.endsOn && checkOutDate(onDate, nights) > checkOutDate(outing.endsOn, 1)
          ? "That stay runs past the end of the trip"
          : null;

  function seat(memberId: string, slot: number | null) {
    setSeats((prev) => {
      const next = new Map(prev);
      if (slot == null) next.delete(memberId);
      else next.set(memberId, slot);
      return next;
    });
  }

  function dealAtRandom() {
    const size = kind === "round" ? 4 : 2;
    const dealt = dealIntoSlots(shuffle(entrants.map((e) => e.memberId)), size);
    setSeats(dealt);
    setSlotCount(Math.max(1, ...dealt.values()));
  }

  async function save() {
    if (problem || !outing) return;
    setSaving(true);
    try {
      const id = await saveItineraryItem(outingId, item?.id ?? null, {
        onDate,
        kind,
        title: finalTitle,
        startsAt: startsAt || null,
        endsAt: kind === "flight" || kind === "transfer" ? endsAt || null : null,
        details: details.trim() || null,
        clubId: kind === "round" ? (club?.id ?? null) : null,
        fromPlace: fromPlace.trim() || null,
        toPlace: toPlace.trim() || null,
        carrier: carrier.trim() || null,
        nights: kind === "stay" ? nights : null,
        teeInterval: kind === "round" ? gap : null,
        playFormat: kind === "round" ? format : null,
      });
      if (place !== "none") {
        // In entrant order, so positions within a group follow the list.
        const list = entrants
          .filter((e) => seats.has(e.memberId))
          .map((e) => ({ memberId: e.memberId, slot: place === "slots" ? Math.min(seats.get(e.memberId) || 1, slotCount) : null }))
          .sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
        await setItemPeople(id, list);
      }
      router.back();
    } catch (err) {
      Alert.alert("Couldn't save that", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function remove() {
    if (!item) return;
    Alert.alert(`Remove ${item.title}?`, "It comes off the itinerary for everyone.", [
      { text: "Keep it", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteItineraryItem(item.id);
            router.back();
          } catch (err) {
            Alert.alert("Couldn't remove that", err instanceof Error ? err.message : "Please try again.");
          }
        },
      },
    ]);
  }

  const seated = entrants.filter((e) => seats.has(e.memberId)).length;

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: item ? `Edit ${info.label.toLowerCase()}` : `Add a ${info.label.toLowerCase()}`, headerBackTitle: "Back" }} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={[styles.kicker, { color: info.ink }]}>{onDate ? dayHeading(outing.playsOn, onDate).toUpperCase() : ""}</Text>

        <Section title="Day">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.days}>
            {days.map((d) => {
              const on = d === onDate;
              const t = dayTab(d);
              return (
                <Pressable key={d} style={[styles.day, on && styles.dayOn]} onPress={() => setOnDate(d)} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={outingDateLabel(d)}>
                  <Text style={[styles.dayWeek, on && styles.dayTextOn]}>{t.week}</Text>
                  <Text style={[styles.dayNum, on && styles.dayTextOn]}>{t.day}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </Section>

        {kind === "round" ? (
          <Section title="Course">
            {roundTitle ? (
              <View style={styles.picker}>
                <Ionicons name="flag-outline" size={20} color={colors.navy900} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.pickerText}>{roundTitle}</Text>
                  {club ? <Text style={styles.meta}>{placeLabel(club)}</Text> : null}
                </View>
                <Pressable
                  onPress={() => {
                    setClub(null);
                    setTitle("");
                  }}
                  hitSlop={8}
                  accessibilityRole="button"
                >
                  <Text style={styles.change}>Change</Text>
                </Pressable>
              </View>
            ) : (
              <CourseSearch placeholder="Search Ireland, the UK, Spain, Portugal" onPick={setClub} />
            )}
          </Section>
        ) : (
          <Section title={kind === "stay" ? "Hotel or house" : kind === "flight" ? "Name" : "What"}>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder={kind === "stay" ? "e.g. Dona Filipa Hotel" : kind === "flight" ? "e.g. Outbound" : kind === "transfer" ? "e.g. Minibus to the hotel" : kind === "meal" ? "e.g. Welcome dinner" : "e.g. Free afternoon"}
              placeholderTextColor={colors.ink500}
              style={styles.input}
              maxLength={120}
            />
          </Section>
        )}

        {kind === "flight" || kind === "transfer" ? (
          <View style={styles.pair}>
            <View style={{ flex: 1 }}>
              <Section title="From">
                <TextInput value={fromPlace} onChangeText={setFromPlace} placeholder={kind === "flight" ? "DUB" : "Faro airport"} placeholderTextColor={colors.ink500} style={styles.input} maxLength={60} autoCapitalize={kind === "flight" ? "characters" : "sentences"} />
              </Section>
            </View>
            <View style={{ flex: 1 }}>
              <Section title="To">
                <TextInput value={toPlace} onChangeText={setToPlace} placeholder={kind === "flight" ? "FAO" : "Hotel"} placeholderTextColor={colors.ink500} style={styles.input} maxLength={60} autoCapitalize={kind === "flight" ? "characters" : "sentences"} />
              </Section>
            </View>
          </View>
        ) : null}

        {kind !== "stay" ? (
          <View style={styles.pair}>
            <View style={{ flex: 1 }}>
              <Section title={kind === "round" ? "First tee" : kind === "flight" ? "Departs" : "Time"}>
                <Pressable style={styles.picker} onPress={() => setTimeOpen("start")} accessibilityRole="button">
                  <Ionicons name="time-outline" size={20} color={colors.navy900} />
                  <Text style={styles.pickerText}>{startsAt || "Not set"}</Text>
                </Pressable>
              </Section>
            </View>
            {kind === "flight" || kind === "transfer" ? (
              <View style={{ flex: 1 }}>
                <Section title={kind === "flight" ? "Lands (local)" : "Arrives"}>
                  <Pressable style={styles.picker} onPress={() => setTimeOpen("end")} accessibilityRole="button">
                    <Ionicons name="time-outline" size={20} color={colors.navy900} />
                    <Text style={styles.pickerText}>{endsAt || "Not set"}</Text>
                  </Pressable>
                </Section>
              </View>
            ) : null}
          </View>
        ) : null}

        {kind === "flight" || kind === "transfer" ? (
          <Section title={kind === "flight" ? "Airline and flight number" : "Company"} hint="Optional. Booking references stay with each member — they're not kept here.">
            <TextInput value={carrier} onChangeText={setCarrier} placeholder={kind === "flight" ? "e.g. Aer Lingus EI 490" : "e.g. Algarve Golf Transfers"} placeholderTextColor={colors.ink500} style={styles.input} maxLength={60} />
          </Section>
        ) : null}

        {kind === "round" ? (
          <>
            <Section title="Format">
              <ChipGroup>
                {FORMATS.map((f) => (
                  <Chip key={f} label={FORMAT_LABELS[f]} selected={format === f} onPress={() => setFormat(format === f ? null : f)} />
                ))}
              </ChipGroup>
            </Section>
            <Section title="Minutes between groups">
              <ChipGroup>
                {GAPS.map((g) => (
                  <Chip key={g} label={`${g} min`} selected={gap === g} onPress={() => setGap(g)} />
                ))}
              </ChipGroup>
            </Section>
          </>
        ) : null}

        {kind === "stay" ? (
          <Section title="Nights" hint={onDate ? `Check in ${outingDateLabel(onDate)} · check out ${outingDateLabel(checkOutDate(onDate, nights))}` : undefined}>
            <Stepper value={nights} min={1} max={30} onChange={setNights} label="nights" />
          </Section>
        ) : null}

        {/* Who's on it */}
        {place !== "none" ? (
          <Section
            title={place === "slots" ? (kind === "round" ? "Groups & tee times" : "Rooms") : `Who's on it · ${seated} of ${entrants.length}`}
            hint={entrants.length === 0 ? "Nobody has joined the trip yet. Add members from the trip's page." : undefined}
          >
            {entrants.length > 0 && place === "slots" ? (
              <>
                <View style={styles.slotBar}>
                  <Stepper value={slotCount} min={1} max={Math.max(1, Math.min(60, entrants.length))} onChange={setSlotCount} label={kind === "round" ? "groups" : "rooms"} />
                  <Pressable style={styles.deal} onPress={dealAtRandom} accessibilityRole="button">
                    <Ionicons name="shuffle" size={16} color={colors.cream50} />
                    <Text style={styles.dealText}>{kind === "round" ? "Random draw" : "Pair at random"}</Text>
                  </Pressable>
                </View>
                {kind === "round" && startsAt ? (
                  <Text style={styles.meta}>
                    {Array.from({ length: slotCount }, (_, i) => `${i + 1}: ${teeTimeFor(startsAt, gap, i + 1)}`).join("   ")}
                  </Text>
                ) : null}
                {entrants.map((e) => {
                  const s = seats.get(e.memberId);
                  return (
                    <View key={e.memberId} style={styles.personRow}>
                      <Text style={styles.personName} numberOfLines={1}>
                        {e.name}
                      </Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.slotPicks}>
                        <Pressable style={[styles.slotPick, s == null && styles.slotPickOff]} onPress={() => seat(e.memberId, null)} accessibilityRole="button" accessibilityLabel={`${e.name}: not ${kind === "round" ? "playing" : "staying"}`} accessibilityState={{ selected: s == null }}>
                          <Text style={[styles.slotPickText, s == null && styles.slotPickTextOff]}>–</Text>
                        </Pressable>
                        {Array.from({ length: slotCount }, (_, i) => i + 1).map((n) => (
                          <Pressable key={n} style={[styles.slotPick, s === n && styles.slotPickOn]} onPress={() => seat(e.memberId, n)} accessibilityRole="button" accessibilityLabel={`${e.name}: ${slotWord.toLowerCase()} ${n}`} accessibilityState={{ selected: s === n }}>
                            <Text style={[styles.slotPickText, s === n && styles.slotPickTextOn]}>{n}</Text>
                          </Pressable>
                        ))}
                      </ScrollView>
                    </View>
                  );
                })}
              </>
            ) : null}
            {entrants.length > 0 && place === "list" ? (
              <>
                <View style={styles.slotBar}>
                  <Pressable style={styles.small} onPress={() => setSeats(new Map(entrants.map((e) => [e.memberId, 0])))} accessibilityRole="button">
                    <Text style={styles.smallText}>Everyone</Text>
                  </Pressable>
                  <Pressable style={styles.small} onPress={() => setSeats(new Map())} accessibilityRole="button">
                    <Text style={styles.smallText}>Nobody</Text>
                  </Pressable>
                </View>
                {entrants.map((e) => {
                  const on = seats.has(e.memberId);
                  return (
                    <Pressable key={e.memberId} style={styles.tickRow} onPress={() => seat(e.memberId, on ? null : 0)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                      <Ionicons name={on ? "checkbox" : "square-outline"} size={22} color={on ? colors.navy900 : colors.ink500} />
                      <Text style={styles.personName}>{e.name}</Text>
                    </Pressable>
                  );
                })}
                <Text style={styles.meta}>Anyone on a different flight goes on a flight of their own.</Text>
              </>
            ) : null}
          </Section>
        ) : null}

        <Section title="Notes" hint="Optional.">
          <TextInput
            value={details}
            onChangeText={setDetails}
            placeholder={kind === "round" ? "Buggies booked, 10 minutes from the hotel" : kind === "flight" ? "Check-in closes 40 minutes before" : kind === "meal" ? "Smart casual, kitty pays" : "Anything to know"}
            placeholderTextColor={colors.ink500}
            style={[styles.input, styles.multi]}
            multiline
            maxLength={1000}
          />
        </Section>

        {problem ? <Text style={styles.problem}>{problem}</Text> : null}
        <Pressable style={[styles.cta, (problem || saving) && styles.ctaOff]} onPress={() => void save()} disabled={!!problem || saving} accessibilityRole="button">
          {saving ? <ActivityIndicator color={colors.cream50} /> : <Text style={styles.ctaText}>{item ? "Save changes" : `Add to ${onDate ? dayTab(onDate).week.charAt(0) + dayTab(onDate).week.slice(1).toLowerCase() : "the day"}`}</Text>}
        </Pressable>
        {item ? (
          <Pressable style={styles.remove} onPress={remove} accessibilityRole="button">
            <Ionicons name="trash-outline" size={16} color={colors.red600} />
            <Text style={styles.removeText}>Remove from the itinerary</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <TimeSheet
        open={timeOpen != null}
        title={timeOpen === "end" ? (kind === "flight" ? "Lands" : "Arrives") : kind === "round" ? "First tee" : kind === "flight" ? "Departs" : "Time"}
        value={timeOpen === "end" ? endsAt : startsAt}
        onClose={() => setTimeOpen(null)}
        onChange={(t) => (timeOpen === "end" ? setEndsAt(t) : setStartsAt(t))}
      />
    </KeyboardAvoidingView>
  );
}

function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (n: number) => void; label: string }) {
  return (
    <View style={styles.stepper} accessibilityLabel={`${value} ${label}`}>
      <Pressable style={styles.stepBtn} onPress={() => onChange(Math.max(min, value - 1))} disabled={value <= min} accessibilityRole="button" accessibilityLabel={`Fewer ${label}`}>
        <Ionicons name="remove" size={18} color={value <= min ? colors.line : colors.navy900} />
      </Pressable>
      <Text style={styles.stepValue}>{`${value} ${label}`}</Text>
      <Pressable style={styles.stepBtn} onPress={() => onChange(Math.min(max, value + 1))} disabled={value >= max} accessibilityRole="button" accessibilityLabel={`More ${label}`}>
        <Ionicons name="add" size={18} color={value >= max ? colors.line : colors.navy900} />
      </Pressable>
    </View>
  );
}

/** What a member sees: the details and who is where. */
function ItemView({ item, playsOn, userId }: { item: ItineraryItem; playsOn: string; userId: string | null }) {
  const info = ITEM_INFO[item.kind];
  const slots = bySlot(item.people);
  const facts = [
    item.kind === "flight" || item.kind === "transfer" ? routeLabel(item.fromPlace, item.toPlace) : null,
    item.startsAt ? `${item.kind === "round" ? "First tee" : item.kind === "flight" ? "Departs" : "At"} ${clock(item.startsAt)}` : null,
    item.endsAt ? `${item.kind === "flight" ? "Lands" : "Arrives"} ${clock(item.endsAt)}` : null,
    item.carrier,
    item.kind === "stay" ? `${item.nights ?? 1} ${item.nights === 1 ? "night" : "nights"} · out ${outingDateLabel(checkOutDate(item.onDate, item.nights))}` : null,
    item.kind === "round" ? [item.playFormat ? FORMAT_LABELS[item.playFormat] : null, `${item.teeInterval ?? 10} min apart`].filter(Boolean).join(" · ") : null,
  ].filter(Boolean) as string[];

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ title: info.label, headerBackTitle: "Back" }} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[styles.kicker, { color: info.ink }]}>{dayHeading(playsOn, item.onDate).toUpperCase()}</Text>
        <Text style={styles.viewTitle}>{item.title}</Text>
        {facts.map((f) => (
          <Text key={f} style={styles.viewFact}>
            {f}
          </Text>
        ))}
        {item.details ? <Text style={styles.viewNotes}>{item.details}</Text> : null}

        {slots.length > 0
          ? slots.map(([slot, list]) => {
              const mine = list.some((p) => p.memberId === userId);
              return (
                <View key={slot} style={[styles.slotCard, mine && styles.slotCardMine]}>
                  <Text style={styles.slotTitle}>
                    {item.kind === "round" ? `${teeTimeFor(item.startsAt, item.teeInterval, slot) ?? ""}${item.startsAt ? " · " : ""}Group ${slot}` : `Room ${slot}`}
                  </Text>
                  {list.map((p) => (
                    <Text key={p.memberId} style={styles.slotPerson}>
                      {p.memberId === userId ? `${p.name} (you)` : p.name}
                    </Text>
                  ))}
                </View>
              );
            })
          : item.people.length > 0
            ? (
                <View style={styles.slotCard}>
                  <Text style={styles.slotTitle}>{`On it · ${item.people.length}`}</Text>
                  {item.people.map((p) => (
                    <Text key={p.memberId} style={styles.slotPerson}>
                      {p.memberId === userId ? `${p.name} (you)` : p.name}
                    </Text>
                  ))}
                </View>
              )
            : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  body: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  kicker: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.2 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, backgroundColor: colors.surface, paddingHorizontal: spacing.md, fontFamily: fonts.body, fontSize: type.body, color: colors.ink900 },
  multi: { minHeight: 80, paddingTop: 12, textAlignVertical: "top" },
  days: { gap: spacing.sm },
  day: { width: 54, minHeight: 54, borderRadius: radii.md, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  dayOn: { backgroundColor: colors.navy900, borderColor: colors.navy900 },
  dayWeek: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.ink500 },
  dayNum: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.ink900 },
  dayTextOn: { color: colors.gold400 },
  picker: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 52, paddingHorizontal: spacing.md, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  pickerText: { flex: 1, fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  meta: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500 },
  change: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },
  pair: { flexDirection: "row", gap: spacing.sm },
  slotBar: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm },
  deal: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, minHeight: 40, borderRadius: radii.pill, backgroundColor: colors.navy900 },
  dealText: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: colors.cream50 },
  personRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  personName: { flex: 1, fontFamily: fonts.bodySemi, fontSize: type.small + 1, color: colors.ink900 },
  slotPicks: { gap: 6 },
  slotPick: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  slotPickOn: { backgroundColor: colors.navy900, borderColor: colors.navy900 },
  slotPickOff: { backgroundColor: colors.cream100 },
  slotPickText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink900 },
  slotPickTextOn: { color: colors.gold400 },
  slotPickTextOff: { color: colors.ink500 },
  tickRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44 },
  small: { paddingHorizontal: 14, height: 36, borderRadius: radii.pill, justifyContent: "center", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  smallText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.navy900 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignSelf: "flex-start" },
  stepBtn: { width: 44, height: 40, alignItems: "center", justifyContent: "center" },
  stepValue: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900, minWidth: 74, textAlign: "center" },
  problem: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.red600, textAlign: "center" },
  cta: { minHeight: 52, borderRadius: radii.pill, backgroundColor: colors.green700, alignItems: "center", justifyContent: "center" },
  ctaOff: { opacity: 0.5 },
  ctaText: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
  remove: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 44 },
  removeText: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.red600 },
  viewTitle: { fontFamily: fonts.display, fontSize: 28, color: colors.navy900, marginTop: -spacing.sm },
  viewFact: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900, marginTop: -spacing.sm },
  viewNotes: { fontFamily: fonts.body, fontSize: type.body, color: colors.ink900, lineHeight: 22 },
  slotCard: { gap: 4, padding: 14, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  slotCardMine: { borderColor: colors.green600, backgroundColor: colors.green100 },
  slotTitle: { fontFamily: fonts.display, fontSize: 17, color: colors.navy900 },
  slotPerson: { fontFamily: fonts.body, fontSize: type.body, color: colors.ink900 },
});
