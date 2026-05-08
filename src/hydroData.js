const USGS_PARAMS = [
  "00060", // discharge / flow cfs
  "00065", // gage height ft
  "00010", // water temp C
  "62614", // lake/reservoir elevation ft, where available
].join(",");

function normalizeText(value = "") {
  return String(value).toLowerCase();
}

function cToF(c) {
  const n = Number(c);
  if (!Number.isFinite(n)) return null;
  return Math.round(((n * 9) / 5 + 32) * 10) / 10;
}

function isRecentCatch(dateValue, maxHours = 6) {
  const catchTime = new Date(dateValue).getTime();
  if (!Number.isFinite(catchTime)) return false;

  const diffHours = Math.abs(Date.now() - catchTime) / 36e5;
  return diffHours <= maxHours;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Hydro request failed: ${res.status}`);
  return res.json();
}

function parseUsgsSeries(json) {
  const series = json?.value?.timeSeries || [];

  const result = {
  source: "USGS",
  dischargeCfs: null,
  gageHeightFt: null,
  waterTempF: null,
  reservoirElevationFt: null,
  observedAt: null,
  raw: [],
};

  for (const item of series) {
    const code = item?.variable?.variableCode?.[0]?.value;
    const variableName = item?.variable?.variableName;
    const point = item?.values?.[0]?.value?.at(-1);
    const value = point?.value;
    const dateTime = point?.dateTime;

    result.raw.push({ code, variableName, value, dateTime });

    if (!result.observedAt && dateTime) result.observedAt = dateTime;

    if (code === "00060") result.dischargeCfs = Number(value);
    if (code === "00065") result.gageHeightFt = Number(value);
    if (code === "00010") result.waterTempF = cToF(value);
    if (code === "62614") result.reservoirElevationFt = Number(value);
  }

  return result;
}

async function getNearestUsgsHydro({ lat, lng }) {
  const delta = 0.35;

  const bBox = [lng - delta, lat - delta, lng + delta, lat + delta].join(",");

  const url =
    "https://waterservices.usgs.gov/nwis/iv/?" +
    new URLSearchParams({
      format: "json",
      bBox,
      parameterCd: USGS_PARAMS,
      siteStatus: "all",
    }).toString();

  const json = await fetchJson(url);
  return parseUsgsSeries(json);
}

function shouldTryGeorgiaPower(managedBy = "", waterbodyName = "") {
  const text = normalizeText(`${managedBy} ${waterbodyName}`);
  return (
    text.includes("georgia power") ||
    text.includes("southern company") ||
    text.includes("goat rock") ||
    text.includes("lake harding") ||
    text.includes("bartlett") ||
    text.includes("oliver")
  );
}

async function getGeorgiaPowerHydro({ waterbodyName }) {
    const url =
  `http://192.168.1.203:3001/api/hydro/georgia-power?lake=` +
  encodeURIComponent(waterbodyName || "");

  const data = await fetchJson(url);

  const operationsUrl =
  `http://192.168.1.203:3001/api/hydro/georgia-power-operations?lake=` +
  encodeURIComponent(waterbodyName || "");

let operations = null;

try {
  operations = await fetchJson(operationsUrl);
} catch (e) {
  console.log("Georgia Power operations failed", e);
}

  if (!data?.found) {
    return {
      source: "Georgia Power / Southern Company",
      note: data?.note || "Georgia Power data not found.",
      waterbodyName,
      lakeLevelFt: null,
      fullPoolFt: null,
      feetFromFullPool: null,
      turbineRelease: null,
      generation: null,
      releaseSchedule: null,
      observedAt: null,
    };
  }

  return {
    source: data.source,
    note: `Georgia Power CURRENT lake data pulled successfully. Updated: ${
      data.updatedText || "unknown"
    }`,
    waterbodyName: data.lake,
    lakeLevelFt: operations?.lakeLevelFt ?? data.lakeLevelFt,
fullPoolFt: data.fullPoolFt,
feetFromFullPool:
  data.fullPoolFt != null && (operations?.lakeLevelFt ?? data.lakeLevelFt) != null
    ? Number(((operations?.lakeLevelFt ?? data.lakeLevelFt) - data.fullPoolFt).toFixed(2))
    : data.feetFromFullPool,

rainInches: data.rainInches,
generation: operations?.schedule?.[0]?.units ?? data.generation,
turbineRelease: operations?.turbineReleaseCfs ?? null,
releaseSchedule: operations?.schedule || null,
specialOperationMessage: operations?.specialOperationMessage || null,
observedAt: operations?.observedAt || data.updatedText,
  };
}

