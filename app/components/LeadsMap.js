"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import { cn } from "../lib/utils";

// Derive a sensible zoom from radiusKm. Larger area → lower zoom, clamped 9..15.
function zoomFromRadius(radiusKm) {
  const z = Math.round(14 - Math.log2(Math.max(radiusKm, 0.1)));
  return Math.min(15, Math.max(9, z));
}

// Brand-orange custom divIcon - avoids broken bundler asset paths for default marker.
function makeCenterIcon(L) {
  return L.divIcon({
    className: "",
    iconAnchor: [14, 36],
    popupAnchor: [0, -36],
    html: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="38" viewBox="0 0 28 38">
      <path d="M14 0C6.27 0 0 6.27 0 14c0 9.63 14 24 14 24S28 23.63 28 14C28 6.27 21.73 0 14 0z"
        fill="#e05305" stroke="#fff" stroke-width="1.5"/>
      <circle cx="14" cy="14" r="5" fill="#fff"/>
    </svg>`,
  });
}

// The grab handle that sits on the circle's edge. Small, high-contrast and
// obviously draggable - a plain marker would read as a second search pin.
function makeHandleIcon(L) {
  return L.divIcon({
    className: "",
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    html: `<span style="display:block;width:14px;height:14px;border-radius:9999px;background:#fff;border:3px solid #e05305;box-shadow:0 1px 3px rgba(0,0,0,.35);cursor:ew-resize"></span>`,
  });
}

/**
 * LeadsMap - a reusable Leaflet/OSM component.
 *
 * Props:
 *   center        {lat, lng}          - map center (required for anything to show)
 *   radiusKm      number              - radius in km; draws a circle and sets zoom
 *   points        Array<{lat,lng,name}> - lead pins (read-only markers)
 *   interactive   boolean             - if true, the search area can be moved and
 *                                       resized directly on the map
 *   onCenterChange ({lat,lng}) => void - fired after moving the search area
 *   onRadiusChange (km) => void        - fired after dragging the resize handle
 *   height        number (px)         - container height (default 360)
 *   wheelZoom     boolean             - wheel zooms the map (default true). Turn
 *                                       it off for a map inside a scrollable
 *                                       panel, where it would swallow the scroll
 *                                       the user meant for the panel.
 *   className     string              - extra class on the wrapper div
 *
 * Usage:
 *   const LeadsMap = dynamic(() => import("@/components/LeadsMap"), { ssr: false });
 *   <LeadsMap center={{lat:40.7,lng:-74}} radiusKm={5} interactive onCenterChange={...} />
 */
export default function LeadsMap({
  center,
  radiusKm = 5,
  points = [],
  interactive = false,
  onCenterChange,
  onRadiusChange,
  minRadiusKm = 1,
  maxRadiusKm = 200,
  height = 360,
  wheelZoom = true,
  className,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const circleRef = useRef(null);
  const markerRef = useRef(null);
  const handleRef = useRef(null);
  const pinsLayerRef = useRef(null);
  // Latest callbacks, so the mount-only effect's handlers never call a stale
  // closure after a parent re-render.
  const cbRef = useRef({ onCenterChange, onRadiusChange, minRadiusKm, maxRadiusKm });
  cbRef.current = { onCenterChange, onRadiusChange, minRadiusKm, maxRadiusKm };
  // Tracks the last center/radius we actually applied, so an unrelated parent
  // re-render (which hands us a fresh `center` object with identical values)
  // never re-runs setView and snaps the user's manual zoom back.
  const lastViewRef = useRef({ lat: null, lng: null, radiusKm: null });

  // ── 1. Mount map (runs once) ──────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!containerRef.current) return;

    // Dynamically require so the module is always SSR-safe.
    const L = require("leaflet");

    const lat = center?.lat ?? 0;
    const lng = center?.lng ?? 0;
    const zoom = zoomFromRadius(radiusKm);

    const map = L.map(containerRef.current, {
      // The wheel zooms, the way it does on Google Maps. This was off, which is
      // why the map felt inert - the only way in or out was the +/- buttons.
      scrollWheelZoom: wheelZoom,
      // Leaflet snaps to whole zoom levels by default, so one wheel notch jumps
      // a full power of two and the map lurches. Quarter steps with a smaller
      // delta give the gradual, continuous zoom Google has.
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 100,
      wheelDebounceTime: 20,
      // Controls go bottom-right like Google's, not Leaflet's default top-left.
      zoomControl: false,
    });
    mapRef.current = map;
    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.control.scale({ position: "bottomleft", metric: true, imperial: true }).addTo(map);

    // CARTO Voyager rather than raw openstreetmap.org tiles. Same free OSM data,
    // but a cartography much closer to what people expect from a map in a
    // product: muted land, clear road hierarchy, restrained labels. The plain OSM
    // style is why this looked like a wiki map. Attribution for both OSM and
    // CARTO is a licence condition - it stays.
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 20,
      // Serves @2x tiles on high-DPI screens, so labels are sharp instead of the
      // soft upscaled text the single-resolution tiles gave.
      detectRetina: true,
    }).addTo(map);

    map.setView([lat, lng], zoom);

    // Circle
    const circle = L.circle([lat, lng], {
      radius: radiusKm * 1000,
      color: "#e05305",
      weight: 2,
      fillColor: "#e05305",
      fillOpacity: 0.08,
    }).addTo(map);
    circleRef.current = circle;

    // Center marker
    const icon = makeCenterIcon(L);
    const marker = L.marker([lat, lng], { draggable: interactive, icon }).addTo(map);
    markerRef.current = marker;

    if (interactive) {
      // The circle used to be scenery: only the pin moved it, and only the
      // slider sized it. People try to drag the area itself, and try to pull its
      // edge, because that is what a search radius on a map looks like it does.

      // Sync everything that follows the centre.
      const moveTo = (pos) => {
        circle.setLatLng(pos);
        marker.setLatLng(pos);
        placeHandle(pos, circle.getRadius());
      };

      // The handle sits due east of the centre, on the edge, so its distance
      // from the centre IS the radius.
      const edgeOf = (pos, radiusMeters) => {
        // One degree of longitude shrinks with latitude; at the poles it
        // collapses, so the cosine is floored to keep this finite.
        const kmPerDegLng = 111.32 * Math.max(0.01, Math.cos((pos.lat * Math.PI) / 180));
        return L.latLng(pos.lat, pos.lng + radiusMeters / 1000 / kmPerDegLng);
      };

      function placeHandle(pos, radiusMeters) {
        if (handleRef.current) handleRef.current.setLatLng(edgeOf(pos, radiusMeters));
      }

      // ---- drag the area ----
      let dragging = false;
      let grabOffset = null;

      const onAreaDown = (e) => {
        dragging = true;
        const c = circle.getLatLng();
        grabOffset = { lat: c.lat - e.latlng.lat, lng: c.lng - e.latlng.lng };
        map.dragging.disable();
        L.DomUtil.addClass(map.getContainer(), "leaflet-grabbing");
        map.on("mousemove", onAreaMove);
        map.once("mouseup", onAreaUp);
        // Leaflet's mouseup only fires over the map. Releasing the button off
        // the edge would otherwise leave the drag latched and map panning
        // disabled, with no way back short of a reload.
        document.addEventListener("mouseup", onAreaUp, { once: true });
      };
      const onAreaMove = (e) => {
        if (!dragging) return;
        moveTo(L.latLng(e.latlng.lat + grabOffset.lat, e.latlng.lng + grabOffset.lng));
      };
      const onAreaUp = () => {
        if (!dragging) return; // both listeners fire when the release is on the map
        dragging = false;
        map.dragging.enable();
        L.DomUtil.removeClass(map.getContainer(), "leaflet-grabbing");
        map.off("mousemove", onAreaMove);
        document.removeEventListener("mouseup", onAreaUp);
        const pos = circle.getLatLng();
        cbRef.current.onCenterChange?.({ lat: pos.lat, lng: pos.lng });
      };

      circle.on("mousedown", onAreaDown);
      circle.on("mouseover", () => { if (!dragging) circle.setStyle({ fillOpacity: 0.14 }); });
      circle.on("mouseout", () => { if (!dragging) circle.setStyle({ fillOpacity: 0.08 }); });

      // ---- drag the edge to resize ----
      const handle = L.marker(edgeOf(circle.getLatLng(), circle.getRadius()), {
        draggable: true,
        icon: makeHandleIcon(L),
        keyboard: false,
        zIndexOffset: 1000,
        title: "Drag to change the radius",
      }).addTo(map);
      handleRef.current = handle;

      const applyHandle = (commit) => {
        const c = circle.getLatLng();
        const km = c.distanceTo(handle.getLatLng()) / 1000;
        const { minRadiusKm: lo, maxRadiusKm: hi } = cbRef.current;
        const clamped = Math.min(hi, Math.max(lo, Math.round(km)));
        circle.setRadius(clamped * 1000);
        // Snap the handle back onto the edge, so it can't drift off the circle
        // when the value was clamped or rounded.
        handle.setLatLng(edgeOf(c, clamped * 1000));
        if (commit) cbRef.current.onRadiusChange?.(clamped);
      };
      handle.on("drag", () => applyHandle(false));
      handle.on("dragend", () => applyHandle(true));

      marker.on("drag", () => moveTo(marker.getLatLng()));
      marker.on("dragend", () => {
        const pos = marker.getLatLng();
        moveTo(pos);
        cbRef.current.onCenterChange?.({ lat: pos.lat, lng: pos.lng });
      });
    }

    // Pins layer group
    const pinsLayer = L.layerGroup().addTo(map);
    pinsLayerRef.current = pinsLayer;

    return () => {
      map.remove();
      mapRef.current = null;
      circleRef.current = null;
      markerRef.current = null;
      handleRef.current = null;
      pinsLayerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount only

  // ── 2. Update center + radius when they actually change ───────────────────
  // Depends on primitive lat/lng/radius (NOT the `center` object) so identical
  // values from a re-render are a no-op. A genuine recenter keeps the user's
  // current zoom; only a radius change refits the zoom to the new area.
  useEffect(() => {
    const map = mapRef.current;
    const circle = circleRef.current;
    const marker = markerRef.current;
    if (!map || !center) return;

    const lat = center.lat ?? 0;
    const lng = center.lng ?? 0;
    const last = lastViewRef.current;
    const centerMoved = last.lat !== lat || last.lng !== lng;
    const radiusChanged = last.radiusKm !== radiusKm;

    if (circle) {
      circle.setLatLng([lat, lng]);
      circle.setRadius(radiusKm * 1000);
    }
    if (marker) {
      marker.setLatLng([lat, lng]);
    }
    if (handleRef.current) {
      const kmPerDegLng = 111.32 * Math.max(0.01, Math.cos((lat * Math.PI) / 180));
      handleRef.current.setLatLng([lat, lng + radiusKm / kmPerDegLng]);
    }

    // Zoom belongs to the user once they have touched it. Every radius change
    // used to slam the view back to zoomFromRadius, so zooming in to place the
    // pin and then nudging the slider threw the zoom away. Refit only when
    // there is no view yet, when the search moves somewhere new, or when the
    // area has grown past what is actually on screen.
    const firstView = last.lat === null;
    const circleOffScreen =
      radiusChanged && circle && !map.getBounds().contains(circle.getBounds());
    if (firstView || centerMoved) {
      const zoom = firstView ? zoomFromRadius(radiusKm) : map.getZoom();
      map.setView([lat, lng], zoom);
    } else if (circleOffScreen) {
      map.fitBounds(circle.getBounds(), { padding: [24, 24] });
    }
    lastViewRef.current = { lat, lng, radiusKm };
  }, [center?.lat, center?.lng, radiusKm]);

  // ── 3. Rebuild pins whenever points array changes ─────────────────────────
  useEffect(() => {
    const pinsLayer = pinsLayerRef.current;
    if (!pinsLayer) return;
    if (typeof window === "undefined") return;

    const L = require("leaflet");

    pinsLayer.clearLayers();
    (points || []).forEach((pt) => {
      const lat = parseFloat(pt?.lat);
      const lng = parseFloat(pt?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

      const pin = L.circleMarker([lat, lng], {
        radius: 5,
        color: "#e05305",
        weight: 1.5,
        fillColor: "#e05305",
        fillOpacity: 0.7,
      });

      if (pt?.name) pin.bindTooltip(String(pt.name));
      pinsLayer.addLayer(pin);
    });
  }, [points]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      style={{ height }}
      className={cn(
        // `isolate` (isolation: isolate) keeps Leaflet's internal z-indexes
        // (panes/controls go up to 1000) contained in their own stacking context
        // so the map can't paint over headers/menus/content scrolling past it.
        "relative isolate z-0 w-full overflow-hidden rounded-lg border border-border",
        className
      )}
    />
  );
}
