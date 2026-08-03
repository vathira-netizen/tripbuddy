"use client";

import { useEffect } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

import type { Destination } from "@/lib/discover";
import { formatINR } from "@/lib/discover";

// Leaflet's default marker images don't survive bundling; point them at the
// hashed asset URLs Next produces for the package's own PNGs.
const defaultIcon = L.icon({
  iconUrl: markerIcon.src,
  iconRetinaUrl: markerIcon2x.src,
  shadowUrl: markerShadow.src,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

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
      {destinations.map((d) => (
        <Marker
          key={d.id}
          position={[d.lat, d.lng]}
          icon={defaultIcon}
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
