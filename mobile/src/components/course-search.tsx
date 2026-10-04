import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { placeLabel, searchCourses, type Club } from "@/lib/courses";
import { colors, fonts, radii } from "@/lib/theme";

/**
 * A search box that finds a course and hands it back.
 *
 * Used by the Played and Bucket list steps, where the main list is a set of
 * suggestions and this is the escape hatch for "my course isn't there".
 * Results show inline under the box and vanish once one is picked.
 */
export function CourseSearch({
  placeholder,
  onPick,
  exclude,
}: {
  placeholder: string;
  onPick: (club: Club) => void;
  exclude?: Set<number>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Club[]>([]);
  const [loading, setLoading] = useState(false);
  const token = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const t = ++token.current;
    setLoading(true);
    const timer = setTimeout(() => {
      void searchCourses(q, 8)
        .then((clubs) => {
          if (t === token.current) setResults(clubs);
        })
        .finally(() => t === token.current && setLoading(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <View>
      <View style={styles.box}>
        <Ionicons name="search" size={20} color={colors.ink500} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={placeholder}
          placeholderTextColor={colors.ink500}
          style={styles.input}
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel={placeholder}
        />
        {loading ? <ActivityIndicator color={colors.green700} /> : null}
      </View>
      {results.length > 0 ? (
        <View style={styles.results}>
          {results
            .filter((c) => !exclude?.has(c.id))
            .map((club) => (
              <Pressable
                key={club.id}
                style={styles.result}
                onPress={() => {
                  onPick(club);
                  setQuery("");
                  setResults([]);
                }}
                accessibilityRole="button"
              >
                <Ionicons name="add-circle-outline" size={22} color={colors.green700} />
                <View style={styles.resultText}>
                  <Text style={styles.name} numberOfLines={1}>{club.name}</Text>
                  <Text style={styles.meta} numberOfLines={1}>{placeLabel(club)}</Text>
                </View>
              </Pressable>
            ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 46,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
  },
  input: { flex: 1, fontFamily: fonts.body, fontSize: 16, color: colors.ink900, paddingVertical: 11 },
  results: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  result: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  resultText: { flex: 1 },
  name: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.ink900 },
  meta: { fontFamily: fonts.body, fontSize: 13, color: "#5b6576" },
});
