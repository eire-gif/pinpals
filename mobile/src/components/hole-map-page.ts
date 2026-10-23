import { PIN_COLOURS } from "@/lib/hole-geo";
import type { TileSource } from "@/lib/map-tiles-rules";
import { colors } from "@/lib/theme";

/** Google's own logo, served by Google and shown unmodified, as its Map
 *  Tiles policies require (white outlined version: for busy imagery). */
export const GOOGLE_LOGO_URL = "https://maps.gstatic.com/mapfiles/api-3/images/google_white5_hdpi.png";

/**
 * The page. Plain JS, no build step. It never decides a number: it draws
 * what `draw(scene)` hands it and posts taps back.
 *
 * Imagery (Oct 2026): Apple, Esri, or Google 2D satellite (lib/map-tiles.ts).
 *
 * APPLE (17 Oct 2026). Apple's photos aren't tiles we can load: the page
 * runs Apple's own map (MapKit JS, satellite) in a layer underneath ours,
 * with no gestures of its own, and puts it exactly where ours is looking
 * after every move, zoom and turn (syncApple). Everything drawn — T, flag,
 * lines, labels, shots, outlines — stays ours, as before. Apple's logo and
 * "Legal" sit at the bottom of its layer, just above the sheet; ours lift
 * clear of them. If Apple's map can't start (no signal, a bad token, Apple
 * down) or doesn't line up with ours, the page switches to Esri by itself.
 * With Google the page also shows the Google Maps logo bottom left and
 * Google's copyright line bottom right — both lifted clear of the bottom
 * sheet — and asks the app for that line whenever the view settles
 * ("view" message → window.pp.credit). OpenStreetMap's credit for the
 * outlines sits in a box of its own, so it's plain which source is which.
 */