function shouldTryUsace(managedBy = "", waterbodyName = "") {
  const text = normalizeText(`${managedBy} ${waterbodyName}`);

  return (
    text.includes("usace") ||
    text.includes("corps") ||
    text.includes("army corps") ||
    text.includes("west point") ||
    text.includes("hartwell") ||
    text.includes("lanier")
  );
}

function toUsaceLakeId(waterbodyName = "") {
  const clean = String(waterbodyName)
    .replace(/lake/gi, "")
    .replace(/dam/gi, "")
    .replace(/\s+/g, "")
    .trim();

  if (clean.toLowerCase().includes("westpoint")) return "WestPoint";

  return clean;
}

async function getUsaceHydro({ waterbodyName }) {
  const lakeId = toUsaceLakeId(waterbodyName);

  const url =
    `http://192.168.1.203:3001/api/hydro/usace?lake=` +
    encodeURIComponent(lakeId);

  const data = await fetchJson(url);

  if (!data?.found) {
    return {
      source: "USACE CWMS",
      note: "USACE data not found.",
      waterbodyName,
      lakeLevelFt: null,
      dischargeCfs: null,
      inflowCfs: null,
      observedAt: null,
    };
  }

  return {
  source: data.source,
  note: `USACE lake data pulled successfully.`,
  waterbodyName: data.lake,
  lakeLevelFt: data.lakeLevelFt,
  fullPoolFt: data.fullPoolFt,
  feetFromFullPool: data.feetFromFullPool,
  dischargeCfs: data.dischargeCfs,
  inflowCfs: data.inflowCfs,
  observedAt: data.observedAt,
};
}

async function getLakeLevelsInfo({ waterbodyName }) {
  const url =
    `http://192.168.1.203:3001/api/hydro/lakelevels?lake=` +
    encodeURIComponent(waterbodyName || "");

  const data = await fetchJson(url);

  if (!data?.found) return null;

  return {
    source: data.source,
    lakeLevelFt: data.lakeLevelFt,
    fullPoolFt: data.fullPoolFt,
    feetFromFullPool: data.feetFromFullPool,
    observedAt: data.observedAt,
    note: "LakeLevels.info fallback/full-pool data pulled successfully.",
  };
}

