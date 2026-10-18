import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { FORM_SCROLL_KEYBOARD } from "@/components/keyboard";
import { ScreenHeader } from "@/components/screen-header";
import { Chip, LieRow, bits } from "@/components/train-bits";
import { LIES, LIE_CATEGORIES, liesIn, searchLies, type LieCategory } from "@/lib/training";
import { useTraining } from "@/lib/training-store";
import { colors, fonts, radii, type } from "@/lib/theme";

/** Training → What's your lie? Every lie guide, searchable, by kind. */

type Filter = "all" | LieCategory;

export default function LiesScreen() {
  const router = useRouter();
  const { hand } = useTraining();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const searching = query.trim().length > 0;
  const hits = useMemo(() => searchLies(query), [query]);
  const groups = LIE_CATEGORIES.filter((c) => filter === "all" || c.id === filter);
  const open = (id: string) => router.push(`/train/lie/${id}`);

  return (
    <View style={bits.fill}>
      <Stack.Screen options={{ headerTitle: "", headerBackTitle: "Training" }} />
      <ScreenHeader scene="oldHead" title="What's your lie?" subtitle={`Shot Coach · ${LIES.length} lies`} />
      <ScrollView contentContainerStyle={bits.body} {...FORM_SCROLL_KEYBOARD}>
        <View style={[styles.box, searching && styles.boxOn]}>
          <Ionicons name="search" size={20} color={searching ? colors.navy900 : colors.ink500} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="e.g. ball above my feet, fried egg"
            placeholderTextColor={colors.ink500}
            style={styles.input}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            clearButtonMode="while-editing"
            accessibilityLabel="Search lies"
          />
        </View>

        {searching ? (
          hits.length === 0 ? (
            <Text style={bits.muted} accessibilityLiveRegion="polite">{`Nothing matched “${query.trim()}”. Try a simpler word — slope, sand, rough, wind.`}</Text>
          ) : (
            <View style={bits.group}>
              {hits.map((l, i) => (
                <LieRow key={l.id} lie={l} hand={hand} first={i === 0} onPress={() => open(l.id)} />
              ))}
            </View>
          )
        ) : (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={bits.chips}>
              {([{ id: "all", label: "All" }, ...LIE_CATEGORIES] as { id: Filter; label: string }[]).map((c) => (
                <Chip key={c.id} label={c.label} on={filter === c.id} onPress={() => setFilter(c.id)} />
              ))}
            </ScrollView>
            {groups.map((c) => (
              <View key={c.id} style={{ gap: 8 }}>
                <Text style={styles.groupLabel} accessibilityRole="header">
                  {c.label.toUpperCase()}
                </Text>
                <View style={bits.group}>
                  {liesIn(c.id).map((l, i) => (
                    <LieRow key={l.id} lie={l} hand={hand} first={i === 0} onPress={() => open(l.id)} />
                  ))}
                </View>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, borderRadius: radii.lg, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.surface },
  boxOn: { borderColor: colors.navy900 },
  input: { flex: 1, paddingVertical: 14, fontFamily: fonts.body, fontSize: type.body, color: colors.ink900 },
  groupLabel: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.6, color: colors.green700, marginTop: 4 },
});
