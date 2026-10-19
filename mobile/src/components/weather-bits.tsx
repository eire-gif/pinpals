import { useEffect, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { loadClubForecast, useMph } from "@/lib/weather";
import {
  KIND_ICON,
  KIND_LABEL,
  compass,
  conditionsLine,
  hourNow,
  rainSoon,
  rainSoonLabel,
  teeForecast,
  tempLabel,
  windLabel,
  type Forecast,
  type RoundWeather,
} from "@/lib/weather-rules";
import { colors, fonts, radii, type } from "@/lib/theme";

/**
 * Weather added to existing screens (Oct 2026). Each piece is one slim row
 * that sits in a screen's own layout and draws nothing at all when there's
 * no weather — no location for the course, the service off or unreachable.
 */

type Icon = keyof typeof Ionicons.glyphMap;

function useClubForecast(clubId: number | null, refreshMs: number | null): Forecast | null {
  const [forecast, setForecast] = useState<Forecast | null>(null);
  useEffect(() => {
    if (clubId == null) return;
    let on = true;
    const load = () =>
      void loadClubForecast(clubId)
        .then((f) => on && setForecast(f))
        .catch(() => {});
    load();
    const timer = refreshMs ? setInterval(load, refreshMs) : null;
    return () => {
      on = false;
      if (timer) clearInterval(timer);
    };
  }, [clubId, refreshMs]);
  return forecast;
}

/** Live scoring: the weather now at the course, and a warning when rain is close. */
export function LiveWeatherRow({ clubId }: { clubId: number | null }) {
  const forecast = useClubForecast(clubId, 15 * 60 * 1000);
  const mph = useMph();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60 * 1000);
    return () => clearInterval(t);
  }, []);
  if (!forecast) return null;
  const h = hourNow(forecast.hours, now);
  if (!h) return null;
  const rain = rainSoon(forecast.hours, now);
  const wind = `${windLabel(h.windKmh, h.gustKmh, mph)} from the ${compass(h.fromDeg)}`;
  return (
    <View style={styles.box}>
    <View style={styles.line} accessible accessibilityLabel={`Weather: ${tempLabel(h.tempC)}, ${KIND_LABEL[h.kind]}, wind ${wind}${rain ? `. ${rainSoonLabel(rain)}` : ""}`}>
      <Ionicons name={KIND_ICON[h.kind] as Icon} size={18} color={colors.navy800} />
      <Text style={styles.strong}>{tempLabel(h.tempC)}</Text>
      <Text style={styles.text} numberOfLines={1}>
        {`Wind ${wind}`}
      </Text>
      {rain ? (
        <View style={styles.rainTag}>
          <Ionicons name="rainy-outline" size={13} color={colors.navy900} />
          <Text style={styles.rainText} numberOfLines={1}>
            {rain.inMinutes < 10 ? "Rain now" : `Rain ~${Math.round(rain.inMinutes / 10) * 10} min`}
          </Text>
        </View>
      ) : null}
    </View>
    <Credit forecast={forecast} />
    </View>
  );
}

/** An upcoming round: the forecast from its tee time, or when it will show. */
export function ForecastRow({ clubId, playDate, tee }: { clubId: number | null; playDate: string; tee: string | null }) {
  const forecast = useClubForecast(clubId, null);
  const mph = useMph();
  if (!forecast) return null;
  const f = teeForecast(forecast.hours, playDate, tee);
  if (!f) return null;
  if (f.state === "later") {
    const label = new Date(`${f.from}T12:00:00Z`).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" });
    return (
      <View style={[styles.box, styles.line]}>
        <Ionicons name="partly-sunny-outline" size={16} color={colors.ink500} />
        <Text style={styles.text}>{`Forecast from ${label}`}</Text>
      </View>
    );
  }
  const rain = f.rainPct != null ? ` · ${Math.round(f.rainPct / 10) * 10}% rain` : "";
  return (
    <View style={styles.box}>
    <View
      style={styles.line}
      accessible
      accessibilityLabel={`Forecast: ${tempLabel(f.tempC)}, ${KIND_LABEL[f.kind]}, wind ${windLabel(f.windKmh, f.gustKmh, mph)} from the ${compass(f.fromDeg)}${rain}`}
    >
      <Ionicons name={KIND_ICON[f.kind] as Icon} size={18} color={colors.navy800} />
      <Text style={styles.strong}>{tempLabel(f.tempC)}</Text>
      <Text style={styles.text} numberOfLines={1}>
        {`${KIND_LABEL[f.kind]} · wind ${windLabel(f.windKmh, f.gustKmh, mph)}${rain}`}
      </Text>
    </View>
    <Credit forecast={forecast} />
    </View>
  );
}

/** The weather service's name, linked, as its terms ask wherever its data shows. */
function Credit({ forecast }: { forecast: Forecast }) {
  return (
    <Pressable onPress={() => void Linking.openURL(forecast.creditUrl)} accessibilityRole="link" hitSlop={6}>
      <Text style={styles.credit}>{`Weather: ${forecast.credit.replace(/^Weather data by /, "")}`}</Text>
    </Pressable>
  );
}

/** A scorecard: what the round was played in. */
export function ConditionsRow({ weather }: { weather: RoundWeather | null }) {
  const mph = useMph();
  if (!weather) return null;
  return (
    <View style={styles.conditions} accessible accessibilityLabel={`Played in: ${conditionsLine(weather, mph)}`}>
      <Ionicons name={KIND_ICON[weather.kind] as Icon} size={18} color={colors.navy800} />
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={styles.kicker}>PLAYED IN</Text>
        <Text style={styles.text}>{conditionsLine(weather, mph)}</Text>
        <Text style={styles.credit}>{`Weather: ${weather.credit.replace(/^Weather data by /, "")}`}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 2, paddingVertical: 8, paddingHorizontal: 12, borderRadius: radii.md, backgroundColor: colors.surfaceTint, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  line: { flexDirection: "row", alignItems: "center", gap: 8 },
  strong: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.navy900 },
  text: { flex: 1, fontFamily: fonts.body, fontSize: type.small, color: colors.ink900 },
  rainTag: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radii.pill, backgroundColor: colors.gold400 },
  rainText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.navy900 },
  conditions: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 12, borderRadius: radii.md, backgroundColor: colors.surfaceTint, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  kicker: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 1.1, color: colors.ink500 },
  credit: { fontFamily: fonts.body, fontSize: 11, color: colors.ink500 },
});
