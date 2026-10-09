import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ForwardRefExoticComponent, type RefAttributes } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import RNWebView, { type WebViewMessageEvent, type WebViewProps } from "react-native-webview";

import { MAP_ATTRIBUTION, MAP_TILE_URL } from "@/lib/config";
import type { LatLng, PointKind } from "@/lib/hole-geo";
import type { OsmFeature } from "@/lib/osm-course";
import { colors, fonts, spacing } from "@/lib/theme";

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
  hazards: Array<LatLng & { kind: PointKind; label: string }>;
  me: (LatLng & { accuracyM: number | null }) | null;
  shots: Array<LatLng & { n: number; label: string | null }>;
  /** A point the member tapped, the lines to it and on to the green. */
  tap: (LatLng & { origin: LatLng; toLabel: string; onLabel: string | null; green: LatLng | null }) | null;
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
export const HoleMapView = forwardRef<HoleMapHandle, Props>(function HoleMapView({ scene, onTap }, ref) {
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

/**
 * The page. Plain JS, no build step. It never decides a number: it draws
 * what `draw(scene)` hands it and posts taps back.
 */
function pageHtml(tileUrl: string, attribution: string): string {
  return `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css">
<style>
  html,body,#map{margin:0;height:100%;width:100%;background:${colors.green800};}
  .leaflet-container{font-family:-apple-system,system-ui,sans-serif;}
  .leaflet-control-attribution{font-size:9px;background:rgba(12,32,56,.55)!important;color:#efe7d6!important;}
  .leaflet-control-attribution a{color:#efe7d6!important;}
  .pin{display:flex;align-items:center;justify-content:center;border-radius:999px;font-weight:700;box-shadow:0 1px 4px rgba(0,0,0,.45);}
  .tee{width:22px;height:22px;background:${colors.cream50};color:${colors.navy900};font-size:11px;border:2px solid ${colors.navy900};}
  .flag{width:26px;height:26px;background:${colors.gold400};color:${colors.navy900};font-size:14px;border:2px solid ${colors.cream50};}
  .edge{width:8px;height:8px;background:${colors.cream50};border:1.5px solid ${colors.navy900};}
  .shot{width:20px;height:20px;background:${colors.navy900};color:${colors.cream50};font-size:11px;border:2px solid ${colors.cream50};}
  .tap{width:18px;height:18px;border:2px solid ${colors.cream50};background:rgba(255,255,255,.18);}
  .label{white-space:nowrap;padding:2px 7px;border-radius:999px;background:rgba(12,32,56,.82);color:${colors.cream50};font-size:12px;font-weight:700;transform:translate(-50%,-50%);display:inline-block;}
  .label.gold{background:${colors.gold400};color:${colors.navy900};}
  .hz{width:10px;height:10px;border:1.5px solid rgba(0,0,0,.5);}
  .hz.green_bunker,.hz.fairway_bunker{background:#e9d9a6;}
  .hz.water{background:#4aa3df;}
  .hz.trees{background:#2f6b3a;}
  .hz.marker_100{background:#ffffff;} .hz.marker_150{background:#ffd23f;} .hz.marker_200{background:#e2483d;}
  .hz.dogleg,.hz.other{background:#c9c3b6;}
</style></head><body><div id="map"></div>
<script src="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://cdn.jsdelivr.net/npm/leaflet-rotate@0.2.8/dist/leaflet-rotate.js"></script>
<script>
(function(){
  function post(m){ try{ window.ReactNativeWebView.postMessage(JSON.stringify(m)); }catch(e){} }
  if(!window.L){ post({type:"failed"}); return; }
  var canRotate = typeof L.Map.prototype.setBearing === "function";
  var map = L.map("map", { zoomControl:false, attributionControl:true, rotate:canRotate, touchRotate:false, rotateControl:false, bearing:0, maxZoom:20, zoomSnap:0.25 });
  L.tileLayer(${JSON.stringify(tileUrl)}, { maxZoom:20, maxNativeZoom:19, attribution:${JSON.stringify(attribution)} }).addTo(map);
  map.setView([53.4, -7.9], 7);
  var shapes = L.layerGroup().addTo(map);
  var layer = L.layerGroup().addTo(map);
  var osmCredited = false;
  var STYLE = {
    fairway: { color: "#9fd36f", weight: 1, fillColor: "#7cc456", fillOpacity: 0.28, opacity: 0.6 },
    tee: { color: "#d7f0b8", weight: 1, fillColor: "#b8e08e", fillOpacity: 0.35, opacity: 0.7 },
    green: { color: "#e9ffd9", weight: 1.5, fillColor: "#5fd068", fillOpacity: 0.45, opacity: 0.9 },
    bunker: { color: "#fff6d6", weight: 1, fillColor: "#f1e2aa", fillOpacity: 0.75, opacity: 0.9 },
    water: { color: "#9fd2f5", weight: 1, fillColor: "#3b8fd0", fillOpacity: 0.45, opacity: 0.8 }
  };
  var shapesKey = null;
  var last = null, lastKey = null;

  function icon(cls, text, size){ return L.divIcon({ className:"", html:'<div class="pin '+cls+'">'+(text||"")+'</div>', iconSize:[size,size], iconAnchor:[size/2,size/2] }); }
  function label(at, text, gold){ return L.marker([at.lat,at.lng], { interactive:false, icon:L.divIcon({ className:"", html:'<span class="label'+(gold?' gold':'')+'">'+text+'</span>', iconSize:[0,0] }) }); }
  function mid(a,b){ return { lat:(a.lat+b.lat)/2, lng:(a.lng+b.lng)/2 }; }
  function esc(s){ return String(s).replace(/[&<>"]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); }

  // Turn the map so tee → green points up, then check it did: leaflet-rotate
  // turns the panes clockwise, so the bearing to set is the negative, and a
  // future version flipping that would otherwise draw every hole upside down.
  function orient(s){
    if(!canRotate) return;
    var want = (360 - (s.rotation||0)) % 360;
    map.setBearing(want);
    if(s.tee && s.green && s.green.centre){
      var t = map.latLngToContainerPoint([s.tee.lat,s.tee.lng]);
      var g = map.latLngToContainerPoint([s.green.centre.lat,s.green.centre.lng]);
      if(g.y > t.y) map.setBearing(s.rotation||0);
    }
  }

  function refit(){
    if(!last) return;
    var s = last;
    if(canRotate) map.setBearing(0);
    if(s.frame && s.frame.length >= 2){
      map.fitBounds(L.latLngBounds(s.frame.map(function(p){ return [p.lat,p.lng]; })), { padding:[36,36], maxZoom:19 });
      orient(s);
    } else if(s.frame && s.frame.length === 1){
      map.setView([s.frame[0].lat, s.frame[0].lng], 17);
    } else if(s.fallbackCentre){
      map.setView([s.fallbackCentre.lat, s.fallbackCentre.lng], 16);
    }
  }

  function drawShapes(list){
    var key = (list||[]).length + ":" + ((list||[])[0] ? list[0].coords[0].lat : "");
    if(key === shapesKey) return;
    shapesKey = key;
    shapes.clearLayers();
    (list||[]).forEach(function(f){
      var ll = f.coords.map(function(p){ return [p.lat,p.lng]; });
      if(f.kind === "hole"){
        L.polyline(ll, { color:"#ffffff", weight:1.5, opacity:0.55, dashArray:"2 6", interactive:false }).addTo(shapes);
      } else if(STYLE[f.kind] && ll.length >= 3){
        var st = STYLE[f.kind]; st.interactive = false;
        L.polygon(ll, st).addTo(shapes);
      }
    });
    if((list||[]).length && !osmCredited){ osmCredited = true; map.attributionControl.addAttribution("© OpenStreetMap contributors"); }
  }

  function draw(s){
    last = s;
    drawShapes(s.outlines);
    layer.clearLayers();
    var g = s.green || {};
    if(s.tap){
      var t = s.tap;
      L.polyline([[t.origin.lat,t.origin.lng],[t.lat,t.lng]], { color:"${colors.cream50}", weight:2, dashArray:"5 6", interactive:false }).addTo(layer);
      label(mid(t.origin,t), esc(t.toLabel)).addTo(layer);
      if(t.green){
        L.polyline([[t.lat,t.lng],[t.green.lat,t.green.lng]], { color:"${colors.gold400}", weight:2, dashArray:"5 6", interactive:false }).addTo(layer);
        if(t.onLabel) label(mid(t,t.green), esc(t.onLabel), true).addTo(layer);
      }
      L.marker([t.lat,t.lng], { interactive:false, icon:icon("tap","",18) }).addTo(layer);
    }
    (s.hazards||[]).forEach(function(h){
      var m = L.marker([h.lat,h.lng], { interactive:false, icon:icon("hz "+h.kind,"",10) }).addTo(layer);
      if(h.label) m.bindTooltip(esc(h.label), { direction:"right", offset:[6,0], permanent:false });
    });
    if(s.shots && s.shots.length){
      L.polyline(s.shots.map(function(p){ return [p.lat,p.lng]; }), { color:"${colors.navy900}", weight:3, opacity:.85, interactive:false }).addTo(layer);
      s.shots.forEach(function(p,i){
        var next = s.shots[i+1];
        if(next && p.label) label(mid(p,next), esc(p.label)).addTo(layer);
        L.marker([p.lat,p.lng], { interactive:false, icon:icon("shot", p.n, 20) }).addTo(layer);
      });
    }
    if(s.teeFront) L.marker([s.teeFront.lat,s.teeFront.lng], { interactive:false, icon:icon("tee","F",22) }).addTo(layer);
    if(s.tee) L.marker([s.tee.lat,s.tee.lng], { interactive:false, icon:icon("tee","T",22) }).addTo(layer);
    if(g.front) L.marker([g.front.lat,g.front.lng], { interactive:false, icon:icon("edge","",8) }).addTo(layer);
    if(g.back) L.marker([g.back.lat,g.back.lng], { interactive:false, icon:icon("edge","",8) }).addTo(layer);
    if(g.centre) L.marker([g.centre.lat,g.centre.lng], { interactive:false, icon:icon("flag","⚑",26) }).addTo(layer);
    if(s.me){
      if(s.me.accuracyM) L.circle([s.me.lat,s.me.lng], { radius:s.me.accuracyM, color:"#4aa3df", weight:1, fillOpacity:.12, interactive:false }).addTo(layer);
      L.circleMarker([s.me.lat,s.me.lng], { radius:7, color:"#ffffff", weight:2.5, fillColor:"#1d8cf8", fillOpacity:1, interactive:false }).addTo(layer);
    }
    if(s.frameKey !== lastKey){ lastKey = s.frameKey; refit(); }
  }

  map.on("click", function(e){ post({ type:"tap", lat:e.latlng.lat, lng:e.latlng.lng }); });
  window.pp = { draw:draw, refit:refit };
  post({ type:"ready" });
})();
</script></body></html>`;
}
