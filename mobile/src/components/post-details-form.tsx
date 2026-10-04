import type { ReactNode } from "react";
import { StyleSheet, Text, TextInput, View, type KeyboardTypeOptions } from "react-native";

import { Chip, ChipGroup } from "@/components/form-bits";
import { recentDays } from "@/lib/feed-rules";
import { LIES, LIE_LABELS, LIMITS, TEES, type PostKind } from "@/lib/post-details";
import type { DetailsDraft } from "@/lib/post-draft";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * The golf part of the composer: a round, a hole or a shot.
 *
 * Chips where the answers are few (tees, holes, par, lie, common clubs),
 * number pads where they're numbers, free text only for a custom club and
 * how a shot finished. Everything but each kind's one essential is optional
 * — the post card shows whatever was given and skips the rest.
 *
 * The strings typed here become stored details in post-draft.ts; the rules
 * they must meet live in post-details.ts, shared with the website.
 *
 * Not here, deliberately: hole maps, shot coordinates and paths (nothing in
 * PinPals captures them yet), and handicap differential is optional and
 * labelled "if you know it" — PinPals has no course or slope ratings to
 * work it out.
 */

const CLUBS = ["Driver", "3 Wood", "5 Wood", "Hybrid", "4 Iron", "5 Iron", "6 Iron", "7 Iron", "8 Iron", "9 Iron", "PW", "GW", "SW", "LW", "Putter"];
const RESULTS = ["Holed it!", "Stiff", "On the green", "Tap-in", "Unlucky bounce"];

