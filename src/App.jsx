import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import Map, { Marker, Popup } from "react-map-gl/mapbox";
import exifr from "exifr";
import "./index.css";
import FishIdPanel from "./FishIdPanel";
import { lookupWaterbody } from "./services/waterbodyLookup";
import {
  getSimpleBiteScore,
  estimateWaterTempFromWeather,
} from "./utils/fishing";
import { getWeatherIcon, getWeatherText } from "./utils/weather";
import PredictionPage from "./PredictionPage";
import LurePicker from "./LurePicker";
import AddFishPage from "./pages/AddFishPage";
import {
  getMoonPhase,
  getMoonIcon,
  cToF,
  distanceMiles,
  windToCardinal,
} from "./utils/fishing";
import {
  getAllWaterData,
  getManagedWaterData,
  getTvaWaterData,
  getEstimatedWaterTemp,
  getUsgsWaterData,
  getNoaaWaterData,
  getUsaceWaterData,
} from "./utils/waterApi";
import {
  getWeather,
  getCurrentWeather,
  reverseGeocodeLocation,
  getRecentWeatherAverages,
} from "./utils/weatherApi";
import { getPatternStrength } from "./utils/patterns";
import { getHydroDataForCatch } from "./hydroData";
import { Geolocation } from "@capacitor/geolocation";
import { App as CapacitorApp } from "@capacitor/app";
import splashImage from "./assets/bitelogic-splash.png";
import splashVideo from "./assets/bitelogic-splash.mp4";

function getConditionClass(code) {
  if (code === 0) return "sunny";
  if ([1, 2].includes(code)) return "partly";
  if ([3].includes(code)) return "cloudy";
  if ([45, 48].includes(code)) return "fog";
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return "rain";
  if ([71, 73, 75, 85, 86].includes(code)) return "snow";
  if ([95, 96, 99].includes(code)) return "storm";
  return "default";
}

function buildWeatherOutlook(condition, high, wind, rain) {
  if (Number(rain) > 0.2) {
    return `${condition} today. High near ${high}°. Rain may change runoff around creeks and stained water.`;
  }

  if (Number(wind) > 15) {
    return `${condition} today. High near ${high}°. Wind will be the biggest factor.`;
  }

  return `${condition} today. High near ${high}°. Conditions look steady through the day.`;
}

function buildFishingOutlook(score, wind, pressure, clouds) {
  if (score >= 80)
    return "Strong bite potential. Check wind-blown banks, current seams, and shaded cover.";
  if (score >= 65)
    return "Good bite window. Moderate wind and stable weather should help.";
  if (score >= 45)
    return "Average bite. Focus on structure and slower presentations.";
  return "Tougher conditions. Look for deeper water, shade, or current.";
}

function buildPatternHint(score, wind, clouds, rain) {
  if (Number(rain) > 0.2) {
    return "Rain and runoff can push bait toward drains, creek mouths, and stained water edges.";
  }

  if (Number(wind) >= 8) {
    return "Wind should position bait. Start on wind-blown points, grass lines, and banks with chop.";
  }

  if (Number(clouds) > 60) {
    return "Cloud cover may keep fish roaming longer. Try moving baits before slowing down.";
  }

  if (score >= 70) {
    return "Stable conditions. Start shallow early, then check shade, docks, and deeper breaks.";
  }

  return "No major trigger showing yet. Fish high-confidence areas and let your catch history guide the pattern.";
}

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

const forecast = [
  { day: "Sat", date: "25", icon: "🌧️", high: "76°", low: "61°", rain: "96%" },
  { day: "Sun", date: "26", icon: "🌤️", high: "83°", low: "63°", rain: "20%" },
  { day: "Mon", date: "27", icon: "🌤️", high: "80°", low: "62°", rain: "6%" },
  { day: "Tue", date: "28", icon: "☁️", high: "78°", low: "64°", rain: "24%" },
  { day: "Wed", date: "29", icon: "⛈️", high: "81°", low: "59°", rain: "75%" },
  { day: "Thu", date: "30", icon: "🌥️", high: "77°", low: "56°", rain: "24%" },
];

const starterCatches = [
  {
    id: 1,
    species: "Largemouth Bass",
    size: "4.2 lb",
    lake: "Lake Harding",
    bait: "Chatterbait",
    date: new Date().toISOString(),
    notes: "Wind-blown grass edge",
    photo: null,
    gps: null,
    weather: null,
  },
  {
    id: 2,
    species: "Spotted Bass",
    size: "2.1 lb",
    lake: "Goat Rock",
    bait: "Shaky Head",
    date: new Date().toISOString(),
    notes: "Rocky point in shade",
    photo: null,
    gps: null,
    weather: null,
  },
];

function formatCatchDate(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return dateValue || "No date";
  return date.toLocaleString();
}

function fileToCompressedDataUrl(file, maxWidth = 1200, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const img = new Image();

      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);

        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        resolve(canvas.toDataURL("image/jpeg", quality));
      };

      img.onerror = reject;
      img.src = reader.result;
    };

    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const knownWaterAreas = [
  {
    name: "Goat Rock Lake",
    minLat: 32.58,
    maxLat: 32.66,
    minLon: -85.08,
    maxLon: -84.95,
  },
  {
    name: "Lake Harding",
    minLat: 32.67,
    maxLat: 32.78,
    minLon: -85.18,
    maxLon: -85.02,
  },
  {
    name: "Lake Oliver",
    minLat: 32.48,
    maxLat: 32.54,
    minLon: -85.03,
    maxLon: -84.94,
  },
];

function getLakeFromBounds(lat, lon) {
  const match = knownWaterAreas.find(
    (lake) =>
      lat >= lake.minLat &&
      lat <= lake.maxLat &&
      lon >= lake.minLon &&
      lon <= lake.maxLon,
  );

  return match?.name || null;
}

function getSavedWaterName(lat, lon) {
  try {
    const saved = JSON.parse(localStorage.getItem("water-corrections") || "[]");

    for (const item of saved) {
      const dist = distanceMiles(lat, lon, item.lat, item.lon);

      if (dist < 2) {
        return item.name; // within 2 miles → reuse it
      }
    }
  } catch {}

  return null;
}

function saveWaterName(lat, lon, name) {
  try {
    const saved = JSON.parse(localStorage.getItem("water-corrections") || "[]");

    saved.push({ lat, lon, name });

    localStorage.setItem("water-corrections", JSON.stringify(saved));
  } catch (e) {
    console.error("Failed to save water correction", e);
  }
}

async function getNhdWaterName(lat, lon) {
  try {
    const buffer = 0.03; // 🔥 bigger search area (~2 miles)

    const xmin = lon - buffer;
    const ymin = lat - buffer;
    const xmax = lon + buffer;
    const ymax = lat + buffer;

    const url =
      `https://hydro.nationalmap.gov/arcgis/rest/services/NHDPlus_HR/MapServer/9/query` +
      `?geometry=${xmin},${ymin},${xmax},${ymax}` +
      `&geometryType=esriGeometryEnvelope` +
      `&inSR=4326` +
      `&spatialRel=esriSpatialRelIntersects` +
      `&outFields=GNIS_NAME,FTYPE` +
      `&returnGeometry=false` +
      `&f=json`;

    const res = await fetch(url);
    const data = await res.json();

    console.log("NHD DEBUG:", data);

    const features = data.features || [];

    if (!features.length) return null;

    // 🔥 prioritize actual lakes/reservoirs first
    const preferred = features.find(
      (f) =>
        f.attributes?.GNIS_NAME &&
        (f.attributes?.FTYPE === "LakePond" ||
          f.attributes?.FTYPE === "Reservoir"),
    );

    if (preferred?.attributes?.GNIS_NAME) {
      return preferred.attributes.GNIS_NAME;
    }

    // fallback to anything named
    const any = features.find((f) => f.attributes?.GNIS_NAME);
    return any?.attributes?.GNIS_NAME || null;
  } catch (e) {
    console.error("NHD failed", e);
    return null;
  }
}

async function getMapboxWaterName(lat, lon) {
  try {
    const url =
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lon},${lat}.json` +
      `?types=poi,place,locality,neighborhood` +
      `&limit=10` +
      `&access_token=${MAPBOX_TOKEN}`;

    const res = await fetch(url);
    const data = await res.json();

    console.log("MAPBOX WATER RESPONSE:", data);

    const features = data.features || [];

    const water = features.find((item) => {
      const text = `${item.text || ""} ${item.place_name || ""}`.toLowerCase();

      return (
        text.includes("lake") ||
        text.includes("reservoir") ||
        text.includes("pond") ||
        text.includes("river") ||
        text.includes("creek")
      );
    });

    return water?.text || null;
  } catch (e) {
    console.error("Mapbox water lookup failed", e);
    return null;
  }
}

async function getOsmWaterName(lat, lon) {
  try {
    const query = `
      [out:json][timeout:15];
      (
        way(around:3000,${lat},${lon})["natural"="water"]["name"];
        relation(around:3000,${lat},${lon})["natural"="water"]["name"];
        way(around:3000,${lat},${lon})["water"="reservoir"]["name"];
        relation(around:3000,${lat},${lon})["water"="reservoir"]["name"];
        way(around:3000,${lat},${lon})["waterbody:name"];
        relation(around:3000,${lat},${lon})["waterbody:name"];
      );
      out tags center;
    `;

    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: query,
    });

    const data = await res.json();
    console.log("OSM WATER RESPONSE:", data);

    const names = (data.elements || [])
      .map((item) => item.tags?.name || item.tags?.["waterbody:name"])
      .filter(Boolean);

    return names[0] || null;
  } catch (e) {
    console.error("OSM water lookup failed", e);
    return null;
  }
}
async function getUsgsPlaceName(lat, lon) {
  try {
    const url = `https://geonames.usgs.gov/apex/f?p=138:1:0::NO::P1_LAT,P1_LON:${lat},${lon}`;

    const res = await fetch(url);
    const text = await res.text();

    console.log("USGS RAW RESPONSE:", text);

    // simple extract (GNIS is old-school HTML)
    const match = text.match(/<strong>(.*?)<\/strong>/);

    return match ? match[1] : null;
  } catch (e) {
    console.error("USGS name lookup failed", e);
    return null;
  }
}
async function getLakeName(lat, lon) {
  try {
    const official = await lookupWaterbody(lat, lon);

    console.log("GET LAKE NAME LOOKUP:", official);

    if (official?.primaryWaterbody) {
      return official.primaryWaterbody;
    }

    if (official?.secondaryFeature) {
      return official.secondaryFeature;
    }
  } catch (e) {
    console.log("getLakeName failed", e);
  }

  const saved = getSavedWaterName(lat, lon);
  if (saved) return saved;

  return "Unknown water";
}

