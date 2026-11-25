import { useEffect, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

// Fix Leaflet's default marker icon paths when bundled with Vite
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

// Helper component that listens for map clicks and moves the pin
function MapClickHandler({ onSelect }) {
  useMapEvents({
    click(e) {
      onSelect({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

// Helper component that pans the map smoothly when coordinates change externally (e.g. geolocation)
function MapRecenter({ center }) {
  const map = useMap();

  useEffect(() => {
    if (center && typeof center.lat === 'number' && typeof center.lng === 'number') {
      map.setView([center.lat, center.lng], Math.max(map.getZoom(), 14));
    }
  }, [center, map]);

  return null;
}

// Interactive OpenStreetMap picker with click-to-place, draggable marker, and GPS button
export default function LocationPicker({ initialCenter, position, onChange, error }) {
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState('');
  const [recenterTarget, setRecenterTarget] = useState(null);

  const mapCenter = position
    ? [position.lat, position.lng]
    : [initialCenter.lat, initialCenter.lng];

  function handleUseCurrentLocation() {
    setGeoError('');

    if (!navigator.geolocation) {
      setGeoError('Geolocation is not supported by your browser.');
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const nextCoords = {
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
        };
        onChange(nextCoords);
        setRecenterTarget(nextCoords);
        setLocating(false);
      },
      (err) => {
        setGeoError(err.message || 'Unable to fetch your current location.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-600">
          Click on the map to drop a pin, or drag the marker to adjust the pickup spot.
        </p>
        <button
          type="button"
          onClick={handleUseCurrentLocation}
          disabled={locating}
          className="px-3 py-1.5 rounded-lg border border-emerald-600 text-emerald-700 text-xs font-semibold hover:bg-emerald-50 disabled:opacity-60 transition-colors"
        >
          {locating ? 'Locating...' : 'Use my current location'}
        </button>
      </div>

      {geoError && (
        <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
          {geoError}
        </p>
      )}

      <div
        className={`h-64 sm:h-72 w-full rounded-xl overflow-hidden border ${
          error ? 'border-rose-400' : 'border-slate-300'
        }`}
      >
        <MapContainer
          center={mapCenter}
          zoom={13}
          scrollWheelZoom
          className="h-full w-full z-0"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <MapClickHandler
            onSelect={(coords) =>
              onChange({
                lat: Number(coords.lat.toFixed(6)),
                lng: Number(coords.lng.toFixed(6)),
              })
            }
          />

          {recenterTarget && <MapRecenter center={recenterTarget} />}

          {position && (
            <Marker
              position={[position.lat, position.lng]}
              draggable
              eventHandlers={{
                dragend(e) {
                  const markerLatLng = e.target.getLatLng();
                  onChange({
                    lat: Number(markerLatLng.lat.toFixed(6)),
                    lng: Number(markerLatLng.lng.toFixed(6)),
                  });
                },
              }}
            />
          )}
        </MapContainer>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        {position ? (
          <span className="text-emerald-700 font-medium">
            Selected pin: {position.lat.toFixed(5)}, {position.lng.toFixed(5)}
          </span>
        ) : (
          <span className="text-slate-500">No pin dropped yet (required).</span>
        )}
        {error && <span className="text-rose-600 font-medium">{error}</span>}
      </div>
    </div>
  );
}
