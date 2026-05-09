import { useEffect, useRef, useState } from "react";
import Map, { Marker } from "react-map-gl/mapbox";
import exifr from "exifr";
import FishIdPanel from "../FishIdPanel";
import LurePicker from "../LurePicker";
import { identifyFish } from "../utils/fishIdApi";
import { estimateWaterTempFromWeather } from "../utils/fishing";

export default function AddFishPage({
  onSaveCatch,
  MAPBOX_TOKEN,
  fileToCompressedDataUrl,
  makeImageKey,
  getCorrection,
  saveCorrection,
  getTrainingExamples,
  getSpeciesMemory,
  saveTrainingExample,
  cleanSpeciesName,
  getMoonPhase,
  saveWaterName,
  lookupWaterbody,
  getWeather,
  getRecentWeatherAverages,
  getAllWaterData,
  getManagedWaterData,
}) {
  const cameraRef = useRef(null);
  const fileRef = useRef(null);
  const pickerMapRef = useRef(null);
  const [showLurePicker, setShowLurePicker] = useState(false);

  const [photo, setPhoto] = useState(null);
  const [photoKey, setPhotoKey] = useState(null);
  const [fishIdResults, setFishIdResults] = useState([]);
  const [correctedFishIdName, setCorrectedFishIdName] = useState("");
  const [aiResult, setAiResult] = useState(null);
  const [finalSpecies, setFinalSpecies] = useState("");
  const finalSpeciesRef = useRef("");
  const [gps, setGps] = useState(null);
  const [gpsStatus, setGpsStatus] = useState("Waiting");
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [pickedLocation, setPickedLocation] = useState(null);
  const [manualLake, setManualLake] = useState("");
  const [catchDate, setCatchDate] = useState(new Date().toISOString());
  const [manualInfo, setManualInfo] = useState({
    weatherTemp: "",
    waterTemp: "",
    lakeLevelFt: "",
    fullPoolFt: "",
    feetFromFullPool: "",
    flowCfs: "",
    moon: "",
  });

  function updateManualInfo(field, value) {
    setManualInfo((current) => ({ ...current, [field]: value }));
  }

  function updateCatchDatePart(part, value) {
    const current = new Date(catchDate);

    if (part === "date") {
      const [year, month, day] = value.split("-").map(Number);
      current.setFullYear(year, month - 1, day);
    }

    if (part === "time") {
      const [hours, minutes] = value.split(":").map(Number);
      current.setHours(hours, minutes, 0, 0);
    }

    setCatchDate(current.toISOString());
  }

  function buildManualHydro() {
    const hasManualHydro =
      manualInfo.lakeLevelFt ||
      manualInfo.fullPoolFt ||
      manualInfo.feetFromFullPool ||
      manualInfo.flowCfs ||
      manualInfo.waterTemp;

    if (!hasManualHydro) return null;

    return {
      sourceUsed: "Manual entry",
      confidence: "manual",
      lakeLevelFt: manualInfo.lakeLevelFt
        ? Number(manualInfo.lakeLevelFt)
        : null,
      fullPoolFt: manualInfo.fullPoolFt ? Number(manualInfo.fullPoolFt) : null,
      feetFromFullPool: manualInfo.feetFromFullPool
        ? Number(manualInfo.feetFromFullPool)
        : null,
      dischargeCfs: manualInfo.flowCfs ? Number(manualInfo.flowCfs) : null,
      waterTempF: manualInfo.waterTemp ? Number(manualInfo.waterTemp) : null,
      notes: ["Manually entered on Add Catch screen."],
    };
  }
  const [isSaving, setIsSaving] = useState(false);
  const [isProcessingPhoto, setIsProcessingPhoto] = useState(false);
  const [form, setForm] = useState({
    species: "",
    weight: "",
    length: "",
    bait: "",
    notes: "",
    patternTag: "",
    cover: "",
    position: "",
    depth: "",
    confidence: 3,
  });

  useEffect(() => {
    try {
      const savedText = localStorage.getItem("last-lure");
      if (!savedText) return;

      const saved = JSON.parse(savedText);

      if (saved?.type) {
        setForm((current) => ({
          ...current,
          bait: `${saved.type} (${saved.color || "Not specified"})`,
        }));
      }
    } catch {
      localStorage.removeItem("last-lure");
    }
  }, []);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handlePhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    setIsProcessingPhoto(true);

    const dataUrl = await fileToCompressedDataUrl(file);
    const key = makeImageKey(dataUrl);

    console.log("PHOTO KEY:", key);
    console.log("SAVED CORRECTION:", getCorrection(key));

    setPhotoKey(key);
    setCorrectedFishIdName("");
    setPhoto(dataUrl);

    const detected = await identifyFish(dataUrl, getTrainingExamples());
    setAiResult(detected);

    const correctedSpecies = getCorrection(key);

    if (correctedSpecies) {
      setCorrectedFishIdName(correctedSpecies);

      setForm((current) => ({
        ...current,
        species: correctedSpecies,
      }));

      setFishIdResults([
        {
          label: correctedSpecies,
          score: 0.99,
        },
      ]);
    } else if (detected?.species) {
      setAiResult(detected);

      setForm((current) => ({
        ...current,
        species: detected.species,
      }));

      if (detected.topGuesses?.length) {
        console.log("USING BACKEND TOP GUESSES:", detected.topGuesses);
        const memory = getSpeciesMemory();

        const mappedGuesses = detected.topGuesses.map((guess) => {
          let score = Number(guess.confidence || 0) / 100;

          if (memory[guess.species]) {
            const boost = Math.min(memory[guess.species].count * 0.05, 0.25);
            score += boost;
          }

          return {
            label: guess.species,
            score,
          };
        });

        setFishIdResults(mappedGuesses);

        const bestGuess = mappedGuesses[0]?.label;

        if (bestGuess && bestGuess !== "Unidentified Fish") {
          setForm((current) => ({
            ...current,
            species: bestGuess,
          }));
        }
      } else {
        setFishIdResults([
          {
            label: detected.species,
            score: detected.confidence ? detected.confidence / 100 : 0.75,
          },
        ]);
      }
    } else {
      setFishIdResults([]);
    }

    try {
      setGpsStatus("Reading photo info...");

      const gpsData = await exifr.gps(file);
      const exifData = await exifr.parse(file, [
        "DateTimeOriginal",
        "CreateDate",
      ]);

      if (exifData?.DateTimeOriginal || exifData?.CreateDate) {
        const photoDate = exifData.DateTimeOriginal || exifData.CreateDate;
        setCatchDate(new Date(photoDate).toISOString());
      }

      if (gpsData?.latitude && gpsData?.longitude) {
        setGps({
          latitude: gpsData.latitude,
          longitude: gpsData.longitude,
        });
        setGpsStatus("Photo GPS saved");
      } else {
        setGpsStatus("No photo GPS found");
      }
    } catch (error) {
      console.error(error);
      setGpsStatus("Photo info failed");
    }
    setIsProcessingPhoto(false);
  }

  function getGpsLocation() {
    if (!navigator.geolocation) {
      setGpsStatus("GPS not supported");
      return;
    }

    setGpsStatus("Getting location...");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGps({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        setGpsStatus("Current GPS saved");
      },
      () => setGpsStatus("GPS denied"),
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      },
    );
  }

  async function save() {
    if (isSaving) return;
    setIsSaving(true);

    const saveGps = gps || pickedLocation;

    console.log("GPS USED FOR SAVE:", saveGps);

    if (!saveGps) {
      alert(
        "Add a GPS location first. Use Current Location or Pick Location on Map.",
      );
      setIsSaving(false);
      return;
    }

    let detectedFish = null;

    if (photo && !form.species) {
      try {
        detectedFish = await identifyFish(photo, getTrainingExamples());
        console.log("DETECTED FISH:", detectedFish);
      } catch {}
    }

    const corrected = getCorrection(photoKey);
    const moon = manualInfo.moon.trim() || getMoonPhase(catchDate);
    const manualHydro = buildManualHydro();

    const startingLake = manualLake.trim() || "Finding water...";

    const newCatch = {
      id: Date.now(),
      isLoadingConditions: true,
      species:
        cleanSpeciesName(finalSpeciesRef.current) ||
        cleanSpeciesName(corrected) ||
        cleanSpeciesName(form.species) ||
        cleanSpeciesName(aiResult?.species) ||
        cleanSpeciesName(fishIdResults?.[0]?.label) ||
        "Unidentified Fish",
      scientificName: detectedFish?.scientificName || "",
      aiSource: detectedFish?.source || "",
      size: form.weight || form.length || "No size",
      lake: startingLake,
      bait: form.bait || "Unknown bait",
      patternTag: [form.cover, form.position, form.depth]
        .filter(Boolean)
        .join(", "),
      cover: form.cover || "",
      position: form.position || "",
      depth: form.depth || "",
      confidence: form.confidence,
      date: catchDate,
      notes: form.notes || "No notes yet",
      photo,
      photoKey,
      gps: {
        latitude: saveGps.latitude,
        longitude: saveGps.longitude,
      },
      weather: manualInfo.weatherTemp
        ? { temp: Number(manualInfo.weatherTemp), source: "Manual entry" }
        : null,
      water: manualInfo.waterTemp
        ? {
            summary: {
              waterTemp: Number(manualInfo.waterTemp),
              waterTempSource: "Manual entry",
              waterTempUnit: "°F",
            },
          }
        : null,
      hydro: manualHydro,
      managedWater: null,
      moon,
    };

    if (manualLake.trim()) {
      saveWaterName(saveGps.latitude, saveGps.longitude, manualLake.trim());
    }

    onSaveCatch(newCatch);

    try {
      let finalLake = manualLake.trim();
      let weather = null;
      let water = null;
      let managedWater = null;

      // 🔥 Waterbody lookup FIRST (this is your key fix)
      try {
        if (!finalLake) {
          const lookup = await lookupWaterbody(
            saveGps.latitude,
            saveGps.longitude,
          );

          console.log("WATER LOOKUP RESULT:", lookup);

          finalLake =
            lookup?.primaryWaterbody ||
            lookup?.secondaryFeature ||
            "Unknown water";
        }
      } catch (e) {
        console.log("Waterbody lookup failed", e);
        finalLake = "Unknown water";
      }

      // 🌤 Weather (don’t let it break everything)
      try {
        weather = await getWeather(
          saveGps.latitude,
          saveGps.longitude,
          catchDate,
        );

        const recentWeather = await getRecentWeatherAverages(
          saveGps.latitude,
          saveGps.longitude,
          catchDate,
        );

        weather = {
          ...weather,
          ...recentWeather,
        };
      } catch (e) {
        console.log("Weather failed", e);
      }

      // 🌊 Water data
      try {
        water = await getAllWaterData(
          saveGps.latitude,
          saveGps.longitude,
          finalLake,
        );

        const modeledWaterTemp = estimateWaterTempFromWeather(weather);

        if (!water?.summary?.waterTemp && modeledWaterTemp != null) {
          water = {
            ...(water || {}),
            summary: {
              ...(water?.summary || {}),
              waterTemp: modeledWaterTemp,
              waterTempSource: "Estimated from 7-day air temp model",
              waterTempUnit: "°F",
            },
          };
        }
      } catch (e) {
        console.log("Water data failed", e);
      }

      // 🏗 Managed system
      try {
        managedWater = await getManagedWaterData(
          finalLake,
          saveGps.latitude,
          saveGps.longitude,
        );
      } catch (e) {
        console.log("Managed water failed", e);
      }

      onSaveCatch({
        ...newCatch,
        lake: finalLake,
        weather,
        water,
        managedWater,
        isLoadingConditions: false,
      });
    } catch (e) {
      console.log("Background fetch failed", e);

      onSaveCatch({
        ...newCatch,
        lake: "Unknown water",
        isLoadingConditions: false,
      });
    }

    setIsSaving(false);
  }

  return (
    <main className="screen">
      <h1>Add Fish</h1>

      <section className="panel cameraPanel">
        <p className="sectionLabel green">Camera First</p>

        <div className="cameraBox">
          {photo ? (
            <img src={photo} alt="Fish preview" className="previewImage" />
          ) : (
            "📸"
          )}
        </div>

        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={handlePhoto}
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={handlePhoto}
        />

        <button
          className="greenButton saveFishButton"
          onClick={() => cameraRef.current?.click()}
        >
          Snap Fish Photo <span>›</span>
        </button>

        <div className="photoActions">
          <button onClick={() => fileRef.current?.click()}>Choose Photo</button>
          <button>Enter Manually</button>
        </div>
        {photo && (
          <FishIdPanel
            imageId={photoKey || photo}
            rawResults={fishIdResults}
            correctedSpeciesName={correctedFishIdName}
            onSpeciesConfirmed={(speciesName) => {
              const cleanName = cleanSpeciesName(speciesName);

              if (!cleanName) return;

              setCorrectedFishIdName(cleanName);
              setFinalSpecies(cleanName);
              finalSpeciesRef.current = cleanName;

              setForm((current) => ({
                ...current,
                species: cleanName,
              }));

              setAiResult((current) => ({
                ...(current || {}),
                species: cleanName,
                confidence: 99,
              }));

              setFishIdResults([
                {
                  label: cleanName,
                  score: 0.99,
                },
              ]);

              if (photoKey) {
                saveCorrection(photoKey, cleanName);
              }

              saveTrainingExample(
                {
                  photo,
                  photoKey,
                  lake: manualLake,
                  gps,
                },
                cleanName,
              );
            }}
          />
        )}
      </section>

      <section className="panel formPanel">
        <p className="sectionLabel">Catch Conditions</p>

        <div className="infoGrid">
          <label>
            <strong>Date</strong>
            <input
              type="date"
              value={new Date(catchDate).toISOString().slice(0, 10)}
              onChange={(e) => updateCatchDatePart("date", e.target.value)}
            />
          </label>

          <label>
            <strong>Time</strong>
            <input
              type="time"
              value={new Date(catchDate).toTimeString().slice(0, 5)}
              onChange={(e) => updateCatchDatePart("time", e.target.value)}
            />
          </label>
        </div>

        <button className="greenButton saveFishButton" onClick={getGpsLocation}>
          Use Current Location <span>›</span>
        </button>

        <button
          type="button"
          className="greenButton saveFishButton"
          onClick={() => {
            setManualLake("");
            setPickedLocation(
              gps ? { latitude: gps.latitude, longitude: gps.longitude } : null,
            );
            setShowLocationPicker(true);
          }}
        >
          Pick Location on Map <span>›</span>
        </button>
      </section>
      <section className="panel formPanel">
        <p className="sectionLabel">Catch Details</p>

        <input
          placeholder="Lake / water name optional"
          value={manualLake}
          onChange={(e) => setManualLake(e.target.value)}
        />

        <input
          placeholder="Species"
          value={form.species}
          onChange={(e) => update("species", e.target.value)}
        />
        <input
          placeholder="Weight"
          value={form.weight}
          onChange={(e) => update("weight", e.target.value)}
        />
        <input
          placeholder="Length"
          value={form.length}
          onChange={(e) => update("length", e.target.value)}
        />
        <button
          type="button"
          className="greenButton saveFishButton"
          onClick={() => setShowLurePicker(true)}
        >
          {form.bait || "Select Lure"} <span>›</span>
        </button>

        <div className="sectionLabel">Fish Location</div>

        <select
          value={form.cover}
          onChange={(e) => update("cover", e.target.value)}
        >
          <option value="">Select cover / structure</option>
          <option>Grass</option>
          <option>Grass Edge</option>
          <option>Docks</option>
          <option>Laydowns</option>
          <option>Brush Pile</option>
          <option>Stumps</option>
          <option>Rock Wall</option>
          <option>Riprap</option>
          <option>Point</option>
          <option>Secondary Point</option>
          <option>Creek Channel</option>
          <option>Ledge</option>
          <option>Hump</option>
          <option>Roadbed</option>
          <option>Bridge</option>
          <option>Standing Timber</option>
        </select>

        <select
          value={form.position}
          onChange={(e) => update("position", e.target.value)}
        >
          <option value="">Select position / current</option>
          <option>Current Break</option>
          <option>Eddy</option>
          <option>Current Seam</option>
          <option>Wind-Blown Bank</option>
          <option>Shade Line</option>
          <option>Ambush Point</option>
          <option>Creek Mouth</option>
          <option>Back Of Pocket</option>
          <option>Main Lake Bank</option>
          <option>Shallow Flat</option>
        </select>

        <select
          value={form.depth}
          onChange={(e) => update("depth", e.target.value)}
        >
          <option value="">Select depth zone</option>
          <option>Surface</option>
          <option>1-3 ft</option>
          <option>4-8 ft</option>
          <option>9-15 ft</option>
          <option>16+ ft</option>
          <option>Suspended</option>
        </select>
        <textarea
          placeholder="Notes"
          value={form.notes}
          onChange={(e) => update("notes", e.target.value)}
        />

        <button
          className="greenButton saveFishButton"
          onClick={save}
          disabled={isSaving || isProcessingPhoto}
        >
          {isProcessingPhoto
            ? "Reading Photo..."
            : isSaving
              ? "Saving Catch..."
              : "Save Catch"}{" "}
          <span>›</span>
        </button>
      </section>

      {showLocationPicker && (
        <div className="map-picker-overlay">
          <Map
            ref={pickerMapRef}
            initialViewState={{
              longitude: pickedLocation?.longitude || gps?.longitude || -85.0,
              latitude: pickedLocation?.latitude || gps?.latitude || 32.461,
              zoom: 13,
            }}
            mapboxAccessToken={MAPBOX_TOKEN}
            mapStyle="mapbox://styles/mapbox/satellite-streets-v12"
            style={{ width: "100%", height: "100%" }}
            onClick={(e) => {
              setPickedLocation({
                latitude: e.lngLat.lat,
                longitude: e.lngLat.lng,
              });

              const map = pickerMapRef.current?.getMap?.();
              if (!map) return;

              const features = map.queryRenderedFeatures(e.point);

              console.log("MAPBOX CLICK FEATURES:", features);

              const waterFeature = features.find((feature) => {
                const props = feature.properties || {};
                const text = JSON.stringify(props).toLowerCase();

                return (
                  text.includes("goat rock") ||
                  text.includes("harding") ||
                  text.includes("oliver") ||
                  text.includes("lake") ||
                  text.includes("reservoir") ||
                  text.includes("river")
                );
              });

              const props = waterFeature?.properties || {};
              const foundName =
                props.name ||
                props.name_en ||
                props.name_script ||
                props.label ||
                props.class;

              if (foundName) {
                console.log("MAPBOX FOUND WATER:", foundName);
                setManualLake(foundName);
              }
            }}
          >
            {pickedLocation && (
              <Marker
                latitude={pickedLocation.latitude}
                longitude={pickedLocation.longitude}
                anchor="bottom"
              >
                <div className="picked-location-marker">📍</div>
              </Marker>
            )}
          </Map>

          <div className="map-picker-bar">
            <button
              type="button"
              onClick={() => {
                setShowLocationPicker(false);
              }}
            >
              Cancel
            </button>

            <button
              type="button"
              disabled={!pickedLocation}
              onClick={async () => {
                setGps({
                  latitude: pickedLocation.latitude,
                  longitude: pickedLocation.longitude,
                });

                setGpsStatus("Manual map location saved");

                setShowLocationPicker(false);
              }}
            >
              Use This Spot
            </button>
          </div>
        </div>
      )}
      {showLurePicker && (
        <LurePicker
          onSelect={(lure) => {
            update("bait", `${lure.type} (${lure.color})`);
            localStorage.setItem("last-lure", JSON.stringify(lure));
            setShowLurePicker(false);
          }}
          onClose={() => setShowLurePicker(false)}
        />
      )}
    </main>
  );
}
