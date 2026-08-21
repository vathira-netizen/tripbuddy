"use client";

import { useEffect } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import type { Destination } from "@/lib/discover";
import { formatINR } from "@/lib/discover";

// Numbered circular markers, drawn as a divIcon rather than the stock pin PNGs
// (ref 6a). Coral marks the selected destination, teal the rest.
const TEAL = "#0f3d3e";
const CORAL = "#e8674c";

function numberedIcon(n: number, active: boolean) {
  const size = active ? 26 : 24;
  return L.divIcon({
    className: "", // Leaflet's default adds a white box; we draw our own.
    html:
      `<span style="display:grid;place-items:center;width:${size}px;height:${size}px;` +
      `border-radius:9999px;background:${active ? CORAL : TEAL};color:#fff;` +
      `font:700 ${active ? 12 : 11}px/1 var(--font-dm-sans),system-ui,sans-serif;` +
      `box-shadow:0 3px 10px rgba(0,0,0,.3)">${n}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

// India-ish default view when there's nothing to fit to.
const INDIA_CENTER: [number, number] = [22.35, 78.66];

/** Pans/zooms the map to the selected destination without a full remount. */
function FocusMarker({ target }: { target: Destination | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], 8, { duration: 0.6 });
  }, [target, map]);
  return null;
}

/** Fits the map to all markers whenever the result set changes. */
function FitBounds({ destinations }: { destinations: Destination[] }) {
  const map = useMap();
  useEffect(() => {
    if (destinations.length === 0) return;
    const bounds = L.latLngBounds(destinations.map((d) => [d.lat, d.lng]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 9 });
  }, [destinations, map]);
  return null;
}

export default function DestinationMap({
  destinations,
  selected,
  onSelect,
}: {
  destinations: Destination[];
  selected: Destination | null;
  onSelect: (d: Destination) => void;
}) {
  return (
    <MapContainer
      center={INDIA_CENTER}
      zoom={5}
      scrollWheelZoom
      className="h-full w-full"
      // A label so the map region is announced to assistive tech.
      aria-label="Map of destinations"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds destinations={destinations} />
      <FocusMarker target={selected} />
      {destinations.map((d, i) => (
        <Marker
          key={d.id}
          position={[d.lat, d.lng]}
          icon={numberedIcon(i + 1, selected?.id === d.id)}
          eventHandlers={{ click: () => onSelect(d) }}
        >
          <Popup>
            <strong>{d.name}</strong>
            <br />
            {formatINR(d.avg_daily_budget)}/day
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
