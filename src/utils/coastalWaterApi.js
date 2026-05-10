function milesBetween(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingToCardinal(deg) {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(deg / 45) % 8];
}

function bearingBetween(lat1, lon1, lat2, lon2) {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const lonA = (lon1 * Math.PI) / 180;
  const lonB = (lon2 * Math.PI) / 180;

  const y = Math.sin(lonB - lonA) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(lonB - lonA);

  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function cToF(c) {
  const n = Number(c);
  if (!Number.isFinite(n)) return null;
  return Math.round(((n * 9) / 5 + 32) * 10) / 10;
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Coastal request failed: ${res.status}`);
  return res.text();
}

function parseNdbcLatest(text) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const headerLine = lines.find((line) => line.startsWith("#YY"));
  const dataLine = lines.find((line) => /^\d{4}\s+\d{1,2}\s+\d{1,2}/.test(line));

  if (!headerLine || !dataLine) return null;

  const headers = headerLine.replace(/^#/, "").trim().split(/\s+/);
  const values = dataLine.trim().split(/\s+/);

  const row = {};
  headers.forEach((key, index) => {
    row[key] = values[index];
  });

  const num = (key) => {
    const v = Number(row[key]);
    if (!Number.isFinite(v) || v === 99 || v === 999 || v === 9999) return null;
    return v;
  };

  return {
    observedAt: `${row.YY}-${String(row.MM).padStart(2, "0")}-${String(row.DD).padStart(2, "0")}T${String(row.hh).padStart(2, "0")}:${String(row.mm).padStart(2, "0")}:00Z`,
    windMph: num("WSPD") != null ? Math.round(num("WSPD") * 2.23694 * 10) / 10 : null,
    windDirectionDeg: num("WDIR"),
    gustMph: num("GST") != null ? Math.round(num("GST") * 2.23694 * 10) / 10 : null,
    waveHeightFt: num("WVHT") != null ? Math.round(num("WVHT") * 3.28084 * 10) / 10 : null,
    dominantWavePeriodSec: num("DPD"),
    pressureHpa: num("PRES"),
    airTempF: cToF(num("ATMP")),
    waterTempF: cToF(num("WTMP")),
  };
}



const COOPS_TIDE_STATIONS = [
  { id: "8729108", name: "Panama City", lat: 30.1523, lon: -85.6669 },
  { id: "8729840", name: "Pensacola", lat: 30.4044, lon: -87.2112 },
  { id: "8735180", name: "Dauphin Island", lat: 30.25, lon: -88.075 },
  { id: "8720218", name: "Mayport", lat: 30.3982, lon: -81.4279 },
  { id: "8665530", name: "Charleston", lat: 32.7808, lon: -79.9236 },
  { id: "8656483", name: "Beaufort, Duke Marine Lab", lat: 34.7173, lon: -76.6707 },
];

let cachedNdbcStations = null;

async function loadNdbcStations() {
  if (cachedNdbcStations) {
    return cachedNdbcStations;
  }

  const url = "http://localhost:3001/api/noaa/ndbc-stations";

  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Failed loading NOAA stations: ${res.status}`);
  }

  const text = await res.text();

  const parser = new DOMParser();
  const xml = parser.parseFromString(text, "text/xml");

  const stations = [...xml.querySelectorAll("station")]
    .map((node) => ({
      id: node.getAttribute("id"),
      name: node.getAttribute("name"),
      lat: Number(node.getAttribute("lat")),
      lon: Number(node.getAttribute("lon")),
    }))
    .filter(
      (s) =>
        s.id &&
        Number.isFinite(s.lat) &&
        Number.isFinite(s.lon),
    );

  cachedNdbcStations = stations;

  return stations;
}

function stationSupportsWaveData(text) {
  return (
    text.includes("WVHT") ||
    text.includes("SwH") ||
    text.includes("DPD")
  );
}

async function nearestNdbcStation(lat, lon, maxMiles = 180) {
  const stations = await loadNdbcStations();

  const ranked = stations
    .map((station) => ({
      ...station,
      distanceMiles: milesBetween(lat, lon, station.lat, station.lon),
    }))
    .filter((s) => s.distanceMiles <= maxMiles)
    .sort((a, b) => a.distanceMiles - b.distanceMiles);

  let nearestWorkingStation = null;

  for (const station of ranked.slice(0, 25)) {
    try {
      const url = `http://localhost:3001/api/noaa/ndbc/${station.id}`;
      const text = await fetchText(url);
      const parsed = parseNdbcLatest(text);

      if (!parsed) continue;

      if (!nearestWorkingStation) {
        nearestWorkingStation = station;
      }

      if (parsed.waveHeightFt != null || parsed.dominantWavePeriodSec != null) {
        return station;
      }
    } catch {
      // skip stations with no realtime file
    }
  }

  return nearestWorkingStation;
}