export function pageHtml(source: TileSource): string {
  const google = source.provider === "google";
  const apple = source.provider === "apple";
  return `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css">
<style>
  html,body,#map{margin:0;height:100%;width:100%;background:${colors.green800};}
  ${apple ? "#map{position:absolute;left:0;top:0;background:transparent;z-index:1;} #mk{position:absolute;left:0;top:0;width:100%;height:100%;z-index:0;pointer-events:none;}" : ""}
  .leaflet-container{font-family:-apple-system,system-ui,sans-serif;}
  .leaflet-control-attribution{font-size:9px;background:rgba(12,32,56,.55)!important;color:#efe7d6!important;}
  .leaflet-control-attribution a{color:#efe7d6!important;}
  .leaflet-control-attribution{max-width:70vw;white-space:normal;line-height:1.35;}
  .glogo{margin:0 0 5px 10px!important;pointer-events:none;}
  .glogo img{height:18px;width:auto;display:block;}
  .glogo span{font:700 12px -apple-system,system-ui,sans-serif;color:#fff;text-shadow:0 0 2px rgba(0,0,0,.9);}
  .pin{display:flex;align-items:center;justify-content:center;border-radius:999px;font-weight:700;box-shadow:0 1px 4px rgba(0,0,0,.45);}
  .tee{width:22px;height:22px;background:${colors.cream50};color:${colors.navy900};font-size:11px;border:2px solid ${colors.navy900};}
  .pinflag{width:44px;height:52px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.45));}
  .flag{width:26px;height:26px;background:${colors.gold400};color:${colors.navy900};font-size:14px;border:2px solid ${colors.cream50};}
  .edge{width:8px;height:8px;background:${colors.cream50};border:1.5px solid ${colors.navy900};}
  .shot{width:20px;height:20px;background:${colors.navy900};color:${colors.cream50};font-size:11px;border:2px solid ${colors.cream50};}
  .tap{width:18px;height:18px;border:2px solid ${colors.cream50};background:rgba(255,255,255,.18);}
  .aim{width:34px;height:34px;border:3px solid #ffffff;background:rgba(255,255,255,.12);box-shadow:0 0 0 1px rgba(0,0,0,.25),0 2px 6px rgba(0,0,0,.35);}
  .aim:after{content:"";width:4px;height:4px;border-radius:2px;background:#fff;}
  .label{white-space:nowrap;padding:3px 9px;border-radius:999px;background:rgba(12,32,56,.85);color:${colors.cream50};font-size:13px;font-weight:700;transform:translate(-50%,-50%);display:inline-block;}
  .label.gold{background:${colors.gold400};color:${colors.navy900};}
  .label.arc{font-size:11.5px;padding:2px 7px;background:rgba(12,32,56,.8);}
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
</style></head><body>${apple ? '<div id="mk"></div>' : ""}<div id="map"></div>
<script src="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://cdn.jsdelivr.net/npm/leaflet-rotate@0.2.8/dist/leaflet-rotate.js"></script>
<script>
(function(){
  function post(m){ try{ window.ReactNativeWebView.postMessage(JSON.stringify(m)); }catch(e){} }
  if(!window.L){ post({type:"failed"}); return; }
  var canRotate = typeof L.Map.prototype.setBearing === "function";
  var GOOGLE = ${JSON.stringify(google)};
  var APPLE = ${JSON.stringify(apple)};
  // Zoom animation stays on with Apple too (17 Oct: turning it off made the
  // T follow the finger after a pinch). Apple catches up at the end of the
  // ~¼ s animation; pinches and drags keep it in step frame by frame.
  var map = L.map("map", { zoomControl:false, attributionControl:false, rotate:canRotate, touchRotate:false, rotateControl:false, bearing:0, maxZoom:20, zoomSnap:0.25 });
  // A second finger while holding the T, flag or aim circle is a pinch, not
  // a move: whatever was being dragged goes back where it was, unsent.
  var fingers = 0, pinched = false;
  document.addEventListener("touchstart", function(e){ fingers = e.touches.length; if(fingers > 1) pinched = true; }, { capture:true, passive:true });
  document.addEventListener("touchend", function(e){ fingers = e.touches.length; }, { capture:true, passive:true });
  document.addEventListener("touchcancel", function(e){ fingers = e.touches.length; }, { capture:true, passive:true });
  // Use for each draggable's release: a drag that saw a second finger goes
  // back where it started and the hole is redrawn as it was; nothing's sent.
  function onRelease(marker, done){
    var from = null;
    marker.on("dragstart", function(){ from = marker.getLatLng(); pinched = fingers > 1; });
    marker.on("drag", function(){ if(pinched && from) marker.setLatLng(from); });
    marker.on("dragend", function(e){
      if(pinched){
        pinched = false; dragging = false;
        if(from) marker.setLatLng(from);
        var again = pending || last; pending = null;
        if(again) draw(again);
        return;
      }
      done(e);
    });
  }
  var TILE_URL = ${JSON.stringify(source.url)};
  var tiles = APPLE ? null : L.tileLayer(TILE_URL, { maxZoom:20, maxNativeZoom:19 }).addTo(map);
  // Imagery credit and the outlines' credit: two boxes, never one line.
  // Apple draws its own logo and Legal link, so none from us.
  var imageryCredit = L.control.attribution({ prefix:false, position:"bottomright" }).addTo(map);
  var creditText = ${JSON.stringify(google ? "Google Maps" : source.attribution)};
  if(!APPLE) imageryCredit.addAttribution(creditText);
  var osmCredit = null;
  if(GOOGLE){
    var Logo = L.Control.extend({ options:{ position:"bottomleft" }, onAdd:function(){
      var d = L.DomUtil.create("div", "glogo");
      d.setAttribute("role", "img"); d.setAttribute("aria-label", "Google Maps");
      var img = document.createElement("img");
      img.alt = "Google Maps";
      img.onerror = function(){ d.innerHTML = "<span>Google Maps</span>"; };
      img.src = ${JSON.stringify(GOOGLE_LOGO_URL)};
      d.appendChild(img);
      return d;
    }});
    new Logo().addTo(map);
    var viewTimer = null;
    var askCredit = function(){
      clearTimeout(viewTimer);
      viewTimer = setTimeout(function(){
        var b = map.getBounds(), c = map.getCenter();
        var cl = function(v, lim){ return Math.max(-lim, Math.min(lim, v)); };
        post({ type:"view", zoom:Math.round(map.getZoom()), north:cl(b.getNorth(),89.9), south:cl(b.getSouth(),89.9), east:cl(b.getEast(),179.9), west:cl(b.getWest(),179.9), lat:c.lat, lng:c.lng });
      }, 350);
    };
    map.on("moveend", askCredit);
  }
  // The app's answer: Google's copyright line for this view, and how far in
  // its photos go here (15–20).
  function credit(text, nativeZoom){
    if(typeof text === "string" && text){
      var next = "Google Maps · " + text;
      if(next !== creditText){ imageryCredit.removeAttribution(creditText); creditText = next; imageryCredit.addAttribution(creditText); }
    }
    if(typeof nativeZoom === "number" && nativeZoom >= 15 && nativeZoom <= 20){
      if(tiles && tiles.options.maxNativeZoom !== nativeZoom){ tiles.options.maxNativeZoom = nativeZoom; tiles.redraw(); }
    }
  }
  // Keep the logo and credits above the sheet that floats over the map.
  // With Apple: its layer ends just above the sheet (its logo and Legal at
  // the foot of it), and ours sit a line higher, clear of them.
  var liftBy = 0;
  function lift(bottom){
    liftBy = Math.max(0, bottom);
    var els = document.querySelectorAll(".leaflet-bottom");
    for(var i = 0; i < els.length; i++) els[i].style.bottom = (liftBy + (mk ? 26 : 0)) + "px";
    if(mkEl){ mkEl.style.height = Math.max(120, map.getSize().y - liftBy) + "px"; syncApple(); }
  }

  // ---- Apple's map underneath (MapKit JS) ----
  var mk = null, mkEl = APPLE ? document.getElementById("mk") : null, usingEsri = !APPLE, rotSign = 1, checked = false;
  function useEsri(why){
    if(usingEsri) return;
    usingEsri = true;
    try{ if(mk) mk.destroy(); }catch(e){}
    mk = null;
    if(mkEl){ mkEl.parentNode.removeChild(mkEl); mkEl = null; }
    tiles = L.tileLayer(TILE_URL, { maxZoom:20, maxNativeZoom:19 }).addTo(map);
    tiles.bringToBack();
    // Say why in the credit, small: "(Apple map: timeout)" — so a screenshot tells us.
    creditText = ${JSON.stringify(source.provider === "apple" ? source.attribution : "")} + (why ? " (Apple map: " + why + ")" : "");
    imageryCredit.addAttribution(creditText);
    document.getElementById("map").style.background = "${colors.green800}";
    lift(liftBy);
    post({ type:"imagery", provider:"esri", why:why||"" });
  }
  // Put Apple's camera where ours is: same centre (of Apple's layer, which
  // stops above the sheet), same scale, same turn. Done on every move from
  // what's been learned so far (syncApple) — never measured mid-move,
  // because Apple's map answers "where is this point?" from the last frame
  // it drew: measuring then and "correcting" pinned Apple's photo in place
  // while our drawing slid over it (17 Oct). Once the view settles and Apple
  // has redrawn, we measure where two of our points land on Apple's map and
  // learn the scale, the centre shift and the turn direction (calibrate).
  var kFix = null, shiftX = 0, shiftY = 0, fixes = 0, calTimer = null, calRuns = 0, clamped = false, calibrated = false;
  function onMk(ll){
    var p = mk.convertCoordinateToPointOnPage(new mapkit.Coordinate(ll.lat, ll.lng));
    var r = mkEl.getBoundingClientRect();
    return { x:p.x - r.left, y:p.y - r.top };
  }
  // Two points across the middle: their gap, angle and midpoint on Apple's map.
  function compare(w, h){
    var A = { x:w*0.25, y:h/2 }, B = { x:w*0.75, y:h/2 };
    var a = onMk(map.containerPointToLatLng([A.x, A.y])), b = onMk(map.containerPointToLatLng([B.x, B.y]));
    var len = Math.hypot(b.x-a.x, b.y-a.y);
    var turn = Math.atan2(b.y-a.y, b.x-a.x) * 180 / Math.PI; // ours runs flat: 0
    return { ratio: len / (B.x - A.x), turn: ((turn % 360) + 540) % 360 - 180, dx: (a.x+b.x)/2 - w/2, dy: (a.y+b.y)/2 - h/2 };
  }
  function syncApple(){
    if(!mk || !mkEl || !window.mapkit) return;
    var w = map.getSize().x, h = mkEl.clientHeight;
    if(!w || !h) return;
    try{
      // Apple shows its centre (shiftX, shiftY) off the middle: centre it on
      // what's that far from our middle, so our middle lands in the middle.
      var c = map.containerPointToLatLng([w/2 + shiftX, h/2 + shiftY]);
      var lat = map.containerPointToLatLng([w/2, h/2]).lat;
      var upp = 1 / (256 * Math.pow(2, map.getZoom())); // map units per screen px
      if(!(kFix > 0)) kFix = h * 40075017 * Math.cos(lat * Math.PI / 180) * 1.2; // first guess, learned below
      var b = canRotate ? (map.getBearing() || 0) : 0;
      mk.rotation = (((rotSign * -b) % 360) + 360) % 360;
      mk.center = new mapkit.Coordinate(c.lat, c.lng);
      var want = kFix * upp;
      mk.cameraDistance = want;
      // Apple has a closest zoom (17 Oct, iPhone: ~62 m camera height); past
      // it the photo stops growing while ours keeps going. Read it back: if
      // Apple held back, cap our zoom at where Apple stops, and go back there.
      var got = mk.cameraDistance;
      clamped = got > want * 1.02;
      if(clamped && calibrated){
        var zMax = Math.floor((map.getZoom() - Math.log(got / want) / Math.LN2) * 4) / 4;
        if(zMax > 12 && zMax < map.getMaxZoom()){
          map.setMaxZoom(zMax);
          if(map.getZoom() > zMax) map.setZoom(zMax, { animate:false });
        }
      }
    }catch(e){ useEsri("sync " + (e && e.message ? String(e.message).slice(0, 40) : "")); }
  }
  // After Apple has had time to draw the settled view.
  function afterDraw(fn){
    clearTimeout(calTimer);
    calTimer = setTimeout(function(){ requestAnimationFrame(function(){ requestAnimationFrame(fn); }); }, 180);
  }
  function calibrate(){
    if(!mk || !mkEl || !window.mapkit) return;
    var w = map.getSize().x, h = mkEl.clientHeight;
    if(!w || !h) return;
    var m;
    try{ m = compare(w, h); }catch(e){ m = null; }
    // Nonsense back from Apple: let the check decide (it falls back to Esri).
    if(!m || !(m.ratio > 0) || !isFinite(m.ratio)){ if(!checked) check(); return; }
    var b = canRotate ? (map.getBearing() || 0) : 0;
    var again = false;
    if(clamped && !calibrated){
      // Zoomed in past Apple's limit before the scale was known: learn it a
      // little further out, then come back (capped).
      var z0 = map.getZoom();
      map.setZoom(Math.max(14, z0 - 1.5), { animate:false });
      syncApple();
      afterDraw(function(){ calibrate(); if(calibrated){ map.setZoom(z0, { animate:false }); syncApple(); } });
      return;
    }
    if(Math.abs(m.ratio - 1) > 0.004 && !clamped){ kFix *= m.ratio; again = true; }
    if(Math.abs(m.turn) > 3 && Math.abs(Math.sin(b * Math.PI / 180)) > 0.05){ rotSign = -rotSign; again = true; }
    else if(Math.hypot(m.dx, m.dy) > 1.5){ shiftX += m.dx; shiftY += m.dy; again = true; }
    diag("cal" + calRuns);
    if(again && calRuns++ < 6){ syncApple(); afterDraw(calibrate); return; }
    calRuns = 0;
    if(!clamped) calibrated = true;
    if(!checked) check();
  }
  // Is Apple's photo really under our drawing? Where does a point a little
  // above the middle land on each? Still out by more than ~24 px after a
  // few goes: a wrong photo is worse than a plainer one, so Esri.
  function misfit(){
    var w = map.getSize().x, h = mkEl.clientHeight;
    var p = onMk(map.containerPointToLatLng([w/2, h*0.2]));
    return Math.hypot(p.x - w/2, p.y - h*0.2);
  }
  function check(){
    checked = true;
    var off = misfit();
    diag("check");
    post({ type:"imagery", provider:"apple", off:Math.round(off), turn:rotSign, k:Math.round(kFix||0), shift:[Math.round(shiftX), Math.round(shiftY)] });
    if(off <= 24){ fixes = 0; return; }
    if(fixes++ < 3){ checked = false; syncApple(); afterDraw(calibrate); return; }
    var m = null;
    try{ m = compare(map.getSize().x, mkEl.clientHeight); }catch(e){}
    useEsri("misaligned " + Math.round(off) + (m ? " x" + (Math.round(m.ratio * 100) / 100) + " " + Math.round(m.turn) + "deg" : ""));
  }
  // What we measured, for the logs (POST /api/app/map-diag via the app): the
  // first dozen per map, so a phone's numbers can be read, not guessed.
  var diags = 0;
  function diag(tag){
    if(!mk || !mkEl || diags++ > 12) return;
    try{
      var w = map.getSize().x, h = mkEl.clientHeight, m = compare(w, h), c = mk.center;
      var oc = map.containerPointToLatLng([w/2, h/2]);
      var r = mkEl.getBoundingClientRect();
      // Apple's own idea of the camera for our unturned view, for comparison.
      var rot = mk.rotation, cen = mk.center, dist = mk.cameraDistance, dRect = null;
      try{
        var mp = new mapkit.Coordinate(oc.lat, oc.lng).toMapPoint(), s2 = 256 * Math.pow(2, map.getZoom());
        mk.rotation = 0; mk.visibleMapRect = new mapkit.MapRect(mp.x - w/s2/2, mp.y - h/s2/2, w/s2, h/s2); dRect = mk.cameraDistance;
      }catch(e){}
      mk.rotation = rot; mk.center = cen; mk.cameraDistance = dist;
      post({ type:"diag", d:{ v:"diag2", clamped:clamped, calibrated:calibrated, maxZoom:map.getMaxZoom(), tag:tag, ua:navigator.userAgent.slice(0, 90), dpr:window.devicePixelRatio, vw:window.innerWidth, vh:window.innerHeight,
        vv:window.visualViewport ? [window.visualViewport.width, window.visualViewport.height, window.visualViewport.scale] : null,
        w:w, h:h, rect:[Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        zoom:map.getZoom(), bearing:canRotate ? map.getBearing() : 0, kFix:kFix, shift:[shiftX, shiftY], rotSign:rotSign,
        mkDist:dist, dRect:dRect, mkRot:rot, mkCenter:c ? [c.latitude, c.longitude] : null, ourCenter:[oc.lat, oc.lng],
        cmp:m, misfit:misfit(), mkVersion:mapkit.version } });
    }catch(e){ post({ type:"diag", d:{ v:"diag2", tag:tag, err:String(e && e.message || e).slice(0, 120) } }); }
  }
  function settled(){ if(mk){ syncApple(); calRuns = 0; afterDraw(calibrate); } }
  if(APPLE){
    var giveUp = setTimeout(function(){ if(!mk) useEsri("timeout"); }, 10000);
    window.ppMapKit = function(){
      try{
        mapkit.init({ authorizationCallback:function(done){ done(${JSON.stringify(apple ? source.token : "")}); }, language:"en-GB" });
        mapkit.addEventListener("error", function(e){ useEsri("mapkit " + (e && e.status)); });
        if(usingEsri) return;
        var V = mapkit.FeatureVisibility || {};
        mk = new mapkit.Map(mkEl, {
          mapType: mapkit.Map.MapTypes.Satellite,
          showsCompass: V.Hidden, showsScale: V.Hidden, showsZoomControl:false, showsMapTypeControl:false,
          showsUserLocationControl:false, showsPointsOfInterest:false,
          isRotationEnabled:true, isZoomEnabled:false, isScrollEnabled:false
        });
        try{ mk.cameraZoomRange = new mapkit.CameraZoomRange(1, 40000000); }catch(e){}
        try{ mk.padding = new mapkit.Padding(0, 0, 0, 0); }catch(e){}
        clearTimeout(giveUp);
        // Give Apple's map a moment to size itself before lining it up.
        checked = true;
        setTimeout(function(){ checked = false; lift(liftBy); settled(); }, 400);
      }catch(e){ useEsri("init"); }
    };
    var sc = document.createElement("script");
    sc.src = "https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.core.js";
    sc.crossOrigin = "anonymous";
    sc.async = true;
    sc.setAttribute("data-libraries", "map");
    sc.setAttribute("data-callback", "ppMapKit");
    sc.onerror = function(){ useEsri("script"); };
    document.head.appendChild(sc);
    map.on("move zoom rotate resize viewreset", syncApple);
    map.on("moveend zoomend", settled);
  }
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
  var last = null, lastKey = null, lastHole = null;

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

  // The flag (Oct 2026): a pin and flag in the colour for where it is on
  // the green — red front, yellow middle, white back — draggable.
  var PIN = ${JSON.stringify(PIN_COLOURS)};
  function flagIcon(colour){
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="44" height="52" viewBox="0 0 44 52">'
      + '<ellipse cx="14" cy="47" rx="7" ry="3" fill="rgba(0,0,0,.35)"/>'
      + '<rect x="12.6" y="6" width="2.8" height="41" rx="1.4" fill="#ffffff" stroke="rgba(12,32,56,.6)" stroke-width="0.8"/>'
      + '<path class="cloth" d="M15.4 6.5l22 8.2-22 8.2z" fill="'+colour+'" stroke="rgba(12,32,56,.75)" stroke-width="1.2" stroke-linejoin="round"/>'
      + '<circle cx="14" cy="47" r="3" fill="#ffffff" stroke="rgba(12,32,56,.7)" stroke-width="1"/>'
      + '</svg>';
    return L.divIcon({ className:"", html:'<div class="pinflag">'+svg+'</div>', iconSize:[44,52], iconAnchor:[14,47] });
  }
  function zoneAt(g, p){
    if(!g.front || !g.back) return "middle";
    var f = map.latLngToContainerPoint([g.front.lat,g.front.lng]);
    var b = map.latLngToContainerPoint([g.back.lat,g.back.lng]);
    var q = map.latLngToContainerPoint([p.lat,p.lng]);
    var ax = b.x-f.x, ay = b.y-f.y, l2 = ax*ax+ay*ay;
    if(!l2) return "middle";
    var t = ((q.x-f.x)*ax + (q.y-f.y)*ay) / l2;
    return t < 1/3 ? "front" : t > 2/3 ? "back" : "middle";
  }

  function label(at, text, gold, big){ return L.marker([at.lat,at.lng], { interactive:false, icon:L.divIcon({ className:"", html:'<span class="label'+(gold?' gold':'')+(big?' big':'')+'">'+text+'</span>', iconSize:[0,0] }) }); }
  function mid(a,b){ return { lat:(a.lat+b.lat)/2, lng:(a.lng+b.lng)/2 }; }

  // Labels on a line (Oct 2026): kept at the middle of the part of the line
  // that's on screen, so zooming in on the ball never hides "245 yds"
  // off the edge. Re-placed whenever the view moves, zooms or turns.
  var floating = [];
  function lineLabel(a, b, text, gold, big){
    var m = label(mid(a,b), text, gold, big);
    floating.push({ m:m, a:a, b:b });
    return m;
  }
  function clip(p, q, box){
    var t0 = 0, t1 = 1, dx = q.x-p.x, dy = q.y-p.y;
    var tests = [[-dx, p.x-box.l], [dx, box.r-p.x], [-dy, p.y-box.t], [dy, box.b-p.y]];
    for(var i = 0; i < 4; i++){
      var pp = tests[i][0], qq = tests[i][1];
      if(pp === 0){ if(qq < 0) return null; continue; }
      var r = qq/pp;
      if(pp < 0){ if(r > t1) return null; if(r > t0) t0 = r; }
      else { if(r < t0) return null; if(r < t1) t1 = r; }
    }
    return { x:p.x+dx*(t0+t1)/2, y:p.y+dy*(t0+t1)/2 };
  }
  function placeFloating(){
    if(!floating.length) return;
    var size = map.getSize(), ins = (last && last.inset) || { top:36, bottom:36 };
    var box = { l:30, t:ins.top+10, r:size.x-30, b:size.y-ins.bottom-10 };
    floating.forEach(function(f){
      if(!layer.hasLayer(f.m)) return;
      var pa = map.latLngToContainerPoint([f.a.lat,f.a.lng]), pb = map.latLngToContainerPoint([f.b.lat,f.b.lng]);
      var c = clip(pa, pb, box);
      var el = f.m.getElement();
      if(!c){ if(el) el.style.visibility = "hidden"; return; }
      if(el) el.style.visibility = "";
      f.m.setLatLng(map.containerPointToLatLng([c.x, c.y]));
    });
  }
  map.on("move zoom zoomend moveend rotate viewreset resize", placeFloating);

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

  // Auto-zoom (Oct 2026): fit to the new frame invisibly to learn where it
  // ends up, step back, and fly there, so closing in on the green glides
  // rather than jumps. Only on the same hole with the same turn; anything
  // else (or a finger on the map) is the instant fit.
  function glide(){
    if(!last) return;
    if(fingers > 0){ return; }
    var from = { c:map.getCenter(), z:map.getZoom(), b:canRotate ? map.getBearing() : 0 };
    refit();
    var to = { c:map.getCenter(), z:map.getZoom(), b:canRotate ? map.getBearing() : 0 };
    if(Math.abs(to.b - from.b) > 0.5) return;
    if(from.c.distanceTo(to.c) < 1 && Math.abs(from.z - to.z) < 0.05) return;
    try{
      map.setView(from.c, from.z, { animate:false });
      map.flyTo(to.c, to.z, { duration:0.9, easeLinearity:0.35 });
    }catch(e){
      map.setView(to.c, to.z, { animate:false });
    }
  }

  // The member moving the map themselves: the screen pauses auto-zoom.
  map.on("dragstart", function(){ post({ type:"manual" }); });
  map.on("zoomstart", function(){ if(fingers > 1) post({ type:"manual" }); });
  map.on("dblclick", function(){ post({ type:"manual" }); });

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
    if((list||[]).length && !osmCredited){
      osmCredited = true;
      osmCredit = L.control.attribution({ position:"bottomright" }).addTo(map);
      osmCredit.addAttribution("Outlines © OpenStreetMap contributors");
    }
  }

  var dragging = false, pending = null;

  function draw(s){
    // A GPS tick mid-drag would pull the circle from under the finger.
    if(dragging){ pending = s; return; }
    last = s;
    lift(((s.inset && s.inset.bottom) || 36) - 24);
    drawShapes(s.outlines, s.hole, s.showOutlines !== false);
    layer.clearLayers();
    floating = [];
    var g = s.green || {};
    var greenLine = null, greenLabel = null, toLine = null, toLabel = null;
    if(s.greenLine && g.centre){
      var o = s.greenLine.origin;
      greenLine = L.polyline([[o.lat,o.lng],[g.centre.lat,g.centre.lng]], { color:"#ffffff", weight:2.5, opacity:.95, interactive:false }).addTo(layer);
      greenLabel = lineLabel(o, g.centre, esc(s.greenLine.label), true, true).addTo(layer);
    }
    if(s.tap){
      var t = s.tap;
      toLine = L.polyline([[t.origin.lat,t.origin.lng],[t.lat,t.lng]], { color:"#ffffff", weight:2.5, opacity:.95, interactive:false }).addTo(layer);
      toLabel = lineLabel(t.origin, t, esc(t.toLabel)).addTo(layer);
      var onLine = null, onLabel = null;
      if(t.green){
        onLine = L.polyline([[t.lat,t.lng],[t.green.lat,t.green.lng]], { color:"#ffffff", weight:2.5, opacity:.95, interactive:false }).addTo(layer);
        if(t.onLabel) onLabel = lineLabel(t, t.green, esc(t.onLabel), true, true).addTo(layer);
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
      onRelease(aim, function(e){
        var p = e.target.getLatLng();
        dragging = false;
        // The app answers with a fresh scene (new aim, latest GPS); drawing
        // the held one first would flick the circle back to where it was.
        pending = null;
        post({ type:"tap", lat:p.lat, lng:p.lng });
      });
    }
    // Distance arcs, under the hazards and markers: thin, so the photo shows through.
    (s.arcs||[]).forEach(function(a){
      L.polyline(a.points.map(function(p){ return [p.lat,p.lng]; }), { color:"#ffffff", weight:1.6, opacity:.8, interactive:false }).addTo(layer);
      L.marker([a.end.lat,a.end.lng], { interactive:false, icon:L.divIcon({ className:"", html:'<span class="label arc">'+esc(a.label)+'</span>', iconSize:[0,0] }) }).addTo(layer);
    });
    (s.hazards||[]).forEach(function(h){
      // The distance to it, small, beside it (Oct 2026) — readable zoomed in.
      var html = '<div class="hzw"><div class="pin hz '+h.kind+'" style="width:10px;height:10px;box-sizing:border-box"></div>'+(h.dist ? '<span class="hzd">'+esc(h.dist)+'</span>' : '')+'</div>';
      L.marker([h.lat,h.lng], { interactive:false, icon:L.divIcon({ className:"", html:html, iconSize:[10,10], iconAnchor:[5,5] }) }).addTo(layer);
    });
    if(s.shots && s.shots.length){
      // Each dot is where a ball finished; its label sits on the line that
      // got it there, from the previous dot or the start (the tee).
      var path = (s.shotStart ? [s.shotStart] : []).concat(s.shots);
      L.polyline(path.map(function(p){ return [p.lat,p.lng]; }), { color:"${colors.navy900}", weight:3, opacity:.85, interactive:false }).addTo(layer);
      s.shots.forEach(function(p,i){
        var prev = i > 0 ? s.shots[i-1] : s.shotStart;
        if(prev && p.label) lineLabel(prev, p, esc(p.label)).addTo(layer);
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
      onRelease(tee, function(e){
        var p = e.target.getLatLng();
        dragging = false;
        pending = null;
        post({ type:"tee", lat:p.lat, lng:p.lng });
      });
    } else if(s.tee) L.marker([s.tee.lat,s.tee.lng], { interactive:false, icon:icon("tee","T",22) }).addTo(layer);
    if(g.front) L.marker([g.front.lat,g.front.lng], { interactive:false, icon:icon("edge","",8) }).addTo(layer);
    if(g.back) L.marker([g.back.lat,g.back.lng], { interactive:false, icon:icon("edge","",8) }).addTo(layer);
    if(g.centre && s.pinMovable){
      var flag = L.marker([g.centre.lat,g.centre.lng], { draggable:true, autoPan:false, icon:flagIcon(PIN[g.zone||"middle"]) }).addTo(layer);
      flag.on("dragstart", function(){ dragging = true; if(onLabel) layer.removeLayer(onLabel); if(greenLabel) layer.removeLayer(greenLabel); });
      flag.on("drag", function(e){
        var p = e.target.getLatLng();
        if(onLine && s.tap) onLine.setLatLngs([[s.tap.lat,s.tap.lng],[p.lat,p.lng]]);
        if(greenLine && s.greenLine) greenLine.setLatLngs([[s.greenLine.origin.lat,s.greenLine.origin.lng],[p.lat,p.lng]]);
        var cloth = e.target.getElement() && e.target.getElement().querySelector(".cloth");
        if(cloth) cloth.setAttribute("fill", PIN[zoneAt(g, p)]);
      });
      onRelease(flag, function(e){
        var p = e.target.getLatLng();
        dragging = false;
        pending = null;
        post({ type:"pin", lat:p.lat, lng:p.lng });
      });
    } else if(g.centre) L.marker([g.centre.lat,g.centre.lng], { interactive:false, icon:icon("flag","⚑",26) }).addTo(layer);
    if(s.me){
      if(s.me.accuracyM) L.circle([s.me.lat,s.me.lng], { radius:s.me.accuracyM, color:"#4aa3df", weight:1, fillOpacity:.12, interactive:false }).addTo(layer);
      L.circleMarker([s.me.lat,s.me.lng], { radius:7, color:"#ffffff", weight:2.5, fillColor:"#1d8cf8", fillOpacity:1, interactive:false }).addTo(layer);
    }
    // New hole: fit and turn first, then check Apple lines up with the turned view.
    if(s.frameKey !== lastKey){
      var smooth = s.glide && lastKey != null && lastHole === s.hole;
      lastKey = s.frameKey; lastHole = s.hole;
      if(smooth) glide(); else refit();
      checked = false; settled();
    }
    placeFloating();
  }

  map.on("click", function(e){ post({ type:"tap", lat:e.latlng.lat, lng:e.latlng.lng }); });
  window.pp = { draw:draw, refit:refit, credit:credit };
  post({ type:"ready" });
})();
</script></body></html>`;
}
