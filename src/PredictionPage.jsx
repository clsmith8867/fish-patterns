import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useMemo, useState } from "react";
import Map, { Marker, Popup } from "react-map-gl/mapbox";
import { buildFishingPrediction, buildPatternMemory } from "./predictionEngine";
import { estimateWaterTempFromWeather } from "./utils/fishing";
import { getPatternStrength } from "./utils/patterns";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

function getFishIconEmoji(species = "") {
  const name = species.toLowerCase();
  if (name.includes("bass")) return "🐟";
  if (name.includes("crappie")) return "🐠";
  if (name.includes("cat")) return "🐡";
  if (name.includes("trout")) return "🎣";
  return "🐟";
}

function average(nums) {
  const clean = nums.map(Number).filter((n) => !Number.isNaN(n));
  if (!clean.length) return null;
  return clean.reduce((sum, n) => sum + n, 0) / clean.length;
}

function summarizeMatches(matches) {
  const baitCounts = {};
  const patternCounts = {};
  const confidenceValues = [];

  matches.forEach((fish) => {
    if (fish.bait && fish.bait !== "Unknown bait") {
      baitCounts[fish.bait] = (baitCounts[fish.bait] || 0) + 1;
    }

    if (fish.patternTag) {
      patternCounts[fish.patternTag] =
        (patternCounts[fish.patternTag] || 0) + 1;
    }

    if (fish.confidence) confidenceValues.push(Number(fish.confidence));
  });

  return {
    topBait: Object.entries(baitCounts).sort((a, b) => b[1] - a[1])[0],
    topPattern: Object.entries(patternCounts).sort((a, b) => b[1] - a[1])[0],
    avgConfidence: average(confidenceValues),
  };
}

