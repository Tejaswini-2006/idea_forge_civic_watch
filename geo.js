/**
 * geo.js
 * Geospatial intelligence, GPS acquisition, Mumbai Ward auto-detection,
 * and Haversine distance calculations for duplicate clustering.
 */

export const MUMBAI_WARDS = [
  {
    id: "Ward A",
    name: "Ward A (Colaba, Fort, Nariman Point)",
    lat: 18.9220,
    lng: 72.8347,
    hq: "Fort Municipal Office, Shahid Bhagat Singh Marg",
    officer: "Ward Officer M. Kulkarni"
  },
  {
    id: "Ward C",
    name: "Ward C (Marine Lines, Chira Bazaar, Bhuleshwar)",
    lat: 18.9482,
    lng: 72.8258,
    hq: "Chandanwadi Ward Office",
    officer: "Ward Officer S. Parab"
  },
  {
    id: "Ward D",
    name: "Ward D (Malabar Hill, Grant Road, Walkeshwar)",
    lat: 18.9633,
    lng: 72.8055,
    hq: "Nana Chowk, Grant Road (W)",
    officer: "Ward Officer P. Joshi"
  },
  {
    id: "Ward F/N",
    name: "Ward F/North (Matunga, Sion, Wadala)",
    lat: 19.0330,
    lng: 72.8634,
    hq: "Bhaudaji Road, Matunga",
    officer: "Ward Officer A. Shinde"
  },
  {
    id: "Ward G/N",
    name: "Ward G/North (Dadar, Dharavi, Mahim)",
    lat: 19.0390,
    lng: 72.8465,
    hq: "Harishchandra Yevale Marg, Dadar (W)",
    officer: "Ward Officer R. Jadhav"
  },
  {
    id: "Ward H/W",
    name: "Ward H/West (Bandra West, Khar, Santacruz)",
    lat: 19.0596,
    lng: 72.8295,
    hq: "St. Martin Road, Bandra (W)",
    officer: "Ward Officer V. Rane"
  },
  {
    id: "Ward K/E",
    name: "Ward K/East (Andheri East, Vile Parle, Chakala)",
    lat: 19.1136,
    lng: 72.8697,
    hq: "Azad Road, Gundavali, Andheri (E)",
    officer: "Ward Officer S. Chavan"
  },
  {
    id: "Ward K/W",
    name: "Ward K/West (Andheri West, Juhu, Versova)",
    lat: 19.1197,
    lng: 72.8468,
    hq: "Paliram Path, Andheri (W)",
    officer: "Ward Officer K. Sawant"
  },
  {
    id: "Ward L",
    name: "Ward L (Kurla, Sakinaka, Chunabhatti)",
    lat: 19.0688,
    lng: 72.8856,
    hq: "LBS Marg, Kurla (W)",
    officer: "Ward Officer N. Patil"
  },
  {
    id: "Ward S",
    name: "Ward S (Powai, Bhandup, Kanjurmarg)",
    lat: 19.1257,
    lng: 72.9158,
    hq: "LBS Marg, Bhandup (W)",
    officer: "Ward Officer T. More"
  }
];

/**
 * Calculates distance between two GPS coordinates in meters using the Haversine formula
 * @param {number} lat1 
 * @param {number} lon1 
 * @param {number} lat2 
 * @param {number} lon2 
 * @returns {number} distance in meters
 */
export function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Radius of Earth in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

/**
 * Detects the nearest Mumbai administrative ward based on GPS coordinates
 * @param {number} lat 
 * @param {number} lng 
 * @returns {object} nearest ward object
 */
export function detectNearestWard(lat, lng) {
  if (typeof lat !== "number" || typeof lng !== "number") {
    return MUMBAI_WARDS[0];
  }

  let minDistance = Infinity;
  let nearestWard = MUMBAI_WARDS[0];

  for (const ward of MUMBAI_WARDS) {
    const dist = calculateDistanceMeters(lat, lng, ward.lat, ward.lng);
    if (dist < minDistance) {
      minDistance = dist;
      nearestWard = ward;
    }
  }

  return {
    ...nearestWard,
    distanceMeters: minDistance
  };
}

