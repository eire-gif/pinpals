import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ForwardRefExoticComponent, type RefAttributes } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import RNWebView, { type WebViewMessageEvent, type WebViewProps } from "react-native-webview";

import { MAP_ATTRIBUTION, MAP_TILE_URL } from "@/lib/config";
import { loadTileSource, type TileSource } from "@/lib/map-tiles";
import { VIEW_BOUNDS, type MapPin, type MapView } from "@/lib/passport-rules";
import { colors } from "@/lib/theme";

/**
 * The Course Passport's satellite map (claude/course-passport.md).
 *
 * A web page in a WebView, like the hole maps (no native module, so it ships
 * with `eas update`). Imagery: Apple's satellite map with place names
 * (MapKit JS, "hybrid") when the website hands out an Apple token — the
 * same switch as the hole maps (/api/app/map-tiles) — otherwise Esri's
 * satellite photos with Esri's place-name layer on top. (Google's tiles
 * need a live copyright line per view; the hole maps do that dance, a
 * whole-world passport doesn't need it, so it uses Esri instead.)
 *
 * Pins: a gold star per course played, the newest white with a gold ring,
 * bucket-list courses white and dashed. Close pins group into a navy
 * circle with a count; tapping it zooms in. Tapping a pin posts its id back
 * and the screen shows the course underneath.
 */
type WebViewHandle = { injectJavaScript: (script: string) => void };
const WebView = RNWebView as unknown as ForwardRefExoticComponent<WebViewProps & RefAttributes<WebViewHandle>>;

export type PassportMapHandle = { show: (view: MapView) => void };

type Props = { pins: MapPin[]; view: MapView; onSelect: (id: number | null) => void; height?: number };

