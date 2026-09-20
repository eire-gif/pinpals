import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Linking from "expo-linking";

import { useCurrentLocation } from "@/lib/location";
import {
  COUNTRY_CODES,
  coursesNear,
  countryName,
  distanceLabel,
  listCourses,
  memberCounts,
  placeLabel,
  searchCourses,
  type Club,
} from "@/lib/courses";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * The course directory.
 *
 * The website splits this in two — /courses asks which country, then
 * /courses/[country] lists it. On a phone that second tap is pure toll: the
 * answer is almost always Ireland, and the one screen that matters is the
 * list. So both live here, with the country as a chip row rather than a page
 * of its own.
 *
 * Three ways in, in the order a golfer actually uses them:
 *
 *   1. Type a name. This is the overwhelming case — people come to a course
 *      directory to find one course. Search ignores the chips and looks
 *      everywhere, because a member typing "Birkdale" wants Birkdale, not
 *      proof that it isn't in Ireland.
 *   2. Near me. One tap, no typing, and the reason the app can do something
 *      the printed handbook can't.
 *   3. Browse a country, alphabetically, paged.
 *
 * The list is native; the club's own page stays on the website inside the web
 * view. That page has the members, the map, the "set as my home club" button
 * and its own server logic behind all three — rebuilding it natively would be
 * a second implementation of the most detailed page on the site, for no gain
 * a member would notice.
 */

const RADIUS_KM = 50;

type Scope = { kind: "country"; code: string } | { kind: "near" };