/**
 * Obtains current user GPS position via navigator.geolocation
 * @returns {Promise<{lat: number, lng: number, accuracy: number}>}
 */
export function getCurrentCoordinates() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not supported by your browser"));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy
        });
      },
      (err) => {
        reject(err);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000
      }
    );
  });
}

/**
 * Computes a simple alphanumeric geohash approximation for geographic indexing
 * @param {number} lat 
 * @param {number} lng 
 * @param {number} precision 
 * @returns {string}
 */
export function encodeGeohash(lat, lng, precision = 7) {
  const BITS = [16, 8, 4, 2, 1];
  const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";
  let isEven = true;
  let latMin = -90, latMax = 90;
  let lonMin = -180, lonMax = 180;
  let bit = 0;
  let ch = 0;
  let geohash = "";

  while (geohash.length < precision) {
    let mid;
    if (isEven) {
      mid = (lonMin + lonMax) / 2;
      if (lng > mid) {
        ch |= BITS[bit];
        lonMin = mid;
      } else {
        lonMax = mid;
      }
    } else {
      mid = (latMin + latMax) / 2;
      if (lat > mid) {
        ch |= BITS[bit];
        latMin = mid;
      } else {
        latMax = mid;
      }
    }
    isEven = !isEven;
    if (bit < 4) {
      bit++;
    } else {
      geohash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return geohash;
}


/**
 * Key Mumbai Civic & Vulnerable Infrastructure POIs (Hospitals, Schools, Transit Hubs)
 * Used to calculate context-aware priority bonuses for civic grievances.
 */
export const MUMBAI_CRITICAL_POIS = [
  { name: "Bombay Hospital & Medical Research Centre", type: "hospital", lat: 18.9392, lng: 72.8291, bonus: 4 },
  { name: "KEM Hospital, Parel", type: "hospital", lat: 19.0028, lng: 72.8428, bonus: 4 },
  { name: "Lilavati Hospital, Bandra", type: "hospital", lat: 19.0514, lng: 72.8292, bonus: 4 },
  { name: "St. Xavier's High School, Fort", type: "school", lat: 18.9431, lng: 72.8317, bonus: 3 },
  { name: "St. Stanislaus High School, Bandra", type: "school", lat: 19.0560, lng: 72.8310, bonus: 3 },
  { name: "Dadar Central Railway Station", type: "transit", lat: 19.0178, lng: 72.8478, bonus: 3 },
  { name: "Chhatrapati Shivaji Maharaj Terminus (CSMT)", type: "transit", lat: 18.9398, lng: 72.8354, bonus: 3 },
  { name: "Andheri Metro Station Hub", type: "transit", lat: 19.1197, lng: 72.8464, bonus: 3 }
];

/**
 * Calculates context-aware proximity priority bonus within 250m of critical infrastructure
 * @param {number} lat 
 * @param {number} lng 
 * @returns {object}
 */
export function calculateProximityBonus(lat, lng) {
  if (typeof lat !== "number" || typeof lng !== "number") {
    return { bonus: 0, explanation: "" };
  }

  let highestBonus = 0;
  let closestPoi = null;
  let minDistance = Infinity;

  for (const poi of MUMBAI_CRITICAL_POIS) {
    const dist = calculateDistanceMeters(lat, lng, poi.lat, poi.lng);
    if (dist <= 300) {
      if (dist < minDistance) {
        minDistance = dist;
        closestPoi = poi;
        highestBonus = poi.bonus;
      }
    }
  }

  if (closestPoi) {
    return {
      bonus: highestBonus,
      poiName: closestPoi.name,
      poiType: closestPoi.type,
      distanceMeters: minDistance,
      explanation: `+${highestBonus} proximity bonus (${minDistance}m from ${closestPoi.name})`
    };
  }

  return { bonus: 0, explanation: "" };
}
