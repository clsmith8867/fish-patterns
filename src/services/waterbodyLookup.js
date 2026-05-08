const NHD_BASE =
  "https://hydro.nationalmap.gov/arcgis/rest/services/NHDPlus_HR/MapServer";

async function arcgisQuery(layer, params) {
  const url = new URL(`${NHD_BASE}/${layer}/query`);

  Object.entries({
    f: "json",
    outFields: "*",
    returnGeometry: "true",
    outSR: "4326",
    ...params,
  }).forEach(([key, value]) => url.searchParams.set(key, value));

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`NHD query failed: ${res.status}`);
  return res.json();
}

const CACHE_KEY = "fish-patterns-waterbody-cache";

function roundedCoord(lat, lon) {
  return `${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}`;
}

function getCachedWaterbody(lat, lon) {
  try {
    const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
    return cache[roundedCoord(lat, lon)] || null;
  } catch {
    return null;
  }
}

function saveCachedWaterbody(lat, lon, result) {
  try {
    if (!result?.primaryWaterbody) return;

    const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");

    cache[roundedCoord(lat, lon)] = {
      ...result,
      cachedAt: new Date().toISOString()
    };

    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

function pointInPolygon(point, polygon) {
  const [x, y] = point;
  let inside = false;
  const rings = polygon?.rings || [];

  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0];
      const yi = ring[i][1];
      const xj = ring[j][0];
      const yj = ring[j][1];

      const intersect =
        yi > y !== yj > y &&
        x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

      if (intersect) inside = !inside;
    }
  }

  return inside;
}

async function resolveNhdNameById(permanentId) {
  try {
    const res = await arcgisQuery(10, {
      where: `permanent_identifier='${permanentId}'`,
      outFields: "*",
      returnGeometry: "false",
      resultRecordCount: "1",
    });

    const attrs = res.features?.[0]?.attributes || {};

    return (
      attrs.GNIS_NAME ||
      attrs.gnis_name ||
      attrs.NAME ||
      attrs.name ||
      null
    );
  } catch (e) {
    console.log("NHD name lookup failed", e);
    return null;
  }
}

function cleanName(attrs = {}) {
  return (
    attrs.GNIS_NAME ||
    attrs.gnis_name ||
    attrs.Gnis_Name ||
    attrs.NAME ||
    attrs.name ||
    attrs.Name ||
    null
  );
}

function bestNamedFeature(features = []) {
  return features
    .map((f) => ({
      name: cleanName(f.attributes),
      attributes: f.attributes,
      geometry: f.geometry,
    }))
    .filter((f) => f.name)[0];
}

export async function lookupWaterbody(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const cached = getCachedWaterbody(lat, lon);
if (cached) {
  console.log("USING CACHED WATERBODY:", cached);
  return cached;
}


  const buffer = 0.02;
  const bbox = `${lon - buffer},${lat - buffer},${lon + buffer},${lat + buffer}`;

  const waterbody = await arcgisQuery(9, {
    geometry: bbox,
    geometryType: "esriGeometryEnvelope",
    spatialRel: "esriSpatialRelIntersects",
    inSR: "4326",
    resultRecordCount: "50",
    outFields: "*",
  });

  const features = Array.isArray(waterbody.features) ? waterbody.features : [];

  console.log("NHD FEATURE COUNT:", features.length);

  let containingFeature = null;

  for (const feature of features) {
    if (pointInPolygon([lon, lat], feature.geometry)) {
      containingFeature = feature;
      break;
    }
  }

  if (!containingFeature && features.length) {
    containingFeature = features[0];
    console.log("NHD FALLBACK FEATURE:", containingFeature.attributes);
  }

  console.log("NHD CONTAINING FEATURE:", containingFeature?.attributes);

  const attrs = containingFeature?.attributes || {};

  let name =
    attrs.GNIS_NAME ||
    attrs.gnis_name ||
    attrs.NAME ||
    attrs.name ||
    null;

  if (!name && attrs.permanent_identifier) {
    name = await resolveNhdNameById(attrs.permanent_identifier);
  }

  if (!name) {
  const flowline = await arcgisQuery(3, {
    geometry: `${lon},${lat}`,
geometryType: "esriGeometryPoint",
distance: "300",
units: "esriSRUnit_Meter",
    spatialRel: "esriSpatialRelIntersects",
    inSR: "4326",
    resultRecordCount: "25",
    outFields: "*",
  });

  const flowlineFeatures = Array.isArray(flowline.features)
    ? flowline.features
    : [];

  const namedFlowline = bestNamedFeature(flowlineFeatures);

  if (namedFlowline?.name) {
    console.log("USING FLOWLINE NAME:", namedFlowline.name);
    name = namedFlowline.name;
  }
}


  console.log("RESOLVED NHD NAME:", name);

  const result = {
  primaryWaterbody: name,
  primaryType:
    attrs.FTYPE ||
    attrs.ftype ||
    attrs.FeatureType ||
    attrs.featuretype ||
    null,
  primaryId:
    attrs.gnis_id ||
    attrs.GNIS_ID ||
    attrs.permanent_identifier ||
    attrs.OBJECTID ||
    null,
  secondaryFeature: null,
  source: "NHD polygon",
  confidence: containingFeature ? "polygon-hit" : "none",
};

saveCachedWaterbody(lat, lon, result);

return result;}