export const PassportMap = forwardRef<PassportMapHandle, Props>(function PassportMap({ pins, view, onSelect, height }, ref) {
  const [source, setSource] = useState<TileSource | null>(null);
  const web = useRef<WebViewHandle | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let on = true;
    loadTileSource().then((s) => on && setSource(s));
    return () => {
      on = false;
    };
  }, []);

  const html = useMemo(() => (source ? passportHtml(source) : null), [source]);

  useEffect(() => {
    if (ready) web.current?.injectJavaScript(`window.pp && window.pp.pins(${JSON.stringify(pins)}); true;`);
  }, [ready, pins]);

  useImperativeHandle(ref, () => ({
    show: (v: MapView) => web.current?.injectJavaScript(`window.pp && window.pp.view(${JSON.stringify(VIEW_BOUNDS[v])}); true;`),
  }));

  const onMessage = (e: WebViewMessageEvent) => {
    let m: { type?: string; id?: unknown } = {};
    try {
      m = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (m.type === "ready") {
      setReady(true);
      web.current?.injectJavaScript(`window.pp && window.pp.pins(${JSON.stringify(pins)}); window.pp.view(${JSON.stringify(VIEW_BOUNDS[view])}, true); true;`);
    } else if (m.type === "select") {
      onSelect(typeof m.id === "number" ? m.id : null);
    }
  };

  return (
    <View style={[styles.box, height != null ? { height } : { flex: 1 }]} accessibilityRole="image" accessibilityLabel={`Satellite map with ${pins.length} courses marked`}>
      {html ? (
        <WebView
          ref={web}
          source={{ html, baseUrl: "https://pinpals.ie/" }}
          originWhitelist={["*"]}
          onMessage={onMessage}
          style={styles.web}
          scrollEnabled={false}
          bounces={false}
          javaScriptEnabled
          setSupportMultipleWindows={false}
        />
      ) : null}
      {!ready ? <ActivityIndicator color={colors.gold400} style={StyleSheet.absoluteFill} /> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  box: { backgroundColor: "#0b2232", overflow: "hidden" },
  web: { flex: 1, backgroundColor: "#0b2232" },
});

/** Esri's place names, drawn over its satellite photos. */
const ESRI_LABELS = "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";

function passportHtml(source: TileSource): string {
  const apple = source.provider === "apple";
  const token = apple ? source.token : "";
  const esriUrl = source.provider === "google" ? MAP_TILE_URL : source.url;
  const credit = source.provider === "google" ? MAP_ATTRIBUTION : source.attribution;
  return `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css" integrity="sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H" crossorigin="anonymous">
<style>
  html,body,#map,#mk{margin:0;padding:0;width:100%;height:100%;background:#0b2232;}
  #map,#mk{position:absolute;left:0;top:0;}
  .pin{width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.6);font:700 16px -apple-system,system-ui,sans-serif;}
  .pin.played{background:#e8c46b;border:2.5px solid #fff;color:#0c2038;}
  .pin.newest{width:36px;height:36px;background:#fff;border:3px solid #e8c46b;color:#0c2038;box-shadow:0 0 0 7px rgba(232,196,107,.45),0 2px 8px rgba(0,0,0,.6);}
  .pin.bucket{width:26px;height:26px;background:#fff;border:2px dashed #8a6a24;color:#8a6a24;font-size:13px;}
  .grp{width:44px;height:44px;border-radius:50%;background:#0c2038;border:3px solid #e8c46b;color:#f7f3ea;display:flex;align-items:center;justify-content:center;font:800 17px -apple-system,system-ui,sans-serif;box-shadow:0 3px 8px rgba(0,0,0,.5);}
  .leaflet-container{font-family:-apple-system,system-ui,sans-serif;background:#0b2232;}
</style></head><body><div id="mk"></div><div id="map"></div>
<script src="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js" integrity="sha384-cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH" crossorigin="anonymous"></script>
<script>
(function(){
  function post(m){ try{ window.ReactNativeWebView.postMessage(JSON.stringify(m)); }catch(e){} }
  var APPLE = ${JSON.stringify(apple)};
  var STAR = "\\u2605";
  var pins = [], mk = null, lmap = null, layer = null, started = false, pending = null;

  // ---- Leaflet with Esri (also the fallback when Apple can't start) ----
  function startLeaflet(){
    if(started) return; started = true;
    document.getElementById("mk").style.display = "none";
    if(!window.L){ post({type:"failed"}); return; }
    lmap = L.map("map", { zoomControl:false, attributionControl:true, worldCopyJump:true, minZoom:2, maxZoom:17 });
    L.tileLayer(${JSON.stringify(esriUrl)}, { maxZoom:19, maxNativeZoom:17 }).addTo(lmap);
    L.tileLayer(${JSON.stringify(ESRI_LABELS)}, { maxZoom:19, maxNativeZoom:13, opacity:0.95 }).addTo(lmap);
    lmap.attributionControl.setPrefix(false);
    lmap.attributionControl.addAttribution(${JSON.stringify(credit)});
    layer = L.layerGroup().addTo(lmap);
    lmap.on("zoomend moveend", drawLeaflet);
    lmap.on("click", function(){ post({type:"select", id:null}); });
    lmap.fitBounds([[51.35,-10.7],[55.45,-5.35]]);
    post({type:"ready"});
    if(pending){ var p = pending; pending = null; window.pp.view(p, true); }
  }
  function drawLeaflet(){
    if(!lmap || !layer) return;
    layer.clearLayers();
    // Group pins closer than 46px on screen.
    var groups = [];
    pins.forEach(function(p){
      var pt = lmap.latLngToLayerPoint([p.lat, p.lng]);
      var g = null;
      for(var i = 0; i < groups.length; i++){ if(Math.abs(groups[i].x - pt.x) < 46 && Math.abs(groups[i].y - pt.y) < 46){ g = groups[i]; break; } }
      if(g){ g.items.push(p); } else { groups.push({ x:pt.x, y:pt.y, items:[p] }); }
    });
    groups.forEach(function(g){
      if(g.items.length === 1){
        var p = g.items[0];
        var size = p.kind === "newest" ? 36 : p.kind === "bucket" ? 26 : 30;
        var m = L.marker([p.lat, p.lng], { icon: L.divIcon({ className:"", html:'<div class="pin '+p.kind+'">'+STAR+'</div>', iconSize:[size,size], iconAnchor:[size/2,size/2] }), zIndexOffset: p.kind === "newest" ? 1000 : p.kind === "bucket" ? 0 : 500 });
        m.on("click", function(e){ L.DomEvent.stopPropagation(e); post({type:"select", id:p.id}); });
        m.addTo(layer);
      } else {
        var lat = 0, lng = 0;
        g.items.forEach(function(p){ lat += p.lat; lng += p.lng; });
        var c = L.marker([lat/g.items.length, lng/g.items.length], { icon: L.divIcon({ className:"", html:'<div class="grp">'+g.items.length+'</div>', iconSize:[44,44], iconAnchor:[22,22] }), zIndexOffset:2000 });
        c.on("click", function(e){
          L.DomEvent.stopPropagation(e);
          var b = L.latLngBounds(g.items.map(function(p){ return [p.lat, p.lng]; }));
          lmap.fitBounds(b.pad(0.4), { maxZoom: Math.min(lmap.getZoom() + 4, 15) });
        });
        c.addTo(layer);
      }
    });
  }

  // ---- Apple's map (MapKit JS), satellite with place names ----
  function colourOf(kind){ return kind === "bucket" ? "#ffffff" : kind === "newest" ? "#ffffff" : "#e8c46b"; }
  function drawApple(){
    if(!mk) return;
    mk.removeAnnotations(mk.annotations);
    mk.addAnnotations(pins.map(function(p){
      var a = new mapkit.MarkerAnnotation(new mapkit.Coordinate(p.lat, p.lng), {
        color: colourOf(p.kind), glyphText: STAR, glyphColor: p.kind === "bucket" ? "#8a6a24" : "#0c2038",
        title: p.title, subtitle: p.sub, calloutEnabled:false,
        clusteringIdentifier: p.kind === "bucket" ? "bucket" : "played",
        displayPriority: p.kind === "newest" ? 1000 : p.kind === "played" ? 750 : 250
      });
      a.ppId = p.id;
      return a;
    }));
  }
  function startApple(){
    var timer = setTimeout(function(){ startLeaflet(); }, 8000);
    window.ppMapKit = function(){
      if(started) return;
      try{
        mapkit.init({ authorizationCallback:function(done){ done(${JSON.stringify(token)}); }, language:"en-GB" });
        mapkit.addEventListener("error", function(){ if(!mk){ clearTimeout(timer); startLeaflet(); } });
        var V = mapkit.FeatureVisibility || {};
        mk = new mapkit.Map("mk", {
          mapType: mapkit.Map.MapTypes.Hybrid,
          showsCompass: V.Hidden, showsScale: V.Hidden, showsZoomControl:false, showsMapTypeControl:false,
          showsUserLocationControl:false, showsPointsOfInterest:false, isRotationEnabled:false
        });
        mk.annotationForCluster = function(cluster){
          return new mapkit.MarkerAnnotation(cluster.coordinate, { color:"#0c2038", glyphText:String(cluster.memberAnnotations.length), glyphColor:"#e8c46b", calloutEnabled:false });
        };
        mk.addEventListener("select", function(e){
          var a = e.annotation;
          if(a && a.memberAnnotations && a.memberAnnotations.length){
            mk.deselectAnnotation && mk.deselectAnnotation(a);
            mk.showItems(a.memberAnnotations, { animate:true, padding:new mapkit.Padding(60,60,60,60) });
            return;
          }
          post({type:"select", id: a && typeof a.ppId === "number" ? a.ppId : null});
        });
        mk.addEventListener("deselect", function(){ post({type:"select", id:null}); });
        started = true;
        document.getElementById("map").style.display = "none";
        clearTimeout(timer);
        drawApple();
        post({type:"ready"});
        if(pending){ var p = pending; pending = null; window.pp.view(p, true); }
      }catch(err){ clearTimeout(timer); startLeaflet(); }
    };
    var sc = document.createElement("script");
    sc.src = "https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.core.js";
    sc.crossOrigin = "anonymous";
    sc.async = true;
    sc.setAttribute("data-libraries", "map,annotations");
    sc.setAttribute("data-callback", "ppMapKit");
    sc.onerror = function(){ clearTimeout(timer); startLeaflet(); };
    document.head.appendChild(sc);
  }

  window.pp = {
    pins: function(list){ pins = Array.isArray(list) ? list : []; if(mk) drawApple(); else drawLeaflet(); },
    view: function(b, instant){
      if(!started){ pending = b; return; }
      if(mk){
        var c = new mapkit.Coordinate((b[0]+b[2])/2, (b[1]+b[3])/2);
        var r = new mapkit.CoordinateRegion(c, new mapkit.CoordinateSpan(Math.abs(b[2]-b[0]), Math.abs(b[3]-b[1])));
        mk.setRegionAnimated(r, !instant);
      } else if(lmap){
        lmap.fitBounds([[b[0], b[1]],[b[2], b[3]]], { animate: !instant });
      }
    }
  };
  if(APPLE) startApple(); else startLeaflet();
})();
</script></body></html>`;
}