export function PostDetailsForm({
  kind,
  draft,
  onChange,
}: {
  kind: PostKind;
  draft: DetailsDraft;
  onChange: (next: DetailsDraft) => void;
}) {
  const set = <K extends keyof DetailsDraft>(key: K) => (value: DetailsDraft[K]) => onChange({ ...draft, [key]: value });
  const toggle = <K extends keyof DetailsDraft>(key: K, value: DetailsDraft[K]) =>
    onChange({ ...draft, [key]: draft[key] === value ? ("" as DetailsDraft[K]) : value });

  if (kind === "round") {
    return (
      <View style={styles.wrap}>
        <Group title="Your score">
          <Row>
            <NumberField label="Score" value={draft.score} onChange={set("score")} required big />
            <NumberField label="Course par" value={draft.course_par} onChange={set("course_par")} placeholder="72" />
          </Row>
          <ChipGroup>
            {(["18", "9"] as const).map((h) => (
              <Chip key={h} label={`${h} holes`} selected={draft.holes === h} onPress={() => set("holes")(h)} />
            ))}
          </ChipGroup>
        </Group>

        <Group title="When">
          <ChipGroup>
            {recentDays(7).map((day) => (
              <Chip key={day.iso} label={day.label} selected={draft.played_on === day.iso} onPress={() => set("played_on")(day.iso)} />
            ))}
          </ChipGroup>
        </Group>

        <Group title="Tees">
          <ChipGroup>
            {TEES.map((t) => (
              <Chip key={t} label={t} selected={draft.tee === t} onPress={() => toggle("tee", t)} />
            ))}
          </ChipGroup>
        </Group>

        <Group title="Stats" hint="Optional — add what you kept.">
          <Row>
            <NumberField label="Fairways hit" value={draft.fairways_hit} onChange={set("fairways_hit")} />
            <NumberField label="of" value={draft.fairways_total} onChange={set("fairways_total")} placeholder="14" />
          </Row>
          <Row>
            <NumberField label="Greens in reg." value={draft.gir} onChange={set("gir")} />
            <NumberField label="Putts" value={draft.putts} onChange={set("putts")} />
          </Row>
          <Row>
            <NumberField label="Birdies" value={draft.birdies} onChange={set("birdies")} />
            <NumberField
              label="Differential"
              hint="if you know it"
              value={draft.differential}
              onChange={set("differential")}
              keyboardType="numbers-and-punctuation"
            />
          </Row>
        </Group>

        <Group title="Best hole" hint="Optional.">
          <Row>
            <NumberField label="Hole" value={draft.best_hole} onChange={set("best_hole")} />
            <NumberField label="Par" value={draft.best_par} onChange={set("best_par")} />
            <NumberField label="Score" value={draft.best_score} onChange={set("best_score")} />
          </Row>
        </Group>
      </View>
    );
  }

  if (kind === "hole") {
    return (
      <View style={styles.wrap}>
        <Group title="The hole">
          <Row>
            <NumberField label="Hole" value={draft.hole} onChange={set("hole")} required big />
            <NumberField label="Yards" value={draft.yards} onChange={set("yards")} />
          </Row>
          <Text style={styles.sub}>Par</Text>
          <ChipGroup>
            {["3", "4", "5"].map((p) => (
              <Chip key={p} label={`Par ${p}`} selected={draft.par === p} onPress={() => toggle("par", p)} />
            ))}
          </ChipGroup>
        </Group>
        <Group title="Your score" hint="Optional.">
          <ChipGroup>
            {["1", "2", "3", "4", "5", "6", "7"].map((s) => (
              <Chip key={s} label={s === "1" ? "1 · Ace" : s} selected={draft.hole_score === s} onPress={() => toggle("hole_score", s)} />
            ))}
          </ChipGroup>
        </Group>
      </View>
    );
  }

  if (kind === "shot") {
    return (
      <View style={styles.wrap}>
        <Group title="Where">
          <Row>
            <NumberField label="Hole" value={draft.hole} onChange={set("hole")} />
            <NumberField label="Shot no." value={draft.shot_number} onChange={set("shot_number")} />
            <NumberField label="Yards" value={draft.distance_yards} onChange={set("distance_yards")} />
          </Row>
          <Text style={styles.sub}>Lie</Text>
          <ChipGroup>
            {LIES.map((l) => (
              <Chip key={l} label={LIE_LABELS[l]} selected={draft.lie === l} onPress={() => toggle("lie", l)} />
            ))}
          </ChipGroup>
        </Group>
        <Group title="Club">
          <ChipGroup>
            {CLUBS.map((c) => (
              <Chip key={c} label={c} selected={draft.club === c} onPress={() => toggle("club", c)} />
            ))}
          </ChipGroup>
          <TextInput
            value={CLUBS.includes(draft.club) ? "" : draft.club}
            onChangeText={set("club")}
            placeholder="Or type it — 60° wedge, driving iron…"
            placeholderTextColor={colors.ink500}
            maxLength={LIMITS.clubLength}
            style={styles.text}
            accessibilityLabel="Club"
          />
        </Group>
        <Group title="How it finished">
          <ChipGroup>
            {RESULTS.map((r) => (
              <Chip key={r} label={r} selected={draft.result === r} onPress={() => toggle("result", r)} />
            ))}
          </ChipGroup>
          <TextInput
            value={RESULTS.includes(draft.result) ? "" : draft.result}
            onChangeText={set("result")}
            placeholder="Or in your own words"
            placeholderTextColor={colors.ink500}
            maxLength={LIMITS.resultLength}
            style={styles.text}
            accessibilityLabel="How it finished"
          />
        </Group>
      </View>
    );
  }

  return null;
}

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <View style={styles.groupHead}>
        <Text style={styles.groupTitle}>{title}</Text>
        {hint ? <Text style={styles.groupHint}>{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

function NumberField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  required = false,
  big = false,
  keyboardType = "number-pad",
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  big?: boolean;
  keyboardType?: KeyboardTypeOptions;
}) {
  return (
    <View style={styles.cell}>
      <Text style={styles.fieldLabel} numberOfLines={1}>
        {label}
        {required ? <Text style={styles.required}> *</Text> : null}
        {hint ? <Text style={styles.fieldHint}> {hint}</Text> : null}
      </Text>
      <TextInput
        value={value}
        onChangeText={(t) => onChange(t.replace(/[^0-9.\-]/g, ""))}
        keyboardType={keyboardType}
        placeholder={placeholder}
        placeholderTextColor={colors.line}
        maxLength={5}
        style={[styles.number, big && styles.numberBig]}
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  group: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    padding: spacing.md - 2,
    gap: spacing.sm + 2,
  },
  groupHead: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm },
  groupTitle: { fontFamily: fonts.display, fontSize: 17, color: colors.ink900 },
  groupHint: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500 },
  sub: { fontFamily: fonts.bodySemi, fontSize: type.label, color: colors.ink500 },
  row: { flexDirection: "row", gap: spacing.sm + 2 },
  cell: { flex: 1, minWidth: 0 },
  fieldLabel: { fontFamily: fonts.bodySemi, fontSize: type.label, color: colors.ink900, marginBottom: 4 },
  fieldHint: { fontFamily: fonts.body, color: colors.ink500 },
  required: { color: colors.red600 },
  // 16pt minimum: iOS zooms the page when a smaller field takes focus
  // (theme.ts). 44pt tall for a thumb on the first tee.
  number: {
    fontFamily: fonts.bodySemi,
    fontSize: type.body,
    color: colors.ink900,
    backgroundColor: colors.surfaceTint,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.line,
    paddingHorizontal: spacing.sm + 4,
    minHeight: 44,
  },
  numberBig: { fontFamily: fonts.display, fontSize: 24, minHeight: 52 },
  text: {
    fontFamily: fonts.body,
    fontSize: type.body,
    color: colors.ink900,
    backgroundColor: colors.surfaceTint,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.line,
    paddingHorizontal: spacing.sm + 4,
    minHeight: 44,
  },
});