export default function CoursesScreen() {
  const router = useRouter();
  const location = useCurrentLocation();

  const [query, setQuery] = useState("");
  const [term, setTerm] = useState("");
  const [scope, setScope] = useState<Scope>({ kind: "country", code: "ireland" });

  const [clubs, setClubs] = useState<Club[]>([]);
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);

  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searching = term.trim().length >= 2;

  // A keystroke is not a query. 250ms is long enough that "Ballybunion" is
  // one request rather than eleven, and short enough that it still feels like
  // the list is following your typing.
  useEffect(() => {
    const timer = setTimeout(() => setTerm(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

  // Every load carries a token. Without one, switching from England to
  // Ireland while England is still in flight lets the slower answer land
  // last and paint the wrong country — the classic list race.
  const requestId = useRef(0);

  const addCounts = useCallback(async (rows: Club[], id: number) => {
    const map = await memberCounts(rows.map((row) => row.id));
    if (id !== requestId.current) return;
    // Merged rather than replaced: a club's member count doesn't depend on
    // how you found the club, so this doubles as a cache across scopes.
    setCounts((prev) => ({ ...prev, ...map }));
  }, []);

  const loadFirstPage = useCallback(async () => {
    const id = (requestId.current += 1);
    setError(null);

    try {
      let rows: Club[];
      let count: number;
      let done = true;

      if (searching) {
        rows = await searchCourses(term);
        count = rows.length;
      } else if (scope.kind === "near") {
        // Reuse a fix we already have rather than waking the GPS again.
        const coords =
          location.state.status === "ready"
            ? location.state.coords
            : await location.request();

        if (!coords) {
          if (id !== requestId.current) return;
          setClubs([]);
          setTotal(0);
          setMore(false);
          return;
        }
        const near = await coursesNear(coords.lat, coords.lng, RADIUS_KM);
        rows = near.clubs;
        count = near.total;
      } else {
        const result = await listCourses(scope.code, 0);
        rows = result.clubs;
        count = result.total;
        done = result.done;
      }

      if (id !== requestId.current) return;
      setClubs(rows);
      setTotal(count);
      setPage(0);
      setMore(!done);
      void addCounts(rows, id);
    } catch {
      if (id !== requestId.current) return;
      setError("Couldn't load the course directory.");
      setClubs([]);
      setTotal(0);
      setMore(false);
    } finally {
      if (id === requestId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
    // `location` is deliberately not a dependency: its identity changes on
    // every permission transition, and including it turns "Near me" into a
    // loop that asks, resolves, re-renders and asks again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searching, term, scope, addCounts]);

  useEffect(() => {
    setLoading(true);
    void loadFirstPage();
  }, [loadFirstPage]);

  const loadMore = useCallback(async () => {
    // Search is capped at 60 and "near me" at the radius — neither pages.
    // Refine the search or widen nothing: there is no page two to fetch.
    if (searching || scope.kind === "near") return;
    if (loading || loadingMore || !more) return;

    const id = requestId.current;
    setLoadingMore(true);

    try {
      const next = page + 1;
      const result = await listCourses(scope.code, next);
      if (id !== requestId.current) return;

      setClubs((prev) => [...prev, ...result.clubs]);
      setPage(next);
      setMore(!result.done);
      void addCounts(result.clubs, id);
    } catch {
      // Quietly stop paging. A half-loaded directory with a working search
      // box is a far better place to be stuck than an error screen.
      if (id === requestId.current) setMore(false);
    } finally {
      if (id === requestId.current) setLoadingMore(false);
    }
  }, [searching, scope, loading, loadingMore, more, page, addCounts]);

  // Remounting the list is how the scroll position gets reset. Keyed on the
  // scope rather than on the results, so it does NOT remount on every
  // keystroke of a search — only when you move between browsing and
  // searching, or between countries.
  const listKey = searching
    ? "search"
    : scope.kind === "near"
      ? "near"
      : scope.code;

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ title: "Courses", headerBackTitle: "Back" }} />

      <View style={styles.controls}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={17} color={colors.ink500} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search a club or a town"
            placeholderTextColor={colors.ink500}
            autoCorrect={false}
            autoCapitalize="words"
            returnKeyType="search"
            clearButtonMode="while-editing"
            accessibilityLabel="Search courses"
          />
        </View>

        {/* The chips are a browsing aid, not a filter on the search. While a
            search is running they'd be lying about what's on screen, so they
            make way for a line that tells the truth instead. */}
        {searching ? (
          <Pressable
            style={styles.searchNote}
            onPress={() => setQuery("")}
            accessibilityRole="button"
          >
            <Ionicons name="globe-outline" size={14} color={colors.ink500} />
            <Text style={styles.searchNoteText}>
              Searching every country · tap to browse instead
            </Text>
          </Pressable>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
            keyboardShouldPersistTaps="handled"
          >
            <Chip
              label="Near me"
              icon="navigate-outline"
              active={scope.kind === "near"}
              onPress={() => setScope({ kind: "near" })}
            />
            {COUNTRY_CODES.map((code) => (
              <Chip
                key={code}
                label={countryName(code)}
                active={scope.kind === "country" && scope.code === code}
                onPress={() => setScope({ kind: "country", code })}
              />
            ))}
          </ScrollView>
        )}
      </View>

      {loading ? (
        <View style={styles.centre}>
          <ActivityIndicator size="large" color={colors.green700} />
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.list}
          data={clubs}
          keyExtractor={(item) => String(item.id)}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          // Without this, switching from England to Wales leaves you 400 rows
          // down a 168-row list, looking at nothing.
          key={listKey}
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.6}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void loadFirstPage();
              }}
              tintColor={colors.green700}
            />
          }
          ListHeaderComponent={
            clubs.length > 0 ? (
              <ResultLine
                searching={searching}
                term={term}
                scope={scope}
                total={total}
                shown={clubs.length}
              />
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              searching={searching}
              term={term}
              scope={scope}
              error={error}
              locationStatus={location.state.status}
              onRetryLocation={() => void loadFirstPage()}
              onClearSearch={() => setQuery("")}
            />
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator color={colors.green700} style={styles.footer} />
            ) : null
          }
          renderItem={({ item }) => (
            <CourseRow
              club={item}
              members={counts[item.id] ?? 0}
              // Browsing one country, its name on every card says nothing.
              hideCountry={!searching && scope.kind === "country"}
              onPress={() =>
                router.push({
                  pathname: "/web",
                  params: {
                    path: `/courses/${item.country}/${item.slug}`,
                    title: item.name,
                  },
                })
              }
            />
          )}
        />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------

function CourseRow({
  club,
  members,
  hideCountry,
  onPress,
}: {
  club: Club;
  members: number;
  hideCountry: boolean;
  onPress: () => void;
}) {
  const distance = distanceLabel(club.distance_km);
  const place = placeLabel(club, hideCountry);

  return (
    <Pressable style={styles.row} onPress={onPress} accessibilityRole="button">
      <View style={styles.rowBody}>
        <Text style={styles.rowName} numberOfLines={2}>
          {club.name}
        </Text>
        {place ? (
          <Text style={styles.rowPlace} numberOfLines={1}>
            {place}
          </Text>
        ) : null}

        {distance || members > 0 ? (
          <View style={styles.meta}>
            {distance ? (
              <View style={styles.distance}>
                <Ionicons name="navigate" size={11} color={colors.ink900} />
                <Text style={styles.distanceLabel}>{distance}</Text>
              </View>
            ) : null}
            {members > 0 ? (
              <Text style={styles.members}>
                {members === 1
                  ? "1 member plays here"
                  : `${members} members play here`}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>

      <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
    </Pressable>
  );
}

function ResultLine({
  searching,
  term,
  scope,
  total,
  shown,
}: {
  searching: boolean;
  term: string;
  scope: Scope;
  total: number;
  shown: number;
}) {
  if (searching) {
    return (
      <Text style={styles.resultLine}>
        {total === 1 ? "1 club matches" : `${total} clubs match`} “{term.trim()}”
        {total >= 60 ? " — showing the closest sixty" : ""}
      </Text>
    );
  }

  if (scope.kind === "near") {
    return (
      <View style={styles.resultBlock}>
        <Text style={styles.resultLine}>
          {shown < total
            ? `The ${shown} nearest of ${total} clubs within ${RADIUS_KM} km`
            : `${total === 1 ? "1 club" : `${total} clubs`} within ${RADIUS_KM} km of you`}
        </Text>
        {/* Said plainly rather than left to be discovered. A member standing
            in west Clare whose local isn't listed should know it's our data
            that's short, not their county. */}
        <Text style={styles.resultNote}>
          A handful of clubs have no location on file yet and can't appear here.
        </Text>
      </View>
    );
  }

  return (
    <Text style={styles.resultLine}>
      {shown < total
        ? `${shown} of ${total.toLocaleString("en-IE")} clubs in ${countryName(scope.code)}`
        : `${total.toLocaleString("en-IE")} ${total === 1 ? "club" : "clubs"} in ${countryName(scope.code)}`}
    </Text>
  );
}

function EmptyState({
  searching,
  term,
  scope,
  error,
  locationStatus,
  onRetryLocation,
  onClearSearch,
}: {
  searching: boolean;
  term: string;
  scope: Scope;
  error: string | null;
  locationStatus: string;
  onRetryLocation: () => void;
  onClearSearch: () => void;
}) {
  if (error) {
    return (
      <Empty
        icon="cloud-offline-outline"
        title={error}
        body="Pull down to try again."
      />
    );
  }

  if (searching) {
    return (
      <Empty
        icon="search-outline"
        title={`Nothing matching “${term.trim()}”`}
        body="Try the town instead of the club — or a shorter piece of the name."
        action={{ label: "Browse by country", onPress: onClearSearch }}
      />
    );
  }

  if (scope.kind === "near" && locationStatus === "denied") {
    return (
      <Empty
        icon="location-outline"
        title="Location is off"
        body="PinPals needs location to find courses near you. Turn it on in Settings → PinPals → Location."
        action={{
          label: "Open Settings",
          onPress: () => void Linking.openSettings(),
        }}
      />
    );
  }

  if (scope.kind === "near" && locationStatus === "failed") {
    return (
      <Empty
        icon="navigate-circle-outline"
        title="Couldn't find you"
        body="Sometimes it just needs another go, especially indoors."
        action={{ label: "Try again", onPress: onRetryLocation }}
      />
    );
  }

  if (scope.kind === "near") {
    return (
      <Empty
        icon="golf-outline"
        title={`No clubs within ${RADIUS_KM} km`}
        body="Some clubs are still missing a location on file. Search by name and you may well find it anyway."
      />
    );
  }

  return (
    <Empty
      icon="golf-outline"
      title="No clubs here yet"
      body="That's a gap in the directory rather than in the country. Try another one."
    />
  );
}

function Chip({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.chip, active && styles.chipActive]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      {icon ? (
        <Ionicons
          name={icon}
          size={15}
          color={active ? colors.cream50 : colors.ink500}
        />
      ) : null}
      <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function Empty({
  icon,
  title,
  body,
  action,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={44} color={colors.ink500} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      {action ? (
        <Pressable style={styles.primary} onPress={action.onPress}>
          <Text style={styles.primaryLabel}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },

  controls: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: 4,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    minHeight: 44,
  },
  // 16pt is a floor, not a preference: iOS zooms the whole screen when an
  // input below it takes focus. See theme.ts.
  searchInput: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: type.body,
    color: colors.ink900,
    paddingVertical: 10,
  },

  chips: { gap: spacing.sm, paddingHorizontal: spacing.md },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    minHeight: 36,
  },
  chipActive: {
    backgroundColor: colors.green700,
    borderColor: colors.green700,
  },
  chipLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: type.small,
    color: colors.ink500,
  },
  chipLabelActive: { color: colors.cream50 },

  searchNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginHorizontal: spacing.md,
    minHeight: 36,
  },
  searchNoteText: {
    fontFamily: fonts.body,
    fontSize: type.label,
    color: colors.ink500,
  },

  list: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },

  resultBlock: { gap: 2, marginBottom: 2 },
  resultLine: {
    fontFamily: fonts.bodySemi,
    fontSize: type.small,
    color: colors.ink500,
    marginBottom: 2,
  },
  resultNote: {
    fontFamily: fonts.body,
    fontSize: type.label,
    color: colors.ink500,
    marginBottom: 2,
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: 14,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  rowBody: { flex: 1, gap: 3 },
  // Playfair, the same face that carries a club's name on the website and on
  // an invitation card. It is the whole reason a list of names reads as a
  // directory of golf clubs rather than a list of search results.
  rowName: {
    fontFamily: fonts.display,
    fontSize: 18,
    lineHeight: 23,
    color: colors.ink900,
  },
  rowPlace: {
    fontFamily: fonts.body,
    fontSize: type.small,
    color: colors.ink500,
  },

  meta: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: 2,
  },
  // Gold with ink on it, never white: the palette note in theme.ts applies to
  // every warm accent we have.
  distance: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.gold400,
  },
  distanceLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 11.5,
    color: colors.ink900,
  },
  members: {
    fontFamily: fonts.bodySemi,
    fontSize: type.label,
    color: colors.green700,
  },

  centre: { flex: 1, alignItems: "center", justifyContent: "center" },
  footer: { paddingVertical: spacing.md },

  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.lg,
  },
  emptyTitle: {
    fontFamily: fonts.display,
    fontSize: 21,
    lineHeight: 27,
    color: colors.ink900,
    textAlign: "center",
  },
  emptyBody: {
    fontFamily: fonts.body,
    fontSize: type.body,
    color: colors.ink500,
    textAlign: "center",
  },
  primary: {
    marginTop: spacing.md,
    backgroundColor: colors.green700,
    borderRadius: radii.pill,
    paddingVertical: 14,
    paddingHorizontal: spacing.xl,
  },
  primaryLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: type.body,
    color: colors.cream50,
  },
});