function nearestCoopsTideStation(lat, lon, maxMiles = 90) {
  const ranked = COOPS_TIDE_STATIONS.map((station) => ({
    ...station,
    distanceMiles: milesBetween(lat, lon, station.lat, station.lon),
  })).sort((a, b) => a.distanceMiles - b.distanceMiles);

  return ranked[0]?.distanceMiles <= maxMiles ? ranked[0] : null;
}


function formatNoaaDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function getTideDirection(predictions) {
  if (!Array.isArray(predictions) || predictions.length < 2) return null;

  const now = new Date();

  const closest = predictions
    .map((row) => ({
      time: new Date(row.t.replace(" ", "T")),
      value: Number(row.v),
    }))
    .filter((row) => Number.isFinite(row.value))
    .sort((a, b) => Math.abs(a.time - now) - Math.abs(b.time - now));

  if (closest.length < 2) return null;

  if (closest[1].value > closest[0].value) return "Incoming";
  if (closest[1].value < closest[0].value) return "Outgoing";
  return "Slack / steady";
}

export async function getCoastalWaterData(lat, lon) {
  const station = await nearestNdbcStation(lat, lon);

  if (!station) {
    return {
      found: false,
      source: "NOAA NDBC",
      note: "No nearby coastal buoy found.",
    };
  }

  const url = `http://localhost:3001/api/noaa/ndbc/${station.id}`;
  const text = await fetchText(url);
  const latest = parseNdbcLatest(text);

  
 
  console.log("NDBC TEXT", text);
console.log("PARSED NDBC", latest);

console.log("WVHT RAW:", latest?.waveHeightFt);
console.log("DPD RAW:", latest?.dominantWavePeriodSec);

  if (!latest) {
    return {
      found: false,
      source: "NOAA NDBC",
      station,
      note: "Station found, but no recent observation parsed.",
    };
  }

  latest.rawText = text.slice(0, 500);

  return {
    found: true,
    source: "NOAA NDBC",
    station,
    summary: {
      station: station.name,
      stationId: station.id,
      distanceMiles: Math.round(station.distanceMiles * 10) / 10,
      buoyDistanceMiles: Math.round(station.distanceMiles),
buoyDirection: bearingToCardinal(
  bearingBetween(lat, lon, station.lat, station.lon),
),
waveSourceLabel: station.distanceMiles <= 50 ? "Waves" : "Offshore Waves",
      waterTemp: latest.waterTempF,
      waterTempSource: "NOAA NDBC buoy",
      wind: latest.windMph,
      gust: latest.gustMph,
      waveHeightFt: latest.waveHeightFt,
      wavePeriodSec: latest.dominantWavePeriodSec,
      pressure: latest.pressureHpa,
      airTemp: latest.airTempF,
      observedAt: latest.observedAt,
    },
    raw: {
  ...latest,
  rawText: text.slice(0, 500),
},
  };
}

export async function getTideData(lat, lon) {
  const station = nearestCoopsTideStation(lat, lon);

  if (!station) {
    return {
      found: false,
      source: "NOAA CO-OPS",
      note: "No nearby tide station found.",
    };
  }

  const now = new Date();
  const start = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const end = new Date(now.getTime() + 9 * 60 * 60 * 1000);

  const url =
    `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter` +
    `?begin_date=${formatNoaaDate(start)}` +
    `&end_date=${formatNoaaDate(end)}` +
    `&station=${station.id}` +
    `&product=predictions` +
    `&datum=MLLW` +
    `&time_zone=lst_ldt` +
    `&interval=h` +
    `&units=english` +
    `&format=json`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`NOAA tide failed: ${res.status}`);

  const data = await res.json();
  const predictions = data.predictions || [];

  return {
    found: predictions.length > 0,
    source: "NOAA CO-OPS",
    station,
    summary: {
      station: station.name,
      stationId: station.id,
      distanceMiles: Math.round(station.distanceMiles * 10) / 10,
      tideDirection: getTideDirection(predictions),
      predictions,
    },
  };
}