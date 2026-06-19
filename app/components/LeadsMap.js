"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import { cn } from "../lib/utils";

// Derive a sensible zoom from radiusKm. Larger area → lower zoom, clamped 9..15.
function zoomFromRadius(radiusKm) {
  const z = Math.round(14 - Math.log2(Math.max(radiusKm, 0.1)));
  return Math.min(15, Math.max(9, z));
}

// Brand-blue custom divIcon — avoids broken bundler asset paths for default marker.
function makeCenterIcon(L) {
  return L.divIcon({
    className: "",
    iconAnchor: [14, 36],
    popupAnchor: [0, -36],
    html: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="38" viewBox="0 0 28 38">
      <path d="M14 0C6.27 0 0 6.27 0 14c0 9.63 14 24 14 24S28 23.63 28 14C28 6.27 21.73 0 14 0z"
        fill="#3147ff" stroke="#fff" stroke-width="1.5"/>
      <circle cx="14" cy="14" r="5" fill="#fff"/>
    </svg>`,
  });
}

/**
 * LeadsMap — a reusable Leaflet/OSM component.
 *
 * Props:
 *   center        {lat, lng}          — map center (required for anything to show)
 *   radiusKm      number              — radius in km; draws a circle and sets zoom
 *   points        Array<{lat,lng,name}> — lead pins (read-only markers)
 *   interactive   boolean             — if true, center marker is draggable
 *   onCenterChange ({lat,lng}) => void — fired after dragging the center marker
 *   height        number (px)         — container height (default 360)
 *   className     string              — extra class on the wrapper div
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
  height = 360,
  className,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const circleRef = useRef(null);
  const markerRef = useRef(null);
  const pinsLayerRef = useRef(null);

  // ── 1. Mount map (runs once) ──────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!containerRef.current) return;

    // Dynamically require so the module is always SSR-safe.
    const L = require("leaflet");

    const lat = center?.lat ?? 0;
    const lng = center?.lng ?? 0;
    const zoom = zoomFromRadius(radiusKm);

    const map = L.map(containerRef.current, { scrollWheelZoom: false });
    mapRef.current = map;

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);

    map.setView([lat, lng], zoom);

    // Circle
    const circle = L.circle([lat, lng], {
      radius: radiusKm * 1000,
      color: "#3147ff",
      weight: 2,
      fillColor: "#3147ff",
      fillOpacity: 0.08,
    }).addTo(map);
    circleRef.current = circle;

    // Center marker
    const icon = makeCenterIcon(L);
    const marker = L.marker([lat, lng], { draggable: interactive, icon }).addTo(map);
    markerRef.current = marker;

    if (interactive) {
      marker.on("dragend", () => {
        const pos = marker.getLatLng();
        circle.setLatLng(pos);
        onCenterChange?.({ lat: pos.lat, lng: pos.lng });
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
      pinsLayerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount only

  // ── 2. Update center + radius when props change ───────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    const circle = circleRef.current;
    const marker = markerRef.current;
    if (!map || !center) return;

    const lat = center.lat ?? 0;
    const lng = center.lng ?? 0;
    const zoom = zoomFromRadius(radiusKm);

    map.setView([lat, lng], zoom);

    if (circle) {
      circle.setLatLng([lat, lng]);
      circle.setRadius(radiusKm * 1000);
    }

    if (marker) {
      marker.setLatLng([lat, lng]);
    }
  }, [center, radiusKm]);

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
        color: "#3147ff",
        weight: 1.5,
        fillColor: "#3147ff",
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
        "w-full overflow-hidden rounded-lg border border-border",
        className
      )}
    />
  );
}