function getFileKey(file) {
  if (!file) return null;
  return `${file.name}-${file.size}-${file.lastModified}`;
}

function saveCorrection(key, species) {
  if (!key) return;

  try {
    const saved = JSON.parse(localStorage.getItem("fish-corrections") || "{}");
    saved[key] = species;
    localStorage.setItem("fish-corrections", JSON.stringify(saved));
  } catch (e) {
    console.error("Failed to save correction", e);
  }
}

function getCorrection(key) {
  if (!key) return null;

  try {
    const saved = JSON.parse(localStorage.getItem("fish-corrections") || "{}");
    return saved[key] || null;
  } catch {
    return null;
  }
}

function saveTrainingExample(fish, species) {
  if (!fish?.photo || !species) return;

  try {
    const saved = JSON.parse(
      localStorage.getItem("fish-training-library") || "[]",
    );

    saved.push({
      species,
      photo: fish.photo,
      photoKey: fish.photoKey,
      lake: fish.lake,
      gps: fish.gps,
      confirmedAt: new Date().toISOString(),
    });

    localStorage.setItem("fish-training-library", JSON.stringify(saved));
  } catch (e) {
    console.error("Failed to save training example", e);
  }
}

function getSpeciesMemory() {
  try {
    const examples = JSON.parse(
      localStorage.getItem("fish-training-library") || "[]",
    );

    const memory = {};

    examples.forEach((item) => {
      if (!item.species) return;

      if (!memory[item.species]) {
        memory[item.species] = {
          count: 0,
        };
      }

      memory[item.species].count += 1;
    });

    return memory;
  } catch {
    return {};
  }
}

function getTrainingExamples() {
  try {
    return JSON.parse(localStorage.getItem("fish-training-library") || "[]");
  } catch {
    return [];
  }
}

function getSavedHomeLocationMode() {
  return localStorage.getItem("fish-home-location-mode") || "current";
}

function getSavedDefaultLocation() {
  try {
    const saved = localStorage.getItem("fish-home-default-location");
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

function formatHour(time) {
  return new Date(time).toLocaleTimeString([], {
    hour: "numeric",
  });
}

function formatSunTime(time) {
  if (!time) return "--";
  return new Date(time).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}
function estimateHomeWaterTemp(current) {
  return (
    estimateWaterTempFromWeather({
      temp: current?.temperature_2m,
      feelsLike: current?.apparent_temperature,
      wind: current?.wind_speed_10m,
      cloud: current?.cloud_cover,
      rain: current?.rain ?? current?.precipitation,
    }) ?? "--"
  );
}

function getWeatherVideo(code) {
  if (code === 0) return "/weather-videos/lake-sunny.mp4";
  if ([1, 2].includes(code)) return "/weather-videos/lake-sunny.mp4";
  if (code === 3) return "/weather-videos/lake-cloudy.mp4";
  if ([45, 48].includes(code)) return "/weather-videos/lake-fog.mp4";
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) {
    return "/weather-videos/lake-rain.mp4";
  }
  if ([95, 96, 99].includes(code)) return "/weather-videos/lake-storm.mp4";
  if ([71, 73, 75, 77, 85, 86].includes(code))
    return "/weather-videos/lake-snow.mp4";

  return "/weather-videos/lake-sunny.mp4";
}

function Home({ setPage }) {
  const videoRef = useRef(null);

  const [homeWeather, setHomeWeather] = useState(null);
  const [locationName, setLocationName] = useState("Phenix City, Alabama");
  const [weatherStatus, setWeatherStatus] = useState("Loading weather...");
  const [selectedDayIndex, setSelectedDayIndex] = useState(0);

  async function loadWeatherFor(lat, lon, label) {
    try {
      const weather = await getCurrentWeather(lat, lon);
      setHomeWeather(weather);
      setLocationName(label || (await reverseGeocodeLocation(lat, lon)));
      setWeatherStatus("Updated now");
    } catch (e) {
      console.log("Home weather failed", e);
      setWeatherStatus("Weather unavailable");
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadHomeLocation() {
      const fallback = () => {
        if (cancelled) return;
        setWeatherStatus("Using default location");
        loadWeatherFor(32.47098, -85.00077, "Phenix City, Alabama");
      };

      try {
        const permission = await Geolocation.requestPermissions();

        if (
          permission.location !== "granted" &&
          permission.coarseLocation !== "granted"
        ) {
          fallback();
          return;
        }

        const position = await Geolocation.getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 10000,
        });

        if (cancelled) return;

        await loadWeatherFor(
          position.coords.latitude,
          position.coords.longitude,
        );
      } catch (e) {
        console.log("Capacitor location failed", e);
        fallback();
      }
    }

    loadHomeLocation();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!navigator.geolocation) {
    fallback();
    return;
  }

  const current = homeWeather?.current;
  const daily = homeWeather?.daily;
  const hourly = homeWeather?.hourly;

  const code = current?.weather_code;
  console.log("CURRENT WEATHER CODE:", code, current);
  const temp =
    current?.temperature_2m != null ? Math.round(current.temperature_2m) : "--";
  const feels =
    current?.apparent_temperature != null
      ? Math.round(current.apparent_temperature)
      : "--";
  const condition = getWeatherText(code);
  const conditionClass = getConditionClass(code);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    function restartVideo() {
      video.pause();
      video.load();

      setTimeout(() => {
        video.playbackRate = 0.75;
        video.defaultPlaybackRate = 0.75;
        video.play().catch(() => {});
      }, 150);
    }

    restartVideo();

    let listener;

    CapacitorApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive) {
        restartVideo();
      }
    }).then((handle) => {
      listener = handle;
    });

    return () => {
      if (listener) listener.remove();
    };
  }, [code]);

  const selectedDay = daily
    ? {
        date: daily.time?.[selectedDayIndex],
        code: daily.weather_code?.[selectedDayIndex],
        high: Math.round(daily.temperature_2m_max?.[selectedDayIndex] ?? 0),
        low: Math.round(daily.temperature_2m_min?.[selectedDayIndex] ?? 0),
        rainChance: daily.precipitation_probability_max?.[selectedDayIndex],
        sunrise: daily.sunrise?.[selectedDayIndex],
        sunset: daily.sunset?.[selectedDayIndex],
        wind: daily.wind_speed_10m_max?.[selectedDayIndex],
      }
    : null;

  const selectedDateKey = selectedDay?.date;
  const now = new Date();

  const selectedHourly = hourly?.time
    ? hourly.time
        .map((time, index) => ({
          time,
          temp: hourly.temperature_2m?.[index],
          feels: hourly.apparent_temperature?.[index],
          code: hourly.weather_code?.[index],
          rainChance: hourly.precipitation_probability?.[index],
          rain: hourly.precipitation?.[index],
          wind: hourly.wind_speed_10m?.[index],
          windDir: hourly.wind_direction_10m?.[index],
          humidity: hourly.relative_humidity_2m?.[index],
          pressure: hourly.pressure_msl?.[index],
        }))
        .filter((hour) => {
          if (!selectedDateKey) return false;

          const hourDate = new Date(hour.time);

          if (selectedDayIndex === 0) {
            return hourDate >= now;
          }

          return hour.time.startsWith(selectedDateKey);
        })
        .slice(0, selectedDayIndex === 0 ? 12 : 24)
    : [];

  const wind = current?.wind_speed_10m ?? "--";
  const humidity = current?.relative_humidity_2m ?? "--";
  const pressure = current?.pressure_msl ?? "--";
  const rain = current?.precipitation ?? current?.rain ?? "--";
  const clouds = current?.cloud_cover ?? "--";

  return (
    <main className={`weatherHomeFixed ${conditionClass}`}>
      <section className="weatherHeroFixed">
        <div className="lakeVideoWrap">
          <video
            ref={videoRef}
            className="lakeVideo"
            src={code == null ? "" : getWeatherVideo(code)}
            autoPlay
            muted
            loop
            playsInline
          />

          <div className="lakeVideoOverlay"></div>
        </div>
        <div className="weatherTopFixed">
          <button onClick={() => setPage("home")} className="fishLogoFixed">
            🐟
          </button>
          <button className="locationFixed">📍 {locationName}</button>
          <button onClick={() => setPage("settings")} className="settingsFixed">
            ⚙️
          </button>
        </div>

        <div className="mainConditionFixed">
          <div>
            <p>
              {getWeatherIcon(code)} {condition}
            </p>
            <h1>{temp}°</h1>

            <h2>Feels like {feels}°</h2>

            <div className="biteScoreHero">
              🎯 Bite Score:{" "}
              {getSimpleBiteScore({
                wind: Number(wind),
                pressure: Number(pressure),
                rain: Number(rain),
                clouds: Number(clouds),
                temp: Number(temp),
              })}
              /100
            </div>

            <span>{weatherStatus}</span>
          </div>
        </div>
      </section>

      <section className="outlookFixed">
        <h2>Today's Outlook</h2>
        <p>
          {condition} today. High near {selectedDay?.high ?? "--"}°.
          {Number(wind) > 12
            ? " Wind will be a major factor on the water."
            : " Conditions look steady through the day."}
        </p>

        <div className="hourStripFixed">
          {selectedHourly
            .slice(0, selectedDayIndex === 0 ? 8 : 24)
            .map((hour, i) => (
              <div key={i}>
                <span>{formatHour(hour.time)}</span>
                <b>{getWeatherIcon(hour.code)}</b>
                <strong>{Math.round(hour.temp ?? 0)}°</strong>
                <small>💧 {hour.rainChance ?? 0}%</small>
                <small>💨 {Math.round(hour.wind ?? 0)} mph</small>
              </div>
            ))}
        </div>
      </section>

      <section className="dailyFixed">
        {(daily?.time || []).slice(0, 7).map((day, i) => (
          <button
            key={day}
            className={selectedDayIndex === i ? "active" : ""}
            onClick={() => setSelectedDayIndex(i)}
          >
            <strong>
              {new Date(`${day}T12:00:00`).toLocaleDateString(undefined, {
                weekday: "short",
              })}
            </strong>
            <span>{getWeatherIcon(daily.weather_code?.[i])}</span>
            <b>{Math.round(daily.temperature_2m_max?.[i] ?? 0)}°</b>
            <small>{Math.round(daily.temperature_2m_min?.[i] ?? 0)}°</small>
            <em>💧 {daily.precipitation_probability_max?.[i] ?? 0}%</em>
          </button>
        ))}
      </section>

      <section className="weatherPanelFixed">
        <h2>Current Details</h2>
        <div className="metricGridFixed">
          <div>
            <strong>{wind}</strong>
            <span>Wind mph</span>
          </div>
          <div>
            <strong>{humidity}%</strong>
            <span>Humidity</span>
          </div>
          <div>
            <strong>{pressure}</strong>
            <span>Pressure</span>
          </div>
          <div>
            <strong>{clouds}%</strong>
            <span>Clouds</span>
          </div>
          <div>
            <strong>{rain}</strong>
            <span>Rain in</span>
          </div>
          <div>
            <strong>{estimateHomeWaterTemp(current)}°</strong>
            <span>Est. Water</span>
          </div>
        </div>
      </section>

      <section className="weatherPanelFixed">
        <h2>Sun & Moon</h2>
        <div className="sunMoonFixed">
          <div>
            <strong>{formatSunTime(selectedDay?.sunrise)}</strong>
            <span>Sunrise</span>
          </div>
          <div>
            <strong>{formatSunTime(selectedDay?.sunset)}</strong>
            <span>Sunset</span>
          </div>
          <div>
            <strong>{getMoonIcon(getMoonPhase(new Date()))}</strong>
            <span>{getMoonPhase(new Date())}</span>
          </div>
        </div>
      </section>

      <section className="weatherPanelFixed">
        <h2>Pattern Hint</h2>
        <p>
          {Number(wind) >= 8
            ? "Wind should position bait. Start on wind-blown points, grass lines, and banks with chop."
            : "No major trigger showing yet. Fish high-confidence areas and let your catch history guide the pattern."}
        </p>
        <button onClick={() => setPage("prediction")}>Open Prediction</button>
      </section>

      <div className="homeBottomSpacer" />
    </main>
  );
}

