import { colors } from "@/lib/theme";

/**
 * The page. Plain JS, no build step. It never decides a number: it draws
 * what `draw(scene)` hands it and posts taps back.
 */
export function pageHtml(tileUrl: string, attribution: string): string {
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
  .aim{width:34px;height:34px;border:3px solid #ffffff;background:rgba(255,255,255,.12);box-shadow:0 0 0 1px rgba(0,0,0,.25),0 2px 6px rgba(0,0,0,.35);}
  .aim:after{content:"";width:4px;height:4px;border-radius:2px;background:#fff;}
  .label{white-space:nowrap;padding:3px 9px;border-radius:999px;background:rgba(12,32,56,.85);color:${colors.cream50};font-size:13px;font-weight:700;transform:translate(-50%,-50%);display:inline-block;}
  .label.gold{background:${colors.gold400};color:${colors.navy900};}
  .label.big{font-size:18px;padding:5px 12px;box-shadow:0 2px 6px rgba(0,0,0,.35);}
  .teemove{width:52px;height:52px;filter:drop-shadow(0 1px 3px rgba(0,0,0,.5));}
  .hzw{position:relative;width:10px;height:10px;}
  .hzd{position:absolute;left:12px;top:-4px;white-space:nowrap;font-size:10.5px;font-weight:700;color:#fff;text-shadow:0 0 2px rgba(0,0,0,.95),0 0 4px rgba(0,0,0,.8);}
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
  // Quiet on purpose (Oct 2026): the photo is the map; the outlines only
  // sharpen the edges of what's already there.
  var STYLE = {
    fairway: { color: "#c9f0a4", weight: 0.8, fillColor: "#7cc456", fillOpacity: 0.08, opacity: 0.35 },
    tee: { color: "#e6f7cf", weight: 0.8, fillColor: "#b8e08e", fillOpacity: 0.12, opacity: 0.45 },
    green: { color: "#f2ffe8", weight: 1.2, fillColor: "#5fd068", fillOpacity: 0.18, opacity: 0.75 },
    bunker: { color: "#fff6d6", weight: 0.8, fillColor: "#f1e2aa", fillOpacity: 0.35, opacity: 0.6 },
    water: { color: "#bfe3fb", weight: 0.8, fillColor: "#3b8fd0", fillOpacity: 0.15, opacity: 0.5 }
  };
  var shapesKey = null;
  var last = null, lastKey = null;

  function icon(cls, text, size){ return L.divIcon({ className:"", html:'<div class="pin '+cls+'">'+(text||"")+'</div>', iconSize:[size,size], iconAnchor:[size/2,size/2] }); }
  // The movable tee: a golf tee on a white disc with four small arrows round
  // it, so it reads as "drag me" (Oct 2026). 52 px: easy to get a thumb on.
  function teeMoveIcon(){
    var a = function(r){ return '<path transform="rotate('+r+' 26 26)" d="M26 2.5l5 5.5h-10z" fill="#ffffff" stroke="rgba(12,32,56,.55)" stroke-width="1"/>'; };
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="52" height="52" viewBox="0 0 52 52">'
      + a(0) + a(90) + a(180) + a(270)
      + '<circle cx="26" cy="26" r="14" fill="${colors.cream50}" stroke="${colors.navy900}" stroke-width="2.5"/>'
      // a golf tee: cup on top, tapering peg
      + '<path d="M19.5 19.5h13a1 1 0 0 1 .8 1.6c-1.4 1.8-3.6 2.9-5.3 3.2v8.4l-2 3.6-2-3.6v-8.4c-1.7-.3-3.9-1.4-5.3-3.2a1 1 0 0 1 .8-1.6z" fill="${colors.navy900}"/>'
      + '</svg>';
    return L.divIcon({ className:"", html:'<div class="teemove">'+svg+'</div>', iconSize:[52,52], iconAnchor:[26,26] });
  }

  function label(at, text, gold, big){ return L.marker([at.lat,at.lng], { interactive:false, icon:L.divIcon({ className:"", html:'<span class="label'+(gold?' gold':'')+(big?' big':'')+'">'+text+'</span>', iconSize:[0,0] }) }); }
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
      var ins = s.inset || { top:36, bottom:36 };
      map.fitBounds(L.latLngBounds(s.frame.map(function(p){ return [p.lat,p.lng]; })), { paddingTopLeft:[40, ins.top], paddingBottomRight:[40, ins.bottom], maxZoom:19, animate:false });
      orient(s);
      fitTurned(s.frame, ins);
    } else if(s.frame && s.frame.length === 1){
      map.setView([s.frame[0].lat, s.frame[0].lng], 17);
    } else if(s.fallbackCentre){
      map.setView([s.fallbackCentre.lat, s.fallbackCentre.lng], 16);
    }
  }

  // fitBounds fits the hole before the map turns; once turned, a diagonal
  // hole can run under the title or the sheet (the green hid behind the
  // course name). Zoom out until the turned hole sits inside the clear
  // area, in as close as it still fits, and centre it there.
  function fitTurned(frame, ins){
    var size = map.getSize();
    // 24 px more each way: the frame is marker centres, and the T and flag are ~30 px across.
    var box = { l:40, t:ins.top+24, r:size.x-40, b:size.y-ins.bottom-24 };
    if(box.r - box.l < 50 || box.b - box.t < 50) return;
    function measure(){
      var xs = [], ys = [];
      frame.forEach(function(p){ var c = map.latLngToContainerPoint([p.lat,p.lng]); xs.push(c.x); ys.push(c.y); });
      return { l:Math.min.apply(null,xs), r:Math.max.apply(null,xs), t:Math.min.apply(null,ys), b:Math.max.apply(null,ys) };
    }
    function fits(m){ return (m.r-m.l) <= (box.r-box.l) && (m.b-m.t) <= (box.b-box.t); }
    var i = 0;
    while(!fits(measure()) && i++ < 16) map.setZoom(map.getZoom()-0.25, { animate:false });
    i = 0;
    while(map.getZoom() < 19 && i++ < 16){
      map.setZoom(map.getZoom()+0.25, { animate:false });
      if(!fits(measure())){ map.setZoom(map.getZoom()-0.25, { animate:false }); break; }
    }
    var m = measure();
    var dx = (m.l+m.r)/2 - (box.l+box.r)/2, dy = (m.t+m.b)/2 - (box.t+box.b)/2;
    var c = map.latLngToContainerPoint(map.getCenter());
    map.setView(map.containerPointToLatLng([c.x+dx, c.y+dy]), map.getZoom(), { animate:false });
  }

  function drawShapes(list, hole, on){
    if(!on) list = [];
    var key = (list||[]).length + ":" + ((list||[])[0] ? list[0].coords[0].lat : "") + ":" + hole;
    if(key === shapesKey) return;
    shapesKey = key;
    shapes.clearLayers();
    (list||[]).forEach(function(f){
      var ll = f.coords.map(function(p){ return [p.lat,p.lng]; });
      if(f.kind === "hole"){
        if(f.ref === hole) L.polyline(ll, { color:"#ffffff", weight:1.5, opacity:0.4, dashArray:"2 7", interactive:false }).addTo(shapes);
      } else if(STYLE[f.kind] && ll.length >= 3){
        var st = STYLE[f.kind]; st.interactive = false;
        L.polygon(ll, st).addTo(shapes);
      }
    });
    if((list||[]).length && !osmCredited){ osmCredited = true; map.attributionControl.addAttribution("© OpenStreetMap contributors"); }
  }

  var dragging = false, pending = null;

  function draw(s){
    // A GPS tick mid-drag would pull the circle from under the finger.
    if(dragging){ pending = s; return; }
    last = s;
    drawShapes(s.outlines, s.hole, s.showOutlines !== false);
    layer.clearLayers();
    var g = s.green || {};
    var greenLine = null, greenLabel = null, toLine = null, toLabel = null;
    if(s.greenLine && g.centre){
      var o = s.greenLine.origin;
      greenLine = L.polyline([[o.lat,o.lng],[g.centre.lat,g.centre.lng]], { color:"#ffffff", weight:2.5, opacity:.95, interactive:false }).addTo(layer);
      greenLabel = label(mid(o,g.centre), esc(s.greenLine.label), true, true).addTo(layer);
    }
    if(s.tap){
      var t = s.tap;
      toLine = L.polyline([[t.origin.lat,t.origin.lng],[t.lat,t.lng]], { color:"#ffffff", weight:2.5, opacity:.95, interactive:false }).addTo(layer);
      toLabel = label(mid(t.origin,t), esc(t.toLabel)).addTo(layer);
      var onLine = null, onLabel = null;
      if(t.green){
        onLine = L.polyline([[t.lat,t.lng],[t.green.lat,t.green.lng]], { color:"#ffffff", weight:2.5, opacity:.95, interactive:false }).addTo(layer);
        if(t.onLabel) onLabel = label(mid(t,t.green), esc(t.onLabel), true, true).addTo(layer);
      }
      // Drag the circle: the lines follow, the numbers come back from the
      // app on release (it does the sums, as for everything else here).
      var aim = L.marker([t.lat,t.lng], { draggable:true, autoPan:false, icon:icon("aim","",38) }).addTo(layer);
      aim.on("dragstart", function(){ dragging = true; if(toLabel) layer.removeLayer(toLabel); if(onLabel) layer.removeLayer(onLabel); });
      aim.on("drag", function(e){
        var p = e.target.getLatLng();
        toLine.setLatLngs([[t.origin.lat,t.origin.lng],[p.lat,p.lng]]);
        if(onLine) onLine.setLatLngs([[p.lat,p.lng],[t.green.lat,t.green.lng]]);
      });
      aim.on("dragend", function(e){
        var p = e.target.getLatLng();
        dragging = false;
        // The app answers with a fresh scene (new aim, latest GPS); drawing
        // the held one first would flick the circle back to where it was.
        pending = null;
        post({ type:"tap", lat:p.lat, lng:p.lng });
      });
    }
    (s.hazards||[]).forEach(function(h){
      // The distance to it, small, beside it (Oct 2026) — readable zoomed in.
      var html = '<div class="hzw"><div class="pin hz '+h.kind+'" style="width:10px;height:10px;box-sizing:border-box"></div>'+(h.dist ? '<span class="hzd">'+esc(h.dist)+'</span>' : '')+'</div>';
      L.marker([h.lat,h.lng], { interactive:false, icon:L.divIcon({ className:"", html:html, iconSize:[10,10], iconAnchor:[5,5] }) }).addTo(layer);
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
    if(s.tee && s.teeMovable){
      // Drag the T to the tee box you're playing from (Oct 2026): lines that
      // start at the tee follow it; the numbers come back from the app.
      var tee = L.marker([s.tee.lat,s.tee.lng], { draggable:true, autoPan:false, icon:teeMoveIcon() }).addTo(layer);
      tee.on("dragstart", function(){ dragging = true; if(s.originIsTee){ if(toLabel) layer.removeLayer(toLabel); if(greenLabel) layer.removeLayer(greenLabel); } });
      tee.on("drag", function(e){
        if(!s.originIsTee) return;
        var p = e.target.getLatLng();
        if(toLine && s.tap) toLine.setLatLngs([[p.lat,p.lng],[s.tap.lat,s.tap.lng]]);
        if(greenLine && g.centre) greenLine.setLatLngs([[p.lat,p.lng],[g.centre.lat,g.centre.lng]]);
      });
      tee.on("dragend", function(e){
        var p = e.target.getLatLng();
        dragging = false;
        pending = null;
        post({ type:"tee", lat:p.lat, lng:p.lng });
      });
    } else if(s.tee) L.marker([s.tee.lat,s.tee.lng], { interactive:false, icon:icon("tee","T",22) }).addTo(layer);
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
