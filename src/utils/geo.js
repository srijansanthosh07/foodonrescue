// Geographic and time-formatting helpers used across dashboards

const EARTH_RADIUS_KM = 6371;

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

/**
 * Calculate the straight-line distance (in kilometers) between two lat/lng points
 * using the Haversine formula. Returns null if any coordinate is missing.
 */
export function haversineKm(lat1, lng1, lat2, lng2) {
  if (
    typeof lat1 !== 'number' ||
    typeof lng1 !== 'number' ||
    typeof lat2 !== 'number' ||
    typeof lng2 !== 'number'
  ) {
    return null;
  }

  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/**
 * Format remaining time until expiry (e.g., "expires in 2h 15m") and flag
 * whether less than 1 hour remains so the UI can highlight it in red.
 */
export function getExpiryCountdown(expiresAt, nowMs = Date.now()) {
  if (!expiresAt) {
    return { text: 'expiry unknown', isUrgent: false, isExpired: false };
  }

  const diffMs = new Date(expiresAt).getTime() - nowMs;
  if (diffMs <= 0) {
    return { text: 'expired', isUrgent: true, isExpired: true };
  }

  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  let text;
  if (hours > 0) {
    text = `expires in ${hours}h ${minutes}m`;
  } else {
    text = `expires in ${Math.max(1, minutes)}m`;
  }

  return {
    text,
    isUrgent: diffMs < 60 * 60 * 1000, // under 1 hour
    isExpired: false,
  };
}

/**
 * Format remaining time for a 15-minute volunteer assignment request window.
 * Flags isUrgent when under 3 minutes remain so the UI can show it in red.
 */
export function getAssignmentCountdown(requestedAt, nowMs = Date.now(), timeoutMinutes = 15) {
  if (!requestedAt) {
    return { text: '', isUrgent: false, isTimedOut: false };
  }

  const deadlineMs = new Date(requestedAt).getTime() + timeoutMinutes * 60 * 1000;
  const diffMs = deadlineMs - nowMs;

  if (diffMs <= 0) {
    return { text: '0m 00s', isUrgent: true, isTimedOut: true };
  }

  const totalSeconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const paddedSeconds = String(seconds).padStart(2, '0');

  return {
    text: `${minutes}m ${paddedSeconds}s left`,
    isUrgent: diffMs < 3 * 60 * 1000, // red when under 3 minutes
    isTimedOut: false,
  };
}
