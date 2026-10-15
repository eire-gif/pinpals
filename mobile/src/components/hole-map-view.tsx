import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ForwardRefExoticComponent, type RefAttributes } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import RNWebView, { type WebViewMessageEvent, type WebViewProps } from "react-native-webview";

import { loadTileSource, nativeZoomAt, viewportQuery, type TileSource } from "@/lib/map-tiles";
import type { LatLng, PinZone, PointKind } from "@/lib/hole-geo";
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
  /** centre is the pin (moved or not); zone colours the flag. */
  green: { front: LatLng | null; centre: LatLng | null; back: LatLng | null; zone: PinZone };
  /** The flag can be dragged round the green (Oct 2026). */
  pinMovable: boolean;
  /** dist: the distance to it from where you're measuring, drawn beside it. */
  hazards: Array<LatLng & { kind: PointKind; label: string; dist: string | null }>;
  /** The T can be dragged to the tee box being played (Oct 2026). */
  teeMovable: boolean;
  /** Distances start at the tee (not at you), so lines follow a dragged T. */
  originIsTee: boolean;
  me: (LatLng & { accuracyM: number | null }) | null;
  /** Where each ball finished (Oct 2026); label = how far that shot went. */
  shots: Array<LatLng & { n: number; label: string | null }>;
  /** Where shot 1 started: the tee, or a mark made on it. */
  shotStart: LatLng | null;
  /** The aim circle (Oct 2026): where the member tapped or dragged it, or
   *  the default a drive out — with the lines to it and on to the green. */
  tap: (LatLng & { origin: LatLng; toLabel: string; onLabel: string | null; green: LatLng | null }) | null;
  /** No aim (the green is in reach): one line straight to the green. */
  greenLine: { origin: LatLng; label: string } | null;
  /** Distance arcs (Oct 2026): rings across the line of play, each labelled
   *  at its right-hand end ("150", or a club: "7i"). */
  arcs?: Array<{ points: LatLng[]; end: LatLng; label: string }>;
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
  /** The flag was dragged here. */
  onPin: (at: LatLng) => void;
};

/**
 * The satellite view of one hole, drawn by Leaflet inside a web view.
 *
 * A web view rather than react-native-maps because the web view is already
 * in the shipped binary: this reaches TestFlight testers as an over-the-air
 * update, where a maps SDK would need a new store build. Leaflet and the
 * rotate plugin are pinned versions from jsDelivr. The photo underneath is
 * Google 2D satellite or Esri, as the website says (lib/map-tiles.ts).
 * With Google, the page tells us where it's looking and we fetch Google's
 * copyright line for that view here (no CORS to worry about in the app).
 */
export const HoleMapView = forwardRef<HoleMapHandle, Props>(function HoleMapView({ scene, onTap, onTee, onPin }, ref) {
  const web = useRef<WebViewHandle>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [source, setSource] = useState<TileSource | null>(null);
  useEffect(() => {
    let on = true;
    void loadTileSource().then((t) => on && setSource(t));
    return () => {
      on = false;
    };
  }, []);
  const html = useMemo(() => (source ? pageHtml(source) : null), [source]);
  const creditAsk = useRef(0);
  const askCredit = (v: { zoom: number; north: number; south: number; east: number; west: number; lat: number; lng: number }) => {
    if (source?.provider !== "google") return;
    const n = ++creditAsk.current;
    void fetch(viewportQuery(source.viewportUrl, v))
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { copyright?: unknown; maxZoomRects?: unknown } | null) => {
        if (!d || n !== creditAsk.current) return;
        const text = typeof d.copyright === "string" ? d.copyright : "";
        const z = nativeZoomAt(d.maxZoomRects, v.lat, v.lng);
        web.current?.injectJavaScript(`window.pp && window.pp.credit(${JSON.stringify(text)}, ${z ?? "null"}); true;`);
      })
      .catch(() => {
        // The logo and "Google Maps" stay; the next view asks again.
      });
  };

  useEffect(() => {
    if (ready) web.current?.injectJavaScript(`window.pp && window.pp.draw(${JSON.stringify(scene)}); true;`);
  }, [ready, scene]);

  useImperativeHandle(ref, () => ({
    recentre: () => web.current?.injectJavaScript(`window.pp && window.pp.refit(); true;`),
  }));

  const onMessage = (e: WebViewMessageEvent) => {
    let msg: { type?: string; lat?: number; lng?: number; zoom?: number; north?: number; south?: number; east?: number; west?: number } = {};
    try {
      msg = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (msg.type === "ready") setReady(true);
    else if (msg.type === "failed") setFailed(true);
    else if (msg.type === "tap" && typeof msg.lat === "number" && typeof msg.lng === "number") onTap({ lat: msg.lat, lng: msg.lng });
    else if (msg.type === "tee" && typeof msg.lat === "number" && typeof msg.lng === "number") onTee({ lat: msg.lat, lng: msg.lng });
    else if (msg.type === "pin" && typeof msg.lat === "number" && typeof msg.lng === "number") onPin({ lat: msg.lat, lng: msg.lng });
    else if (
      msg.type === "view" &&
      [msg.zoom, msg.north, msg.south, msg.east, msg.west, msg.lat, msg.lng].every((x) => typeof x === "number" && Number.isFinite(x))
    )
      askCredit(msg as Required<typeof msg>);
  };

  return (
    <View style={styles.fill}>
      {html ? (
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
      ) : null}
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