export async function getHydroDataForCatch(catchRecord) {
  const lat =
    catchRecord?.lat ??
    catchRecord?.latitude ??
    catchRecord?.gps?.latitude;

  const lng =
    catchRecord?.lng ??
    catchRecord?.longitude ??
    catchRecord?.gps?.longitude;

  const managedBy =
    catchRecord?.managedBy ||
    catchRecord?.managed_by ||
    catchRecord?.managedWater?.provider ||
    catchRecord?.waterbody?.managedBy ||
    "";

  const waterbodyName =
    catchRecord?.waterbodyName ||
    catchRecord?.waterbody_name ||
    catchRecord?.lakeName ||
    catchRecord?.locationName ||
    catchRecord?.lake ||
    "";

  const hydro = {
    managedBy,
    waterbodyName,
    sourcesTried: [],
    sourceUsed: null,
    confidence: "low",

    lakeLevelFt: null,
    fullPoolFt: null,
    feetFromFullPool: null,
    dischargeCfs: null,
    inflowCfs: null,
    gageHeightFt: null,
    waterTempF: null,
    turbineRelease: null,
    generation: null,
    releaseSchedule: null,
    observedAt: null,

    dataTiming: "unknown",
    notes: [],
  };

  const recent = isRecentCatch(catchRecord?.date, 6);

  if (shouldTryGeorgiaPower(managedBy, waterbodyName)) {
    hydro.sourcesTried.push("Georgia Power / Southern Company");

    if (!recent) {
      hydro.notes.push(
        "Georgia Power live lake data skipped because this catch is not recent."
      );
    } else {
      try {
        const ga = await getGeorgiaPowerHydro({ waterbodyName });

        hydro.notes.push(ga.note);
        hydro.sourceUsed = ga.source;
        hydro.dataTiming = "current-live";

        hydro.lakeLevelFt = ga.lakeLevelFt;
        hydro.fullPoolFt = ga.fullPoolFt;
        hydro.feetFromFullPool = ga.feetFromFullPool;
        hydro.turbineRelease = ga.turbineRelease;
        hydro.generation = ga.generation;
        hydro.releaseSchedule = ga.releaseSchedule;
        hydro.observedAt = ga.observedAt;

        if (ga.lakeLevelFt || ga.fullPoolFt) {
          hydro.confidence = "high";
        }
      } catch (err) {
        hydro.notes.push(`Georgia Power lookup failed: ${err.message}`);
      }
    }
  }

   if (hydro.sourceUsed === null && shouldTryUsace(managedBy, waterbodyName)) {
  hydro.sourcesTried.push("USACE CWMS");

  try {
    const usace = await getUsaceHydro({ waterbodyName });

    hydro.notes.push(usace.note);
    hydro.sourceUsed = usace.source;
    hydro.dataTiming = "current-live";

    hydro.lakeLevelFt = hydro.lakeLevelFt ?? usace.lakeLevelFt;
hydro.fullPoolFt = hydro.fullPoolFt ?? usace.fullPoolFt;
hydro.feetFromFullPool = hydro.feetFromFullPool ?? usace.feetFromFullPool;
hydro.dischargeCfs = hydro.dischargeCfs ?? usace.dischargeCfs;
hydro.inflowCfs = usace.inflowCfs;
hydro.observedAt = hydro.observedAt ?? usace.observedAt;

    if (usace.lakeLevelFt || usace.dischargeCfs || usace.inflowCfs) {
      hydro.confidence = "high";
    }
  } catch (err) {
    hydro.notes.push(`USACE lookup failed: ${err.message}`);
  }
}

  if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
    hydro.sourcesTried.push("USGS");

    try {
  const lakeLevels = await getLakeLevelsInfo({ waterbodyName });

  if (lakeLevels) {
    hydro.sourcesTried.push("LakeLevels.info");

    hydro.lakeLevelFt = hydro.lakeLevelFt ?? lakeLevels.lakeLevelFt;
    hydro.fullPoolFt = hydro.fullPoolFt ?? lakeLevels.fullPoolFt;
    hydro.feetFromFullPool =
      hydro.feetFromFullPool ?? lakeLevels.feetFromFullPool;
    hydro.observedAt = hydro.observedAt ?? lakeLevels.observedAt;

    hydro.notes.push(lakeLevels.note);

    if (!hydro.sourceUsed) {
      hydro.sourceUsed = "LakeLevels.info";
    }

    if (hydro.confidence !== "high" && lakeLevels.lakeLevelFt) {
      hydro.confidence = "medium";
    }
  }
} catch (err) {
  hydro.notes.push(`LakeLevels.info lookup failed: ${err.message}`);
}

    try {
      const usgs = await getNearestUsgsHydro({
        lat: Number(lat),
        lng: Number(lng),
      });

      hydro.dischargeCfs = hydro.dischargeCfs ?? usgs.dischargeCfs;
hydro.gageHeightFt = hydro.gageHeightFt ?? usgs.gageHeightFt;
hydro.waterTempF = hydro.waterTempF ?? usgs.waterTempF;
      hydro.lakeLevelFt = hydro.lakeLevelFt ?? usgs.reservoirElevationFt;
      hydro.observedAt = hydro.observedAt ?? usgs.observedAt;

      if (!hydro.sourceUsed) {
  hydro.sourceUsed = "USGS";
}

      if (
        hydro.confidence !== "high" &&
        (hydro.dischargeCfs ||
          hydro.gageHeightFt ||
          hydro.waterTempF ||
          hydro.lakeLevelFt)
      ) {
        hydro.confidence = "medium";
      }
    } catch (err) {
      hydro.notes.push(`USGS lookup failed: ${err.message}`);
    }
  }

  if (!hydro.sourceUsed) {
    hydro.sourceUsed = "none";
    hydro.notes.push("No verified hydro source found for this catch.");
  }

  return hydro;
}