function cleanSpeciesName(value) {
  const name = String(value || "").trim();

  if (!name) return "";
  if (name.toLowerCase() === "unidentified fish") return "";

  return name;
}

function makeImageKey(dataUrl) {
  let hash = 0;

  for (let i = 0; i < dataUrl.length; i++) {
    hash = (hash << 5) - hash + dataUrl.charCodeAt(i);
    hash |= 0;
  }

  return `img_${Math.abs(hash)}_${dataUrl.length}`;
}

function hasValue(value) {
  return (
    value !== null &&
    value !== undefined &&
    value !== "" &&
    value !== "--" &&
    value !== "None" &&
    value !== "none" &&
    value !== "Unknown"
  );
}

function SwipeCatchCard({
  fish,
  onDeleteCatch,
  onUpdateCatch,
  setPage,
  setEditingCatchId,
}) {
  const [startX, setStartX] = useState(null);
  const [offsetX, setOffsetX] = useState(0);

  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    species: fish.species || "",
    lake: fish.lake || "",
    size: fish.size || "",
    bait: fish.bait || "",
    notes: fish.notes || "",
    date: fish.date || new Date().toISOString(),
  });

  function handleTouchStart(e) {
    setStartX(e.touches[0].clientX);
  }

  function handleTouchMove(e) {
    if (startX === null) return;

    const diff = e.touches[0].clientX - startX;

    if (diff < 0) {
      setOffsetX(Math.max(diff, -120));
    }
  }

  function handleTouchEnd() {
    if (offsetX < -70) {
      setOffsetX(-120);
    } else {
      setOffsetX(0);
    }

    setStartX(null);
  }

  function updateEdit(field, value) {
    setEditForm((current) => ({ ...current, [field]: value }));
  }

  function saveEdit() {
    onUpdateCatch(fish.id, {
      species: editForm.species,
      lake: editForm.lake,
      size: editForm.size,
      bait: editForm.bait,
      notes: editForm.notes,
      date: editForm.date,
      wasEdited: true,
      editedAt: new Date().toISOString(),
    });

    setIsEditing(false);
  }
  return (
    <div className="swipeWrap">
      <button className="deleteReveal" onClick={() => onDeleteCatch(fish.id)}>
        Delete
      </button>

      <section
        className="panel logCard swipeCard"
        style={{ transform: `translateX(${offsetX}px)` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="logPhoto">
          {fish.photo ? <img src={fish.photo} alt={fish.species} /> : "🐟"}
        </div>

        <div className="logDetails">
          <p className="sectionLabel green">{formatCatchDate(fish.date)}</p>

          <h2>{fish.species || "Unidentified Fish"}</h2>
          <p className="muted">Correct species if needed:</p>
          <select
            value={fish.species}
            onChange={(e) => {
              const correctedSpecies = e.target.value;

              saveCorrection(fish.photoKey, correctedSpecies);

              saveTrainingExample(fish, correctedSpecies);

              onUpdateCatch(fish.id, {
                species: correctedSpecies,
                confirmedSpecies: correctedSpecies,
                aiSpecies: fish.aiSpecies || fish.species,
                wasCorrected: true,
                confirmedAt: new Date().toISOString(),
              });
            }}
          >
            <option value={fish.species}>
              {fish.species || "Unidentified Fish"}
            </option>

            <option value="Largemouth Bass">Largemouth Bass</option>
            <option value="Spotted Bass">Spotted Bass</option>
            <option value="White Bass">White Bass</option>
            <option value="Striped Bass">Striped Bass</option>
            <option value="Hybrid Striped Bass">Hybrid Striped Bass</option>
            <option value="Black Crappie">Black Crappie</option>
            <option value="White Crappie">White Crappie</option>
            <option value="Bluegill / Bream">Bluegill / Bream</option>
            <option value="Redear Sunfish / Shellcracker">
              Redear Sunfish / Shellcracker
            </option>
            <option value="Channel Catfish">Channel Catfish</option>
            <option value="Flathead Catfish">Flathead Catfish</option>
          </select>
          <button
            className="editCatchButton"
            onClick={() => {
              setEditingCatchId(fish.id);
              setPage("editCatch");
            }}
          >
            Edit Catch
          </button>

          <p>
            <strong>{fish.size}</strong> • {fish.lake}
          </p>

          <p>
            <strong>Bait:</strong> {fish.bait}
          </p>

          {fish.patternTag && (
            <p>
              <strong>Fish Location:</strong> {fish.patternTag}
            </p>
          )}

          <div className="weatherMini">
            {hasValue(fish.weather?.temp) && (
              <div>
                <strong>Temp:</strong> {fish.weather.temp}°F
              </div>
            )}

            {hasValue(fish.weather?.feelsLike) && (
              <div>
                <strong>Feels Like:</strong> {fish.weather.feelsLike}°F
              </div>
            )}

            {hasValue(fish.weather?.humidity) && (
              <div>
                <strong>Humidity:</strong> {fish.weather.humidity}%
              </div>
            )}

            {hasValue(fish.weather?.wind) && (
              <div>
                <strong>Wind:</strong> {fish.weather.wind} mph
              </div>
            )}

            {hasValue(fish.weather?.windCardinal) && (
              <div>
                <strong>Wind Dir:</strong> {fish.weather.windCardinal}
              </div>
            )}

            {hasValue(fish.weather?.pressure) && (
              <div>
                <strong>Pressure:</strong> {fish.weather.pressure} hPa
              </div>
            )}

            {hasValue(fish.weather?.rain) && (
              <div>
                <strong>Rain:</strong> {fish.weather.rain} in
              </div>
            )}

            {hasValue(fish.weather?.cloud) && (
              <div>
                <strong>Clouds:</strong> {fish.weather.cloud}%
              </div>
            )}
          </div>

          {fish.water?.summary && (
            <div className="waterMini">
              {hasValue(fish.water.summary.station) && (
                <div>
                  <strong>Station:</strong> {fish.water.summary.station}
                </div>
              )}

              {hasValue(fish.water.summary.waterTemp) && (
                <div>
                  <strong>Water Temp:</strong> {fish.water.summary.waterTemp}°F
                </div>
              )}

              {hasValue(fish.water.summary.waterTempSource) && (
                <div>
                  <strong>Water Source:</strong>{" "}
                  {fish.water.summary.waterTempSource}
                </div>
              )}

              {hasValue(fish.water.summary.flow) && (
                <div>
                  <strong>Flow:</strong> {fish.water.summary.flow} cfs
                </div>
              )}

              {hasValue(fish.water.summary.gageHeight) && (
                <div>
                  <strong>Gage:</strong> {fish.water.summary.gageHeight} ft
                </div>
              )}

              {hasValue(fish.water.summary.conductance) && (
                <div>
                  <strong>Conductance:</strong> {fish.water.summary.conductance}
                </div>
              )}

              {hasValue(fish.water.summary.dissolvedOxygen) && (
                <div>
                  <strong>Dissolved Oxygen:</strong>{" "}
                  {fish.water.summary.dissolvedOxygen}
                </div>
              )}

              {hasValue(fish.water.summary.ph) && (
                <div>
                  <strong>pH:</strong> {fish.water.summary.ph}
                </div>
              )}

              {hasValue(fish.water.summary.turbidity) && (
                <div>
                  <strong>Turbidity:</strong> {fish.water.summary.turbidity}
                </div>
              )}

              {hasValue(fish.water.summary.precipitation) && (
                <div>
                  <strong>Water Rain:</strong>{" "}
                  {fish.water.summary.precipitation}
                </div>
              )}

              {hasValue(fish.water.summary.noaaWindSpeed) && (
                <div>
                  <strong>NOAA Wind:</strong> {fish.water.summary.noaaWindSpeed}{" "}
                  mph
                </div>
              )}

              {hasValue(fish.water.summary.noaaPressure) && (
                <div>
                  <strong>NOAA Pressure:</strong>{" "}
                  {fish.water.summary.noaaPressure}
                </div>
              )}
            </div>
          )}

          {fish.managedWater && (
            <div className="waterMini">
              <div>
                <strong>Managed By:</strong> {fish.managedWater.provider}
              </div>
              <div>
                <strong>System:</strong> {fish.managedWater.system}
              </div>
              {fish.managedWater.providerId === "georgia_power" && (
                <div>
                  <strong>Status:</strong> Hydro generation lake
                </div>
              )}

              {fish.managedWater.providerId === "tva" && (
                <div>
                  <strong>Status:</strong> TVA current-generating reservoir
                </div>
              )}

              {fish.managedWater.providerId === "usace" && (
                <div>
                  <strong>Status:</strong> USACE flood-control reservoir
                </div>
              )}

              {fish.managedWater.providerId === "duke_energy" && (
                <div>
                  <strong>Status:</strong> Duke Energy hydro reservoir
                </div>
              )}
              <div>
                <strong>Note:</strong> {fish.managedWater.note}
              </div>
            </div>
          )}

          {fish.hydro && fish.hydro.sourceUsed !== "none" && (
            <div className="waterMini">
              {hasValue(fish.hydro.sourceUsed) && (
                <div>
                  <strong>Hydro Source:</strong> {fish.hydro.sourceUsed}
                </div>
              )}

              {hasValue(fish.hydro.lakeLevelFt) && (
                <div>
                  <strong>Lake Level:</strong> {fish.hydro.lakeLevelFt} ft
                </div>
              )}

              {hasValue(fish.hydro.fullPoolFt) && (
                <div>
                  <strong>Full Pool:</strong> {fish.hydro.fullPoolFt} ft
                </div>
              )}

              {hasValue(fish.hydro.feetFromFullPool) && (
                <div>
                  <strong>From Full:</strong> {fish.hydro.feetFromFullPool} ft
                </div>
              )}

              {hasValue(fish.hydro.turbineRelease) && (
                <div>
                  <strong>Turbine Release:</strong> {fish.hydro.turbineRelease}{" "}
                  cfs
                </div>
              )}

              {hasValue(fish.hydro.dischargeCfs) && (
                <div>
                  <strong>Flow:</strong> {fish.hydro.dischargeCfs} cfs
                </div>
              )}

              {hasValue(fish.hydro.gageHeightFt) && (
                <div>
                  <strong>Gage:</strong> {fish.hydro.gageHeightFt} ft
                </div>
              )}

              {hasValue(fish.hydro.generation) && (
                <div>
                  <strong>Units Running:</strong> {fish.hydro.generation}
                </div>
              )}

              {Array.isArray(fish.hydro.releaseSchedule) &&
                fish.hydro.releaseSchedule.length > 0 && (
                  <div>
                    <strong>Dam Schedule:</strong>{" "}
                    {fish.hydro.releaseSchedule
                      .map(
                        (row) =>
                          `${row.date} ${row.time}: ${row.units} unit(s)`,
                      )
                      .join(" • ")}
                  </div>
                )}

              {hasValue(fish.hydro.confidence) && (
                <div>
                  <strong>Confidence:</strong> {fish.hydro.confidence}
                </div>
              )}
            </div>
          )}

          <p>
            <strong>Moon:</strong>{" "}
            {fish.moon ? `${getMoonIcon(fish.moon)} ${fish.moon}` : "--"}
          </p>

          {fish.isLoadingConditions && (
            <div className="loadingConditions">
              <span className="loadingDot"></span>
              <span>Loading weather and water data...</span>
            </div>
          )}

          <p className="muted">{fish.notes}</p>
        </div>
      </section>
    </div>
  );
}

function LogPage({
  catches,
  onDeleteCatch,
  onUpdateCatch,
  setPage,
  setEditingCatchId,
}) {
  return (
    <main className="screen">
      <h1>Catch Log</h1>

      {catches.map((fish) => (
        <SwipeCatchCard
          key={fish.id}
          fish={fish}
          onDeleteCatch={onDeleteCatch}
          onUpdateCatch={onUpdateCatch}
          setPage={setPage}
          setEditingCatchId={setEditingCatchId}
        />
      ))}
    </main>
  );
}

function getFishIcon(species = "") {
  const name = species.toLowerCase();

  const icons = [
    // 🔥 BASS (split)
    { match: ["largemouth"], file: "largemouth.png" },
    { match: ["smallmouth"], file: "smallmouth.png" },
    { match: ["spotted bass"], file: "spottedbass.png" },
    { match: ["shoal bass"], file: "shoalbass.png" },
    { match: ["guadalupe bass"], file: "guadalupbass.png" },
    { match: ["rock bass"], file: "rockbass.png" },

    // 🔥 STRIPER FAMILY
    { match: ["striped bass", "striper"], file: "striper.png" },
    { match: ["white bass"], file: "whitebass.png" },
    { match: ["yellow bass"], file: "yellowbass.png" },
    { match: ["hybrid"], file: "hybridbass.png" },

    // 🔥 CRAPPIE (split)
    { match: ["black crappie"], file: "blackcrappie.png" },
    { match: ["white crappie"], file: "whitecrappie.png" },

    // 🔥 PANFISH (split)
    { match: ["bluegill", "bream"], file: "bluegill.png" },
    { match: ["redear", "shellcracker"], file: "redear.png" },
    { match: ["pumpkinseed"], file: "pumpkinseed.png" },
    { match: ["warmouth"], file: "warmouth.png" },

    // 🔥 CATFISH (split)
    { match: ["channel catfish"], file: "channelcat.png" },
    { match: ["blue catfish"], file: "bluecat.png" },
    { match: ["flathead"], file: "flathead.png" },
    { match: ["bullhead"], file: "bullhead.png" },

    // 🔥 OTHER FRESHWATER
    { match: ["walleye"], file: "walleye.png" },
    { match: ["sauger"], file: "sauger.png" },
    { match: ["northern pike"], file: "pike.png" },
    { match: ["muskie", "muskellunge"], file: "muskie.png" },
    { match: ["pickerel"], file: "pickerel.png" },

    // 🔥 TROUT / SALMON
    { match: ["rainbow trout"], file: "rainbowtrout.png" },
    { match: ["brown trout"], file: "browntrout.png" },
    { match: ["brook trout"], file: "brooktrout.png" },
    { match: ["cutthroat"], file: "cutthroat.png" },
    { match: ["lake trout"], file: "laketrout.png" },
    { match: ["steelhead"], file: "steelhead.png" },

    {
      match: ["salmon", "chinook", "coho", "sockeye", "chum"],
      file: "salmon.png",
    },

    // 🔥 ROUGH FISH
    { match: ["carp"], file: "carp.png" },
    { match: ["buffalo"], file: "buffalo.png" },
    { match: ["sucker"], file: "sucker.png" },

    { match: ["gar"], file: "gar.png" },
    { match: ["bowfin"], file: "bowfin.png" },
    { match: ["snakehead"], file: "snakehead.png" },

    // 🔥 SALTWATER
    { match: ["redfish", "red drum"], file: "redfish.png" },
    { match: ["speckled trout", "seatrout"], file: "seatrout.png" },
    { match: ["flounder"], file: "flounder.png" },
    { match: ["snook"], file: "snook.png" },
    { match: ["tarpon"], file: "tarpon.png" },
    { match: ["sheepshead"], file: "sheepshead.png" },
    { match: ["black drum"], file: "blackdrum.png" },
    { match: ["cobia"], file: "cobia.png" },
    { match: ["snapper"], file: "snapper.png" },
    { match: ["grouper"], file: "grouper.png" },
    { match: ["mackerel"], file: "mackerel.png" },
    { match: ["tuna", "albacore", "bonito"], file: "tuna.png" },

    // 🔥 OTHER
    { match: ["perch"], file: "perch.png" },
    { match: ["freshwater drum"], file: "drum.png" },
  ];

  const found = icons.find((icon) => icon.match.some((m) => name.includes(m)));

  return `/icons-normalized/${found?.file || "default.png"}`;
}

async function getNearbyUsgsStations(lat, lon) {
  try {
    const searchSize = window.innerWidth < 700 ? 0.15 : 0.5;

    const west = lon - searchSize;
    const south = lat - searchSize;
    const east = lon + searchSize;
    const north = lat + searchSize;

    console.log("PHONE WIDTH:", window.innerWidth);
    console.log("USGS SEARCH SIZE:", searchSize);

    const bbox = `${west},${south},${east},${north}`;

    console.log("USGS BBOX:", bbox);

    const url =
      `https://corsproxy.io/?https://waterservices.usgs.gov/nwis/iv/?format=json` +
      `&bBox=${bbox}` +
      `&parameterCd=00060,00065,00010` +
      `&period=P1D` +
      `&siteStatus=active`;

    const res = await fetch(url);

    console.log("USGS STATUS:", res.status);

    const data = await res.json();

    console.log("USGS DATA:", data);

    const stations = {};

    (data.value?.timeSeries || []).forEach((item) => {
      const source = item.sourceInfo;
      const siteCode = source?.siteCode?.[0]?.value;
      if (!siteCode) return;

      const stationLat = source?.geoLocation?.geogLocation?.latitude;
      const stationLon = source?.geoLocation?.geogLocation?.longitude;
      const code = item.variable?.variableCode?.[0]?.value;
      const values = item.values?.[0]?.value || [];
      const latest = values[values.length - 1];

      if (!stations[siteCode]) {
        stations[siteCode] = {
          id: siteCode,
          name: source?.siteName || "USGS Station",
          latitude: stationLat,
          longitude: stationLon,
          flow: null,
          gageHeight: null,
          waterTemp: null,
          updated: null,
        };
      }

      if (!latest) return;

      const value = Number(latest.value);

      if (code === "00060") stations[siteCode].flow = value;
      if (code === "00065") stations[siteCode].gageHeight = value;
      if (code === "00010") stations[siteCode].waterTemp = cToF(value);

      stations[siteCode].updated = latest.dateTime;
    });

    const stationList = Object.values(stations);
    console.log("USGS STATIONS FOUND:", stationList);
    return stationList;
  } catch (error) {
    console.error("USGS station layer failed", error);
    return [];
  }
}

async function getNearbyUsgsStationsByBounds({ west, south, east, north }) {
  try {
    const clean = (n) => Number(n).toFixed(6);

    const bbox = [clean(west), clean(south), clean(east), clean(north)].join(
      ",",
    );

    const url =
      `https://waterservices.usgs.gov/nwis/iv/?format=json` +
      `&bBox=${bbox}` +
      `&parameterCd=00060,00065,00010` +
      `&period=P1D` +
      `&siteStatus=active`;

    console.log("FINAL USGS URL:", url);

    const res = await fetch(url);
    console.log("USGS STATUS:", res.status);

    const data = await res.json();
    console.log("USGS DATA:", data);

    const stations = {};

    (data.value?.timeSeries || []).forEach((item) => {
      const source = item.sourceInfo;
      const siteCode = source?.siteCode?.[0]?.value;
      if (!siteCode) return;

      const code = item.variable?.variableCode?.[0]?.value;
      const values = item.values?.[0]?.value || [];
      const latest = values[values.length - 1];

      if (!stations[siteCode]) {
        stations[siteCode] = {
          id: siteCode,
          name: source?.siteName || "USGS Station",
          latitude: Number(source?.geoLocation?.geogLocation?.latitude),
          longitude: Number(source?.geoLocation?.geogLocation?.longitude),
          flow: null,
          gageHeight: null,
          waterTemp: null,
          displayWaterTemp: null,
          waterTempType: "Unavailable",
          updated: null,
        };
      }

      if (!latest) return;

      const value = Number(latest.value);

      if (code === "00060") stations[siteCode].flow = value;
      if (code === "00065") stations[siteCode].gageHeight = value;

      if (code === "00010") {
        stations[siteCode].waterTemp = cToF(value);
        stations[siteCode].displayWaterTemp = cToF(value);
        stations[siteCode].waterTempType = "Measured";
      }

      stations[siteCode].updated = latest.dateTime;
    });

    const centerLat = (north + south) / 2;
    const centerLon = (east + west) / 2;

    let mapWeather = null;

    try {
      mapWeather = await getWeather(
        centerLat,
        centerLon,
        new Date().toISOString(),
      );
    } catch (e) {
      console.log("Map weather failed", e);
    }

    const stationList = Object.values(stations).map((station) => {
      const estimatedTemp =
        station.waterTemp != null
          ? station.waterTemp
          : estimateWaterTempFromWeather(mapWeather);

      return {
        ...station,
        displayWaterTemp: estimatedTemp,
        waterTempType: station.waterTemp != null ? "Measured" : "Estimated",
      };
    });

    return stationList;
  } catch (error) {
    console.error("USGS station bounds failed", error);
    return [];
  }
}

function getWaterTempColor(temp) {
  if (temp == null) return "#64748b";
  if (temp < 50) return "#2563eb";
  if (temp < 60) return "#06b6d4";
  if (temp < 70) return "#22c55e";
  if (temp < 80) return "#facc15";
  if (temp < 88) return "#f97316";
  return "#dc2626";
}

function buildSmartMapSpots({ center, species, weather, waterTemp }) {
  if (!center || !weather) return [];

  const wind = Number(weather.wind ?? 0);
  const clouds = Number(weather.cloud ?? 0);
  const temp = Number(waterTemp ?? 70);

  const spots = [];

  const bassMode = species.toLowerCase().includes("bass");
  const crappieMode = species.toLowerCase().includes("crappie");
  const catfishMode = species.toLowerCase().includes("catfish");

  function addSpot(
    offsetLat,
    offsetLng,
    icon,
    title,
    type,
    why,
    lure,
    confidence = "Medium",
  ) {
    spots.push({
      id: `${type}-${spots.length}`,
      latitude: center.lat + offsetLat,
      longitude: center.lng + offsetLng,
      icon,
      title,
      type,
      why,
      lure,
      confidence,
    });
  }

  if (bassMode) {
    addSpot(
      0.004,
      -0.006,
      "🎯",
      "Main-lake point",
      "Point / channel swing",
      wind >= 8
        ? "Wind should push bait onto points and outside bends."
        : "Post-spawn bass often use points near deeper water.",
      temp >= 68 && temp <= 76
        ? "Wacky rig, spinnerbait, squarebill, swim jig"
        : "Jig, shaky head, Texas rig",
      wind >= 8 ? "High" : "Medium",
    );

    addSpot(
      -0.005,
      0.005,
      "🌊",
      "Current seam",
      "Current / neck-down area",
      "River lakes position bass around current breaks, bends, and seams.",
      "Spinnerbait, crankbait, swimbait, jig",
      "Medium",
    );

    if (clouds < 35) {
      addSpot(
        0.002,
        0.008,
        "🌳",
        "Shade line",
        "Shade / bank cover",
        "Low cloud cover means shade becomes more important.",
        "Wacky rig, Texas rig, skipping jig",
        "Medium",
      );
    }
  }

  if (crappieMode) {
    addSpot(
      0.003,
      0.006,
      "🪵",
      "Brush or dock zone",
      "Brush / dock / timber",
      "Crappie usually relate to cover near depth changes.",
      "Small jig, minnow, underspin",
      "Medium",
    );
  }

  if (catfishMode) {
    addSpot(
      -0.006,
      -0.003,
      "🌀",
      "Channel bend",
      "Deep bend / current seam",
      "Catfish favor current seams, holes, bends, and food funnels.",
      "Cut bait, live bait, chicken liver",
      "Medium",
    );
  }

  return spots;
}

async function getWaterCheckUsgsStation(lat, lon, waterName = "") {
  try {
    const delta = 0.12;

    const clean = (n) => Number(n).toFixed(6);

    const bbox = [
      clean(lon - delta),
      clean(lat - delta),
      clean(lon + delta),
      clean(lat + delta),
    ].join(",");

    const url =
      `https://waterservices.usgs.gov/nwis/iv/?format=json` +
      `&bBox=${bbox}` +
      `&parameterCd=00060,00065,00010` +
      `&period=P1D` +
      `&siteStatus=active`;

    const res = await fetch(url);

    if (!res.ok) {
      throw new Error(`USGS status ${res.status}`);
    }

    const data = await res.json();
    const stations = {};

    (data.value?.timeSeries || []).forEach((item) => {
      const source = item.sourceInfo;
      const siteCode = source?.siteCode?.[0]?.value;
      if (!siteCode) return;

      const stationLat = Number(source?.geoLocation?.geogLocation?.latitude);
      const stationLon = Number(source?.geoLocation?.geogLocation?.longitude);
      const code = item.variable?.variableCode?.[0]?.value;
      const latest = item.values?.[0]?.value?.at(-1);

      if (!stations[siteCode]) {
        stations[siteCode] = {
          id: siteCode,
          name: source?.siteName || "USGS Station",
          latitude: stationLat,
          longitude: stationLon,
          flow: null,
          gageHeight: null,
          waterTemp: null,
          updated: null,
          distance: distanceMiles(lat, lon, stationLat, stationLon),
        };
      }

      if (!latest) return;

      const value = Number(latest.value);

      if (code === "00060") stations[siteCode].flow = value;
      if (code === "00065") stations[siteCode].gageHeight = value;
      if (code === "00010") stations[siteCode].waterTemp = cToF(value);

      stations[siteCode].updated = latest.dateTime;
    });

    function normalizeWaterName(value) {
      return String(value || "")
        .toLowerCase()
        .replace(/\brv\b/g, "river")
        .replace(/\briv\b/g, "river")
        .replace(/\bcr\b/g, "creek")
        .replace(/\bck\b/g, "creek")
        .replace(/\bnr\b/g, "near")
        .replace(/^lake\s+/g, "")
        .replace(/\s+lake$/g, "")
        .replace(/[^a-z0-9 ]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    const cleanWaterName = normalizeWaterName(waterName);

    const stationList = Object.values(stations).sort(
      (a, b) => a.distance - b.distance,
    );

    const matchingStation = stationList.find((station) => {
      const stationName = normalizeWaterName(station.name);

      return (
        cleanWaterName &&
        (stationName.includes(cleanWaterName) ||
          cleanWaterName.includes(stationName.split(" near ")[0]))
      );
    });

    return matchingStation || null;
  } catch (error) {
    console.log("Water Check USGS failed", error);
    return null;
  }
}

function MapPage({
  catches,
  setPage,
  setPredictionLocation,
  getCurrentWeather,
  getRecentWeatherAverages,
}) {
  const [selected, setSelected] = useState(null);
  const [burst, setBurst] = useState(null);
  const mapRef = useRef(null);
  const [waterStations, setWaterStations] = useState([]);
  const [selectedStation, setSelectedStation] = useState(null);
  const [loadingStations, setLoadingStations] = useState(false);
  const [showLayersMenu, setShowLayersMenu] = useState(false);
  const [mapPredictionWeather, setMapPredictionWeather] = useState(null);
  const [mapSpecies, setMapSpecies] = useState("Largemouth Bass");
  const [selectedSmartSpot, setSelectedSmartSpot] = useState(null);
  const [waterCheck, setWaterCheck] = useState(null);
  const [waterCheckLoading, setWaterCheckLoading] = useState(false);
  const waterCheckRequestRef = useRef(0);

  const [mapLayers, setMapLayers] = useState(() => {
    try {
      const saved = localStorage.getItem("fish-map-layers");
      if (saved) return JSON.parse(saved);
    } catch {}

    return {
      stations: true,
      prediction: false,
      smartSpots: false,
    };
  });

  useEffect(() => {
    localStorage.setItem("fish-map-layers", JSON.stringify(mapLayers));
  }, [mapLayers]);

  const gpsCatches = catches.filter((catchItem) => catchItem.gps);

  const mapWaterTemp = estimateWaterTempFromWeather(mapPredictionWeather || {});

  const pattern = mapPredictionWeather
    ? getPatternStrength(catches, {
        lake: "Any Lake",
        temp: mapPredictionWeather.temp,
        wind: mapPredictionWeather.wind,
        cloud: mapPredictionWeather.cloud,
        pressure: mapPredictionWeather.pressure,
        rain: mapPredictionWeather.rain,
        waterTemp: mapWaterTemp,
      })
    : { bestMatches: [] };

  const matches = pattern.bestMatches || [];
  const matchIds = new Set(matches.map((fish) => fish.id));
  const mapCenterForSpots = mapRef.current?.getMap?.()?.getCenter?.();

  const smartSpots = [];

  const startLongitude = -85.0;
  const startLatitude = 32.461;

  async function loadMapPredictionWeather() {
    const map = mapRef.current?.getMap?.();
    if (!map || !getCurrentWeather || !getRecentWeatherAverages) return;

    const center = map.getCenter();
    const now = new Date().toISOString();

    try {
      const current = await getCurrentWeather(center.lat, center.lng);
      const recent = await getRecentWeatherAverages(
        center.lat,
        center.lng,
        now,
      );

      setMapPredictionWeather({
        temp: current.current?.temperature_2m,
        wind: current.current?.wind_speed_10m,
        cloud: current.current?.cloud_cover,
        pressure: current.current?.pressure_msl,
        rain: current.current?.rain ?? current.current?.precipitation,
        ...recent,
        date: now,
      });
    } catch (e) {
      console.log("Map prediction weather failed", e);
    }
  }

  async function loadWaterStationsFromMap() {
    const map = mapRef.current?.getMap?.();
    if (!map || loadingStations) return;

    setLoadingStations(true);

    const bounds = map.getBounds();

    const stations = await getNearbyUsgsStationsByBounds({
      west: bounds.getWest(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      north: bounds.getNorth(),
    });

    setWaterStations(stations);
    setLoadingStations(false);
  }
  async function runWaterCheck(lat, lon) {
    const requestId = waterCheckRequestRef.current + 1;
    waterCheckRequestRef.current = requestId;

    setWaterCheckLoading(true);

    setWaterCheck({
      lake: "Checking water...",
      lat,
      lon,
      hydro: null,
      water: null,
      managedWater: null,
    });

    try {
      const lake = (await getLakeName(lat, lon)) || "Unknown water";
      if (requestId !== waterCheckRequestRef.current) return;
      const now = new Date().toISOString();

      let weather = null;
      let water = null;
      let managedWater = null;
      let hydro = null;

      try {
        weather = await getWeather(lat, lon, now);
        if (requestId !== waterCheckRequestRef.current) return;
      } catch (e) {
        console.log("Water Check weather failed", e);
      }

      try {
        water = await getAllWaterData(lat, lon, lake);
        if (requestId !== waterCheckRequestRef.current) return;
      } catch (e) {
        console.log("Water Check water failed", e);
      }

      const estimatedWaterTemp = estimateWaterTempFromWeather(weather);
      const usgsStation = await getWaterCheckUsgsStation(lat, lon, lake);
      if (requestId !== waterCheckRequestRef.current) return;

      if (!water) {
        water = {
          summary: {
            waterTemp: estimatedWaterTemp,
            waterTempSource: "Estimated from weather",
          },
        };
      } else {
        water = {
          ...water,
          summary: {
            ...(water.summary || {}),
            waterTemp: water.summary?.waterTemp ?? estimatedWaterTemp,
            waterTempSource:
              water.summary?.waterTempSource || "Estimated from weather",
          },
        };
      }

      if (usgsStation) {
        water = {
          ...(water || {}),
          summary: {
            ...(water?.summary || {}),
            station: usgsStation.name,
            flow: usgsStation.flow ?? water?.summary?.flow,
            gageHeight: usgsStation.gageHeight ?? water?.summary?.gageHeight,
            waterTemp:
              usgsStation.waterTemp ??
              water?.summary?.waterTemp ??
              estimatedWaterTemp,
            waterTempSource:
              usgsStation.waterTemp != null
                ? "USGS measured station"
                : usgsStation.gageHeight != null || usgsStation.flow != null
                  ? "Estimated from nearby USGS station"
                  : "Estimated from weather",
            updated: usgsStation.updated,
            distance: usgsStation.distance,
          },
        };
      }

      try {
        managedWater = await getManagedWaterData(lake, lat, lon);
      } catch (e) {
        console.log("Water Check managed water failed", e);
      }

      try {
        hydro = await getHydroDataForCatch({
          lake,
          waterbodyName: lake,
          managedWater,
          managedBy: managedWater?.provider,
          gps: {
            latitude: lat,
            longitude: lon,
          },
          date: now,
        });
      } catch (e) {
        console.log("Water Check hydro failed", e);
      }

      if (requestId !== waterCheckRequestRef.current) return;

      setWaterCheck({
        lake,
        lat,
        lon,
        weather,
        water,
        managedWater,
        hydro,
      });
    } catch (error) {
      console.log("Water check failed", error);

      if (requestId !== waterCheckRequestRef.current) return;

      setWaterCheck({
        lake: "Water check failed",
        lat,
        lon,
        error: error.message,
      });
    }

    if (requestId === waterCheckRequestRef.current) {
      setWaterCheckLoading(false);
    }
  }
  return (
    <main className="screen">
      <h1>Map</h1>

      <section className="panel mapPanel">
        <div className="mapboxWrapper">
          <div className="mapTopControls">
            <select
              value={mapSpecies}
              onChange={(e) => setMapSpecies(e.target.value)}
            >
              <option>Largemouth Bass</option>
              <option>Spotted Bass</option>
              <option>Crappie</option>
              <option>Catfish</option>
              <option>Striped Bass</option>
              <option>Bluegill / Bream</option>
            </select>

            <span>
              {mapPredictionWeather
                ? `${Math.round(mapWaterTemp)}° est. water`
                : "Loading prediction..."}
            </span>
          </div>
          <div className="mapLayersControl">
            <button
              className="layersButton"
              onClick={() => setShowLayersMenu((v) => !v)}
            >
              Layers
            </button>

            {showLayersMenu && (
              <div className="layersMenu">
                <label>
                  <input
                    type="checkbox"
                    checked={mapLayers.prediction}
                    onChange={(e) =>
                      setMapLayers((current) => ({
                        ...current,
                        prediction: e.target.checked,
                      }))
                    }
                  />
                  Prediction Matches
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={mapLayers.smartSpots}
                    onChange={(e) =>
                      setMapLayers((current) => ({
                        ...current,
                        smartSpots: e.target.checked,
                      }))
                    }
                  />
                  Prediction Spots
                </label>

                <label>
                  <input
                    type="checkbox"
                    checked={mapLayers.stations}
                    onChange={(e) =>
                      setMapLayers((current) => ({
                        ...current,
                        stations: e.target.checked,
                      }))
                    }
                  />
                  Stations
                </label>
              </div>
            )}
          </div>

          <div className="stationDebug">
            {loadingStations
              ? "Loading USGS..."
              : `${waterStations.length} USGS stations`}
          </div>
          <Map
            ref={mapRef}
            initialViewState={{
              longitude: -85.0,
              latitude: 32.461,
              zoom: 10,
            }}
            mapboxAccessToken={MAPBOX_TOKEN}
            mapStyle="mapbox://styles/mapbox/satellite-streets-v12"
            style={{ width: "100%", height: "100%" }}
            onClick={(e) => {
              const clickedMarker = e.originalEvent?.target?.closest(
                ".waterStationMarker, .fishMarker",
              );

              if (!clickedMarker) {
                setSelected(null);
                setSelectedStation(null);

                if (waterCheck) {
                  setWaterCheck(null);
                  setWaterCheckLoading(false);
                  waterCheckRequestRef.current += 1;
                  return;
                }

                runWaterCheck(e.lngLat.lat, e.lngLat.lng);
              }
            }}
            onLoad={() => {
              setTimeout(() => {
                loadWaterStationsFromMap();
                loadMapPredictionWeather();
              }, 500);
            }}
            onMoveEnd={() => {
              loadWaterStationsFromMap();
              loadMapPredictionWeather();
            }}
          >
            {gpsCatches.map((fish) => {
              const isMatch = mapLayers.prediction && matchIds.has(fish.id);

              return (
                <Marker
                  key={fish.id}
                  longitude={fish.gps.longitude}
                  latitude={fish.gps.latitude}
                  anchor="center"
                >
                  <div className="fishMarkerWrap">
                    <button
                      className={isMatch ? "fishMarker match" : "fishMarker"}
                      onClick={(e) => {
                        e.stopPropagation();
                        e.originalEvent?.stopPropagation?.();

                        if (selected?.id === fish.id) {
                          setSelected(null);
                        } else {
                          setSelected(fish);
                        }

                        setBurst(fish.id);
                        setTimeout(() => setBurst(null), 700);
                      }}
                      title={fish.species}
                    >
                      {burst === fish.id && (
                        <span className="fishBurst">💥</span>
                      )}

                      <div className="fishIconInner">
                        <div
                          className="fishIconSprite"
                          style={{
                            backgroundImage: `url(${getFishIcon(fish.species)})`,
                          }}
                        />
                      </div>
                    </button>
                  </div>
                </Marker>
              );
            })}
            {mapLayers.smartSpots &&
              smartSpots.map((spot) => (
                <Marker
                  key={spot.id}
                  longitude={spot.longitude}
                  latitude={spot.latitude}
                  anchor="center"
                >
                  <button
                    className="smartSpotMarker"
                    onClick={() => setSelectedSmartSpot(spot)}
                    title={spot.title}
                  >
                    {spot.icon}
                  </button>
                </Marker>
              ))}

            {mapLayers.stations &&
              waterStations.map((station) => {
                console.log("RENDERING STATION:", station);

                return (
                  <Marker
                    key={station.id}
                    longitude={Number(station.longitude)}
                    latitude={Number(station.latitude)}
                    anchor="center"
                  >
                    <button
                      className="waterStationMarker tempMarker"
                      style={{
                        background: getWaterTempColor(station.displayWaterTemp),
                      }}
                      onClick={() => setSelectedStation(station)}
                      title={station.name}
                    >
                      {station.displayWaterTemp ?? "?"}
                    </button>
                  </Marker>
                );
              })}

            {selected && (
              <Popup
                longitude={selected.gps.longitude}
                latitude={selected.gps.latitude}
                anchor="top"
                onClose={() => setSelected(null)}
                closeButton={true}
                closeOnClick={false}
              >
                <div className="mapPopup">
                  {selected.photo && (
                    <img src={selected.photo} alt={selected.species} />
                  )}

                  <h3>{selected.species}</h3>

                  <p>
                    <strong>{selected.size}</strong> • {selected.lake}
                  </p>

                  <p>🎣 {selected.bait}</p>

                  {selected.weather?.temp && (
                    <p>🌡️ {selected.weather.temp}°F</p>
                  )}

                  {selected.moon && <p>🌙 {selected.moon}</p>}
                  <button
                    className="greenButton saveFishButton"
                    onClick={() => {
                      setPredictionLocation({
                        latitude: selected.gps.latitude,
                        longitude: selected.gps.longitude,
                        lake: selected.lake,
                      });
                      setPage("prediction");
                    }}
                  >
                    Predict Here <span>›</span>
                  </button>
                </div>
              </Popup>
            )}
            {selectedSmartSpot && (
              <Popup
                longitude={selectedSmartSpot.longitude}
                latitude={selectedSmartSpot.latitude}
                anchor="top"
                closeButton={true}
                closeOnClick={false}
                onClose={() => setSelectedSmartSpot(null)}
              >
                <div className="mapPopup">
                  <h3>{selectedSmartSpot.title}</h3>
                  <p>
                    <strong>Species:</strong> {mapSpecies}
                  </p>
                  <p>
                    <strong>Type:</strong> {selectedSmartSpot.type}
                  </p>
                  <p>
                    <strong>Why:</strong> {selectedSmartSpot.why}
                  </p>
                  <p>
                    <strong>Throw:</strong> {selectedSmartSpot.lure}
                  </p>
                  <p>
                    <strong>Confidence:</strong> {selectedSmartSpot.confidence}
                  </p>
                </div>
              </Popup>
            )}

            {selectedStation && (
              <Popup
                longitude={selectedStation.longitude}
                latitude={selectedStation.latitude}
                anchor="top"
                onClose={() => setSelectedStation(null)}
                closeButton={true}
                closeOnClick={false}
              >
                <div className="mapPopup">
                  <h3>USGS Station</h3>
                  <p>
                    <strong>{selectedStation.name}</strong>
                  </p>
                  <p>
                    🌡️ Water Temp: {selectedStation.displayWaterTemp ?? "--"}°F{" "}
                    <small>
                      ({selectedStation.waterTempType ?? "Unknown"})
                    </small>
                  </p>
                  <p>🌊 Flow: {selectedStation.flow ?? "--"} cfs</p>
                  <p>📏 Gage: {selectedStation.gageHeight ?? "--"} ft</p>
                </div>
              </Popup>
            )}
            {waterCheck && (
              <Popup
                longitude={waterCheck.lon}
                latitude={waterCheck.lat}
                anchor="top"
                closeButton={true}
                closeOnClick={false}
                onClose={() => {
                  waterCheckRequestRef.current += 1;
                  setWaterCheck(null);
                  setWaterCheckLoading(false);
                }}
              >
                <div className="mapPopup">
                  <h3>Water Check</h3>

                  {waterCheckLoading && <p>Checking water data...</p>}

                  <p>
                    <strong>{waterCheck.lake}</strong>
                  </p>

                  {waterCheck.managedWater?.provider && (
                    <p>
                      <strong>Managed By:</strong>{" "}
                      {waterCheck.managedWater.provider}
                    </p>
                  )}

                  {hasValue(waterCheck.managedWater?.system) &&
                    waterCheck.managedWater.system !== "Water" && (
                      <p>
                        <strong>System:</strong>{" "}
                        {waterCheck.managedWater.system}
                      </p>
                    )}

                  {hasValue(waterCheck.hydro?.sourceUsed) &&
                    waterCheck.hydro.sourceUsed !== "none" && (
                      <p>
                        <strong>Hydro Source:</strong>{" "}
                        {waterCheck.hydro.sourceUsed}
                      </p>
                    )}

                  {hasValue(waterCheck.hydro?.lakeLevelFt) && (
                    <p>📏 Level: {waterCheck.hydro.lakeLevelFt} ft</p>
                  )}

                  {hasValue(waterCheck.hydro?.fullPoolFt) && (
                    <p>🎯 Full Pool: {waterCheck.hydro.fullPoolFt} ft</p>
                  )}

                  {hasValue(waterCheck.hydro?.feetFromFullPool) && (
                    <p>↕️ From Full: {waterCheck.hydro.feetFromFullPool} ft</p>
                  )}

                  {hasValue(waterCheck.hydro?.turbineRelease) && (
                    <p>
                      🌊 Turbine Release: {waterCheck.hydro.turbineRelease} cfs
                    </p>
                  )}

                  {hasValue(waterCheck.hydro?.dischargeCfs) && (
                    <p>🌊 Flow: {waterCheck.hydro.dischargeCfs} cfs</p>
                  )}

                  {hasValue(waterCheck.water?.summary?.waterTemp) && (
                    <p>
                      🌡️ Water Temp: {waterCheck.water.summary.waterTemp}°F
                      {hasValue(waterCheck.water.summary.waterTempSource)
                        ? ` (${waterCheck.water.summary.waterTempSource})`
                        : ""}
                    </p>
                  )}

                  {hasValue(waterCheck.water?.summary?.station) && (
                    <p>
                      <strong>USGS:</strong> {waterCheck.water.summary.station}
                    </p>
                  )}
                  {hasValue(waterCheck.water?.summary?.distance) && (
                    <p>
                      📍 Nearest Station:{" "}
                      {Math.round(waterCheck.water.summary.distance * 10) / 10}{" "}
                      mi
                    </p>
                  )}

                  {hasValue(waterCheck.water?.summary?.flow) && (
                    <p>🌊 USGS Flow: {waterCheck.water.summary.flow} cfs</p>
                  )}

                  {hasValue(waterCheck.water?.summary?.gageHeight) && (
                    <p>
                      📏 USGS Gage: {waterCheck.water.summary.gageHeight} ft
                    </p>
                  )}

                  {Array.isArray(waterCheck.hydro?.releaseSchedule) &&
                    waterCheck.hydro.releaseSchedule.length > 0 && (
                      <p>
                        <strong>Schedule:</strong>{" "}
                        {waterCheck.hydro.releaseSchedule
                          .map((row) => `${row.time}: ${row.units} unit(s)`)
                          .join(" • ")}
                      </p>
                    )}

                  {waterCheck.error && <p>{waterCheck.error}</p>}
                </div>
              </Popup>
            )}
          </Map>
        </div>
      </section>

      <section className="panel">
        <p className="sectionLabel">Saved Locations</p>

        {gpsCatches.length === 0 && (
          <p className="muted">No GPS catches yet.</p>
        )}

        {gpsCatches.map((fish) => (
          <div key={fish.id} className="mapItem">
            <strong>{fish.species}</strong>
            <p>
              {fish.size} • {fish.bait}
            </p>
            <p>
              📍 {fish.gps.latitude.toFixed(5)}, {fish.gps.longitude.toFixed(5)}
            </p>
          </div>
        ))}
      </section>
    </main>
  );
}
function EditCatchPage({ fish, onUpdateCatch, setPage }) {
  const [form, setForm] = useState({
    species: fish?.species || "",
    lake: fish?.lake || "",
    size: fish?.size || "",
    bait: fish?.bait || "",
    notes: fish?.notes || "",
    date: fish?.date || new Date().toISOString(),

    gpsLat: fish?.gps?.latitude ?? "",
    gpsLon: fish?.gps?.longitude ?? "",

    temp: fish?.weather?.temp ?? "",
    feelsLike: fish?.weather?.feelsLike ?? "",
    humidity: fish?.weather?.humidity ?? "",
    wind: fish?.weather?.wind ?? "",
    windDir: fish?.weather?.windCardinal ?? "",
    pressure: fish?.weather?.pressure ?? "",
    rain: fish?.weather?.rain ?? "",
    cloud: fish?.weather?.cloud ?? "",

    station: fish?.water?.summary?.station ?? "",
    distance:
      fish?.water?.usgs?.distance ??
      fish?.water?.noaa?.distance ??
      fish?.water?.usace?.distance ??
      "",
    flow: fish?.water?.summary?.flow ?? "",
    flowTrend: fish?.water?.usgs?.flowTrend ?? "",
    gageHeight: fish?.water?.summary?.gageHeight ?? "",
    gageTrend: fish?.water?.usgs?.gageTrend ?? "",
    waterTemp: fish?.water?.summary?.waterTemp ?? "",
    waterUpdated: fish?.water?.usgs?.updated ?? "",
    conductance: fish?.water?.summary?.conductance ?? "",
    dissolvedOxygen: fish?.water?.summary?.dissolvedOxygen ?? "",
    ph: fish?.water?.summary?.ph ?? "",
    turbidity: fish?.water?.summary?.turbidity ?? "",
    precipitation: fish?.water?.summary?.precipitation ?? "",

    managedProvider: fish?.managedWater?.provider ?? "",
    managedSystem: fish?.managedWater?.system ?? "",
    managedNote: fish?.managedWater?.note ?? "",

    moon: fish?.moon || "",
  });

  if (!fish) {
    return (
      <main className="screen">
        <h1>Edit Catch</h1>
        <section className="panel">
          <p>Catch not found.</p>
          <button onClick={() => setPage("log")}>Back to Log</button>
        </section>
      </main>
    );
  }

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function save() {
    onUpdateCatch(fish.id, {
      species: form.species,
      lake: form.lake,
      size: form.size,
      bait: form.bait,
      notes: form.notes,
      date: form.date,

      gps:
        form.gpsLat && form.gpsLon
          ? {
              latitude: Number(form.gpsLat),
              longitude: Number(form.gpsLon),
            }
          : null,

      weather: {
        temp: form.temp,
        feelsLike: form.feelsLike,
        humidity: form.humidity,
        wind: form.wind,
        windCardinal: form.windDir,
        pressure: form.pressure,
        rain: form.rain,
        cloud: form.cloud,
      },

      water: {
        station: form.station,
        distance: form.distance,
        flow: form.flow,
        flowTrend: form.flowTrend,
        gageHeight: form.gageHeight,
        gageTrend: form.gageTrend,
        waterTemp: form.waterTemp,
        updated: form.waterUpdated,
      },

      managedWater: {
        provider: form.managedProvider,
        system: form.managedSystem,
        note: form.managedNote,
      },

      moon: form.moon,
      wasEdited: true,
      editedAt: new Date().toISOString(),
    });

    setPage("log");
  }

  return (
    <main className="screen">
      <h1>Edit Catch</h1>

      <section className="panel formPanel">
        {fish.photo && (
          <img src={fish.photo} alt={fish.species} className="editPagePhoto" />
        )}

        <p className="editSectionTitle">Catch</p>
        <input
          value={form.species}
          onChange={(e) => update("species", e.target.value)}
          placeholder="Species"
        />
        <input
          value={form.lake}
          onChange={(e) => update("lake", e.target.value)}
          placeholder="Lake / water"
        />
        <input
          value={form.size}
          onChange={(e) => update("size", e.target.value)}
          placeholder="Size"
        />
        <input
          value={form.bait}
          onChange={(e) => update("bait", e.target.value)}
          placeholder="Bait"
        />
        <input
          className="editDateInput"
          type="datetime-local"
          value={form.date ? form.date.slice(0, 16) : ""}
          onChange={(e) =>
            update("date", new Date(e.target.value).toISOString())
          }
        />
        <textarea
          value={form.notes}
          onChange={(e) => update("notes", e.target.value)}
          placeholder="Notes"
        />

        <p className="editSectionTitle">GPS</p>
        <input
          value={form.gpsLat}
          onChange={(e) => update("gpsLat", e.target.value)}
          placeholder="GPS Latitude"
        />
        <input
          value={form.gpsLon}
          onChange={(e) => update("gpsLon", e.target.value)}
          placeholder="GPS Longitude"
        />

        <p className="editSectionTitle">Weather</p>
        <input
          value={form.temp}
          onChange={(e) => update("temp", e.target.value)}
          placeholder="Temperature"
        />
        <input
          value={form.feelsLike}
          onChange={(e) => update("feelsLike", e.target.value)}
          placeholder="Feels Like"
        />
        <input
          value={form.humidity}
          onChange={(e) => update("humidity", e.target.value)}
          placeholder="Humidity"
        />
        <input
          value={form.wind}
          onChange={(e) => update("wind", e.target.value)}
          placeholder="Wind"
        />
        <input
          value={form.windDir}
          onChange={(e) => update("windDir", e.target.value)}
          placeholder="Wind Direction"
        />
        <input
          value={form.pressure}
          onChange={(e) => update("pressure", e.target.value)}
          placeholder="Pressure"
        />
        <input
          value={form.rain}
          onChange={(e) => update("rain", e.target.value)}
          placeholder="Rain"
        />
        <input
          value={form.cloud}
          onChange={(e) => update("cloud", e.target.value)}
          placeholder="Clouds"
        />

        <p className="editSectionTitle">Water</p>
        <input
          value={form.station}
          onChange={(e) => update("station", e.target.value)}
          placeholder="USGS Station"
        />
        <input
          value={form.distance}
          onChange={(e) => update("distance", e.target.value)}
          placeholder="Station Distance"
        />
        <input
          value={form.flow}
          onChange={(e) => update("flow", e.target.value)}
          placeholder="Flow"
        />
        <input
          value={form.flowTrend}
          onChange={(e) => update("flowTrend", e.target.value)}
          placeholder="Flow Trend"
        />
        <input
          value={form.gageHeight}
          onChange={(e) => update("gageHeight", e.target.value)}
          placeholder="Gage Height"
        />
        <input
          value={form.gageTrend}
          onChange={(e) => update("gageTrend", e.target.value)}
          placeholder="Gage Trend"
        />
        <input
          value={form.waterTemp}
          onChange={(e) => update("waterTemp", e.target.value)}
          placeholder="Water Temp"
        />
        <input
          value={form.waterUpdated}
          onChange={(e) => update("waterUpdated", e.target.value)}
          placeholder="Water Updated"
        />

        <p className="editSectionTitle">Managed Water</p>
        <input
          value={form.managedProvider}
          onChange={(e) => update("managedProvider", e.target.value)}
          placeholder="Managed By"
        />
        <input
          value={form.managedSystem}
          onChange={(e) => update("managedSystem", e.target.value)}
          placeholder="System"
        />
        <textarea
          value={form.managedNote}
          onChange={(e) => update("managedNote", e.target.value)}
          placeholder="Managed Water Note"
        />

        <p className="editSectionTitle">Moon</p>
        <input
          value={form.moon}
          onChange={(e) => update("moon", e.target.value)}
          placeholder="Moon Phase"
        />

        <button className="greenButton saveFishButton" onClick={save}>
          Save Changes <span>›</span>
        </button>

        <button className="editCatchButton" onClick={() => setPage("log")}>
          Cancel
        </button>

        <div className="editSpacerBottom" />
      </section>
    </main>
  );
}

function PlaceholderPage({ title }) {
  return (
    <main className="screen">
      <h1>{title}</h1>
      <section className="panel">
        <p>This page is ready to build next.</p>
      </section>
    </main>
  );
}

export default function App() {
  const didUpgradeRef = useRef(false);

  const [page, setPage] = useState("home");

  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowSplash(false);
    }, 8400);

    return () => clearTimeout(timer);
  }, []);

  const [editingCatchId, setEditingCatchId] = useState(null);
  const [predictionLocation, setPredictionLocation] = useState(null);

  const [catches, setCatches] = useState(() => {
    try {
      const saved = localStorage.getItem("fish-patterns-catches");
      return saved ? JSON.parse(saved) : starterCatches;
    } catch {
      localStorage.removeItem("fish-patterns-catches");
      return starterCatches;
    }
  });

  useEffect(() => {
    if (didUpgradeRef.current) return;
    didUpgradeRef.current = true;

    async function upgradeAndSave() {
      const updated = await Promise.all(
        catches.map(async (fish) => {
          if (
            fish.weather &&
            fish.water?.summary?.waterTemp &&
            fish.water?.summary?.waterTempSource !==
              "Open-Meteo lake surface estimate" &&
            fish.moon &&
            fish.lake &&
            fish.lake !== "Auto later" &&
            fish.lake !== "Unknown water" &&
            fish.managedWater
          ) {
            return fish;
          }

          let weather = fish.weather;
          let water = fish.water;
          let moon = fish.moon;
          let lake = fish.lake;
          let managedWater = fish.managedWater;
          let hydro = fish.hydro;

          if (fish.gps && fish.date) {
            if (!weather) {
              try {
                weather = await getWeather(
                  fish.gps.latitude,
                  fish.gps.longitude,
                  fish.date,
                );
              } catch {}
            }

            if (
              !water ||
              !water?.summary?.waterTemp ||
              water?.summary?.waterTempSource ===
                "Open-Meteo lake surface estimate"
            ) {
              try {
                water = await getAllWaterData(
                  fish.gps.latitude,
                  fish.gps.longitude,
                  lake || fish.lake || "",
                );
              } catch {
                water = fish.water;
              }

              const estimatedWaterTemp = estimateWaterTempFromWeather(weather);

              if (!water) {
                water = {
                  summary: {
                    bestSource: "Estimated",
                    station: null,
                    waterTemp: estimatedWaterTemp,
                    waterTempSource: "Estimated from weather",
                    waterTempUnit: "°F",
                  },
                };
              } else {
                water = {
                  ...water,
                  summary: {
                    ...(water.summary || {}),
                    waterTemp: water.summary?.waterTemp ?? estimatedWaterTemp,
                    waterTempSource:
                      water.summary?.waterTempSource === "None" ||
                      !water.summary?.waterTempSource
                        ? "Estimated from weather"
                        : water.summary.waterTempSource,
                    waterTempUnit: "°F",
                  },
                };
              }
            }

            if (
              !lake ||
              lake === "Auto later" ||
              lake === "Unknown water" ||
              lake.includes("Chattahoochee River")
            ) {
              try {
                lake = await getLakeName(fish.gps.latitude, fish.gps.longitude);
              } catch {}
            }

            if (!moon) {
              moon = getMoonPhase(fish.date);
            }

            if (
              (!managedWater ||
                managedWater.provider === "Unknown / Public Water" ||
                managedWater.system === "Unmatched water body") &&
              lake &&
              lake !== "Unknown water" &&
              lake !== "Auto later" &&
              lake !== "Finding water..."
            ) {
              try {
                managedWater = await getManagedWaterData(
                  lake,
                  fish.gps.latitude,
                  fish.gps.longitude,
                );
              } catch {}
            }
          }

          if (
            (!hydro || hydro.sourceUsed === "none") &&
            fish.gps &&
            lake &&
            lake !== "Finding water..." &&
            lake !== "Unknown water"
          ) {
            try {
              hydro = await getHydroDataForCatch({
                ...fish,
                lake,
                managedWater,
                managedBy: managedWater?.provider,
                waterbodyName: lake,
              });
            } catch {}
          }

          return { ...fish, weather, water, moon, lake, managedWater, hydro };
        }),
      );

      try {
        const currentJson = JSON.stringify(catches);
        const updatedJson = JSON.stringify(updated);

        localStorage.setItem("fish-patterns-catches", updatedJson);

        if (updatedJson !== currentJson) {
          setCatches(updated);
        }
      } catch (error) {
        console.error("Could not save catches:", error);
      }
    }

    upgradeAndSave();
  }, []);

  async function saveCatch(newCatch) {
    let catchWithHydro = newCatch;

    try {
      const hydro =
        newCatch.hydro?.sourceUsed === "Manual entry"
          ? newCatch.hydro
          : await getHydroDataForCatch(newCatch);

      catchWithHydro = {
        ...newCatch,
        hydro,
      };
    } catch (error) {
      console.error("Hydro lookup failed:", error);
    }

    setCatches((current) => {
      const exists = current.some((fish) => fish.id === catchWithHydro.id);

      if (exists) {
        return current.map((fish) =>
          fish.id === catchWithHydro.id ? { ...fish, ...catchWithHydro } : fish,
        );
      }

      return [catchWithHydro, ...current];
    });

    setPage("log");
  }
  function deleteCatch(id) {
    setCatches((current) => current.filter((fish) => fish.id !== id));
  }

  function updateCatch(id, updates) {
    setCatches((current) =>
      current.map((fish) => (fish.id === id ? { ...fish, ...updates } : fish)),
    );
  }

  const pageView = useMemo(() => {
    if (page === "home") return <Home setPage={setPage} catches={catches} />;
    if (page === "add")
      return (
        <AddFishPage
          onSaveCatch={saveCatch}
          MAPBOX_TOKEN={MAPBOX_TOKEN}
          fileToCompressedDataUrl={fileToCompressedDataUrl}
          makeImageKey={makeImageKey}
          getCorrection={getCorrection}
          saveCorrection={saveCorrection}
          getTrainingExamples={getTrainingExamples}
          getSpeciesMemory={getSpeciesMemory}
          saveTrainingExample={saveTrainingExample}
          cleanSpeciesName={cleanSpeciesName}
          getMoonPhase={getMoonPhase}
          saveWaterName={saveWaterName}
          lookupWaterbody={lookupWaterbody}
          getWeather={getWeather}
          getAllWaterData={getAllWaterData}
          getManagedWaterData={getManagedWaterData}
          getRecentWeatherAverages={getRecentWeatherAverages}
        />
      );
    if (page === "log") {
      return (
        <LogPage
          catches={catches}
          onDeleteCatch={deleteCatch}
          onUpdateCatch={updateCatch}
          setPage={setPage}
          setEditingCatchId={setEditingCatchId}
        />
      );
    }
    if (page === "editCatch") {
      const fishToEdit = catches.find((fish) => fish.id === editingCatchId);

      return (
        <EditCatchPage
          fish={fishToEdit}
          onUpdateCatch={updateCatch}
          setPage={setPage}
        />
      );
    }
    if (page === "map") {
      return (
        <MapPage
          catches={catches}
          setPage={setPage}
          setPredictionLocation={setPredictionLocation}
          getCurrentWeather={getCurrentWeather}
          getRecentWeatherAverages={getRecentWeatherAverages}
        />
      );
    }

    if (page === "prediction") {
      return (
        <PredictionPage
          catches={catches}
          setPage={setPage}
          getWeather={getCurrentWeather}
          getRecentWeatherAverages={getRecentWeatherAverages}
          predictionLocation={predictionLocation}
        />
      );
    }
    if (page === "settings") return <PlaceholderPage title="Settings" />;
    return <Home setPage={setPage} catches={catches} />;
  }, [page, catches]);

  return (
    <>
      {showSplash && (
        <div className="biteSplash">
          <div className="biteSplashOverlay" />

          <video
            className="biteSplashVideo"
            src={splashVideo}
            autoPlay
            muted
            playsInline
          />

          <div className="biteSplashContent">
            <div className="biteLogo">BiteLogic</div>

            <div className="biteTagline">Stop guessing. Find patterns.</div>

            <div className="sonarWrap">
              <div className="sonarRing ring1" />
              <div className="sonarRing ring2" />
              <div className="sonarRing ring3" />
            </div>

            <div className="loadingBar">
              <div className="loadingFill" />
            </div>

            <div className="loadingText">Finding water...</div>
          </div>
        </div>
      )}

      <div className="app">
        {pageView}

        <nav className="bottomNav">
          <button
            onClick={() => setPage("home")}
            className={page === "home" ? "active" : ""}
          >
            🏠<span>Home</span>
          </button>

          <button
            onClick={() => setPage("map")}
            className={page === "map" ? "active" : ""}
          >
            🗺️<span>Map</span>
          </button>

          <button onClick={() => setPage("add")} className="addButton">
            ＋
          </button>

          <button
            onClick={() => setPage("prediction")}
            className={page === "prediction" ? "active" : ""}
          >
            🎯<span>Predict</span>
          </button>

          <button
            onClick={() => setPage("log")}
            className={page === "log" ? "active" : ""}
          >
            📒<span>Log</span>
          </button>
        </nav>
      </div>
    </>
  );
}
