import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ForwardRefExoticComponent, type RefAttributes } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import RNWebView, { type WebViewMessageEvent, type WebViewProps } from "react-native-webview";

import { MAP_ATTRIBUTION, MAP_TILE_URL } from "@/lib/config";
import type { LatLng, PointKind } from "@/lib/hole-geo";
import type { OsmFeature } from "@/lib/osm-course";
import { colors, fonts, spacing } from "@/lib/theme";
import { pageHtml } from "./hole-map-page";

/** See web-shell.tsx: react-native-webview 14's root types collapse to never. */
type WebViewHandle = { injectJavaScript: (script: string) => void };
const WebView = RNWebView as unknown as ForwardRefExoticComponent<WebViewProps & RefAttributes<WebViewHandle>>;

/**
 * Everything the map draws. The labels are already worked out (hole-geo.ts,
 * in the screen): the page inside the web view only draws, so there is one
 * place that decides what "152" means.
 */
export type MapScene = {
  /** Where to look when the hole has no geometry: the club's own position. */
  fallbackCentre: LatLng | null;
  /** Compass bearing tee → green; the map turns so it points up. */
  rotation: number;
  /** Points the view must contain. */
  frame: LatLng[];
  tee: LatLng | null;
  teeFront: LatLng | null;
  green: { front: LatLng | null; centre: LatLng | null; back: LatLng | null };
  /** dist: the distance to it from where you're measuring, drawn beside it. */
  hazards: Array<LatLng & { kind: PointKind; label: string; dist: string | null }>;
  /** The T can be dragged to the tee box being played (Oct 2026). */
  teeMovable: boolean;
  /** Distances start at the tee (not at you), so lines follow a dragged T. */
  originIsTee: boolean;
  me: (LatLng & { accuracyM: number | null }) | null;
  shots: Array<LatLng & { n: number; label: string | null }>;
  /** The aim circle (Oct 2026): where the member tapped or dragged it, or
   *  the default a drive out — with the lines to it and on to the green. */
  tap: (LatLng & { origin: LatLng; toLabel: string; onLabel: string | null; green: LatLng | null }) | null;
  /** No aim (the green is in reach): one line straight to the green. */
  greenLine: { origin: LatLng; label: string } | null;
  /** Which hole's OSM line to draw (the others are left off: clutter). */
  hole: number;
  /** Outlines on or off (the layers button). */
  showOutlines: boolean;
  /** Room to leave for what floats over the map, in points. */
  inset: { top: number; bottom: number };
  /** OpenStreetMap shapes near the hole: greens, fairways, bunkers, tees,
   *  water and the hole lines. Drawn under everything else. */
  outlines: OsmFeature[];
  /** Change it to move the view; leave it to keep the member's pan and zoom. */
  frameKey: string;
};

export type HoleMapHandle = { recentre: () => void };

type Props = {
  scene: MapScene;
  onTap: (at: LatLng) => void;
  /** The T was dragged here. */
  onTee: (at: LatLng) => void;
};

/**
 * The satellite view of one hole, drawn by Leaflet inside a web view.
 *
 * A web view rather than react-native-maps because the web view is already
 * in the shipped binary: this reaches TestFlight testers as an over-the-air
 * update, where a maps SDK would need a new store build. Leaflet and the
 * rotate plugin are pinned versions from jsDelivr; the tiles are whatever
 * MAP_TILE_URL says (config.ts — license before launch).
 */
export const HoleMapView = forwardRef<HoleMapHandle, Props>(function HoleMapView({ scene, onTap, onTee }, ref) {
  const web = useRef<WebViewHandle>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const html = useMemo(() => pageHtml(MAP_TILE_URL, MAP_ATTRIBUTION), []);

  useEffect(() => {
    if (ready) web.current?.injectJavaScript(`window.pp && window.pp.draw(${JSON.stringify(scene)}); true;`);
  }, [ready, scene]);

  useImperativeHandle(ref, () => ({
    recentre: () => web.current?.injectJavaScript(`window.pp && window.pp.refit(); true;`),
  }));

  const onMessage = (e: WebViewMessageEvent) => {
    let msg: { type?: string; lat?: number; lng?: number } = {};
    try {
      msg = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (msg.type === "ready") setReady(true);
    else if (msg.type === "failed") setFailed(true);
    else if (msg.type === "tap" && typeof msg.lat === "number" && typeof msg.lng === "number") onTap({ lat: msg.lat, lng: msg.lng });
    else if (msg.type === "tee" && typeof msg.lat === "number" && typeof msg.lng === "number") onTee({ lat: msg.lat, lng: msg.lng });
  };

  return (
    <View style={styles.fill}>
      <WebView
        ref={web}
        source={{ html, baseUrl: "https://pinpals.ie/" }}
        originWhitelist={["*"]}
        onMessage={onMessage}
        onError={() => setFailed(true)}
        style={styles.fill}
        containerStyle={styles.fill}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        setSupportMultipleWindows={false}
        javaScriptEnabled
        // The map is the whole screen; stop the page itself being zoomed.
        scalesPageToFit={false}
      />
      {!ready && !failed ? (
        <View style={styles.cover} pointerEvents="none">
          <ActivityIndicator color={colors.cream50} />
        </View>
      ) : null}
      {failed ? (
        <View style={styles.cover}>
          <Text style={styles.failed}>The map couldn't load. Check your signal; the yardages below still work.</Text>
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.green800 },
  cover: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: colors.green800, padding: spacing.lg },
  failed: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.cream50, textAlign: "center" },
});