export default function PredictionPage({
  catches = [],
  setPage,
  getWeather,
  getRecentWeatherAverages,
  predictionLocation,
}) {
  const [species, setSpecies] = useState("Largemouth Bass");
  const [lake, setLake] = useState("Any Water");
  const [location, setLocation] = useState(null);
  const [predictionWeather, setPredictionWeather] = useState(null);
  const [status, setStatus] = useState("Choose target water");
  const [selectedCatch, setSelectedCatch] = useState(null);
  const [isMapFullScreen, setIsMapFullScreen] = useState(false);

  const speciesOptions = [
    "Largemouth Bass",
    "Spotted Bass",
    "Striped Bass",
    "Crappie",
    "Bluegill / Bream",
    "Catfish",
    "Trout",
    "Any Species",
  ];

  const lakeOptions = useMemo(() => {
    const saved = Array.from(
      new Set(catches.map((fish) => fish.lake).filter(Boolean)),
    );

    return ["Any Water", ...saved];
  }, [catches]);

  useEffect(() => {
    if (predictionLocation?.lake) {
      setLake(predictionLocation.lake);
    }

    if (predictionLocation?.latitude && predictionLocation?.longitude) {
      setLocation({
        latitude: predictionLocation.latitude,
        longitude: predictionLocation.longitude,
      });
      setStatus("Using selected water");
    }
  }, [predictionLocation]);

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setStatus("GPS not supported");
      return;
    }

    setStatus("Finding your location...");

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
        setStatus("Using current location");
      },
      () => {
        setStatus("GPS denied");
      },
      {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 300000,
      },
    );
  }

  useEffect(() => {
    async function load() {
      if (!location || !getWeather || !getRecentWeatherAverages) return;

      try {
        const now = new Date().toISOString();

        const data = await getWeather(
          location.latitude,
          location.longitude,
          now,
        );

        const recent = await getRecentWeatherAverages(
          location.latitude,
          location.longitude,
          now,
        );

        setPredictionWeather({
          ...data.current,
          ...recent,
          date: now,
        });

        setStatus("Using current conditions");
      } catch (e) {
        console.log("Prediction weather failed", e);
        setStatus("Using saved catch history");
      }
    }

    load();
  }, [location, getWeather, getRecentWeatherAverages]);

  const normalizedWeather = predictionWeather
    ? {
        temp: predictionWeather.temperature_2m,
        wind: predictionWeather.wind_speed_10m,
        cloud: predictionWeather.cloud_cover,
        pressure: predictionWeather.pressure_msl,
        rain: predictionWeather.rain ?? predictionWeather.precipitation,
      }
    : null;

  const recent = catches[0];
  const weather = normalizedWeather || recent?.weather || {};

  const measuredWater =
    recent?.water?.summary?.waterTempSource === "USGS" ||
    recent?.water?.summary?.waterTempSource === "NOAA"
      ? recent.water.summary
      : {};

  const memory = buildPatternMemory(catches, species, lake);

  const prediction = buildFishingPrediction({
    species,
    weather,
    water: {
      waterTemp:
        measuredWater.waterTemp ?? estimateWaterTempFromWeather(weather),
    },
    memory,
  });

  const { temp, wind, clouds, pressure, rain, waterTemp } = prediction.inputs;

  const patternStrength = getPatternStrength(catches, {
    lake,
    temp,
    wind,
    cloud: clouds,
    pressure,
    rain,
    waterTemp,
  });

  const matches = patternStrength.bestMatches || [];
  const matchSummary = summarizeMatches(matches);
  const gpsCatches = catches.filter((fish) => fish.gps);
  const matchingIds = new Set(matches.map((fish) => fish.id));

  const mapCenter = location || {
    latitude: gpsCatches[0]?.gps?.latitude || 32.47098,
    longitude: gpsCatches[0]?.gps?.longitude || -85.00077,
  };

  const predictionMap = (
    <Map
      initialViewState={{
        longitude: mapCenter.longitude,
        latitude: mapCenter.latitude,
        zoom: 10,
      }}
      mapboxAccessToken={MAPBOX_TOKEN}
      mapStyle="mapbox://styles/mapbox/satellite-streets-v12"
      style={{ width: "100%", height: "100%" }}
    >
      {location && (
        <Marker
          longitude={location.longitude}
          latitude={location.latitude}
          anchor="center"
        >
          <div className="currentLocationPulse">●</div>
        </Marker>
      )}

      {gpsCatches.map((fish) => {
        const isMatch = matchingIds.has(fish.id);

        return (
          <Marker
            key={fish.id}
            longitude={fish.gps.longitude}
            latitude={fish.gps.latitude}
            anchor="center"
          >
            <button
              className={
                isMatch
                  ? "predictionCatchMarker match"
                  : "predictionCatchMarker"
              }
              onClick={() => setSelectedCatch(fish)}
            >
              {getFishIconEmoji(fish.species)}
            </button>
          </Marker>
        );
      })}

      {selectedCatch && (
        <Popup
          longitude={selectedCatch.gps.longitude}
          latitude={selectedCatch.gps.latitude}
          anchor="top"
          closeOnClick={false}
          onClose={() => setSelectedCatch(null)}
        >
          <div className="mapPopup">
            <h3>{selectedCatch.species}</h3>
            <p>{selectedCatch.lake}</p>
            <p>🎣 {selectedCatch.bait}</p>
            {selectedCatch.patternTag && <p>📍 {selectedCatch.patternTag}</p>}
          </div>
        </Popup>
      )}
    </Map>
  );

  return (
    <main className="screen predictionScreen">
      <section className="predictionHeroNew">
        <p className="sectionLabel green">BiteLogic Prediction</p>

        <div className="predictionScoreRow">
          <strong>{patternStrength.strength}%</strong>
          <div>
            <h1>{patternStrength.label}</h1>
            <p>{status}</p>
          </div>
        </div>

        <p className="predictionMainLine">
          {lake !== "Any Water" ? lake : "Pick a water body for a better read"}{" "}
          • {species}
        </p>
      </section>

      <section className="panel predictionControls">
        <h2>Target</h2>

        <button
          className="greenButton saveFishButton"
          onClick={useCurrentLocation}
        >
          Use Current Location <span>›</span>
        </button>

        <label>
          Favorite / Recent Water
          <select value={lake} onChange={(e) => setLake(e.target.value)}>
            {lakeOptions.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>

        <label>
          Species
          <select value={species} onChange={(e) => setSpecies(e.target.value)}>
            {speciesOptions.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
      </section>

      <section className="panel predictionMapCard">
        <div className="predictionSectionHeader">
          <h2>Prediction Map</h2>
          <span>Tap map for full screen</span>
        </div>

        <button
          type="button"
          className="predictionMiniMap mapButtonReset"
          onClick={() => setIsMapFullScreen(true)}
        >
          {predictionMap}
        </button>
      </section>

      <section className="predictionGridCards">
        <div className="panel predictionCard">
          <h2>Where To Start</h2>
          <p className="bigRecommendation">
            {matchSummary.topPattern?.[0] || prediction.location}
          </p>
          <p className="muted">
            {matchSummary.topPattern
              ? "Based on your strongest matching catches."
              : "General read until more catches build history."}
          </p>
        </div>

        <div className="panel predictionCard">
          <h2>What To Throw</h2>
          <p className="bigRecommendation">
            {matchSummary.topBait?.[0] || prediction.lure}
          </p>
          <p className="muted">
            {matchSummary.topBait
              ? "Your best lure from similar catches."
              : "Based on season and current conditions."}
          </p>
        </div>

        <div className="panel predictionCard">
          <h2>Depth</h2>
          <p className="bigRecommendation">{prediction.depth}</p>
        </div>

        <div className="panel predictionCard">
          <h2>Why</h2>
          <div className="whyGrid">
            <div>
              <strong>{Math.round(waterTemp)}°</strong>
              <span>Water</span>
            </div>
            <div>
              <strong>{Math.round(wind)}</strong>
              <span>Wind</span>
            </div>
            <div>
              <strong>{Math.round(clouds)}%</strong>
              <span>Clouds</span>
            </div>
            <div>
              <strong>{prediction.season}</strong>
              <span>Season</span>
            </div>
          </div>
          <p>{prediction.reason}</p>
        </div>
      </section>

      <button
        className="greenButton saveFishButton"
        onClick={() => setPage("add")}
      >
        Log Catch To Improve Prediction <span>›</span>
      </button>

      {isMapFullScreen && (
        <div className="predictionMapOverlay">
          <div className="predictionMapTopBar">
            <strong>Prediction Map</strong>
            <button type="button" onClick={() => setIsMapFullScreen(false)}>
              Close
            </button>
          </div>

          <div className="predictionFullMap">{predictionMap}</div>
        </div>
      )}

      <div className="homeBottomSpacer" />
    </main>
  );
}
