import { cToF, distanceMiles, estimateWaterTempFromWeather } from "./fishing";

export async function getUsgsWaterData(lat, lon) {
  try {
    const bbox = `${lon - 0.35},${lat - 0.35},${lon + 0.35},${lat + 0.35}`;

    const url =
      `https://corsproxy.io/?https://waterservices.usgs.gov/nwis/iv/?format=json` +
      `&bBox=${bbox}` +
      `&parameterCd=00060,00065,00010` +
      `&period=P1D` +
      `&siteStatus=active`;

    const res = await fetch(url);

    console.log("USGS URL:", url);
    console.log("USGS STATUS:", res.status);

    console.log("USGS STATUS:", res.status);

    const data = await res.json();

    console.log("USGS DATA:", data);

    const series = data.value?.timeSeries || [];
    if (!series.length) return null;

    const stations = {};

    series.forEach((item) => {
      const source = item.sourceInfo;
      const siteCode = source?.siteCode?.[0]?.value;
      if (!siteCode) return;

      const stationLat = source?.geoLocation?.geogLocation?.latitude;
      const stationLon = source?.geoLocation?.geogLocation?.longitude;

      if (!stations[siteCode]) {
        stations[siteCode] = {
          station: source?.siteName || "Nearest USGS station",
          stationId: siteCode,
          distance: distanceMiles(lat, lon, stationLat, stationLon),
          flow: null,
          flowTrend: null,
          gageHeight: null,
          gageTrend: null,
          waterTemp: null,
          updated: null
        };
      }

      const code = item.variable?.variableCode?.[0]?.value;
      const values = item.values?.[0]?.value || [];
      if (!values.length) return;

      const oldest = Number(values[0]?.value);
      const newest = Number(values[values.length - 1]?.value);
      const latestTime = values[values.length - 1]?.dateTime;

      function getTrend(change) {
        if (Number.isNaN(change)) return null;
        if (change > 0.05) return "Rising";
        if (change < -0.05) return "Falling";
        return "Steady";
      }

      const change = newest - oldest;

      if (code === "00060") {
        stations[siteCode].flow = newest;
        stations[siteCode].flowTrend = getTrend(change);
      }

      if (code === "00065") {
        stations[siteCode].gageHeight = newest;
        stations[siteCode].gageTrend = getTrend(change);
      }

      if (code === "00010") {
        stations[siteCode].waterTemp = newest;
      }

      if (code === "00095") {
        stations[siteCode].conductance = newest;
      }

      if (code === "00300") {
        stations[siteCode].dissolvedOxygen = newest;
      }

      if (code === "00400") {
        stations[siteCode].ph = newest;
      }

      if (code === "63680") {
        stations[siteCode].turbidity = newest;
      }

      if (code === "00045") {
        stations[siteCode].precipitation = newest;
      }

      if (latestTime) stations[siteCode].updated = latestTime;
    });

    return Object.values(stations).sort((a, b) => a.distance - b.distance)[0];
  } catch (error) {
    console.error("USGS fetch failed", error);
    return null;
  }
}
export async function getNoaaWaterData(lat, lon) {
  try {
    const stationUrl =
      `https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json` +
      `?type=waterlevels&units=english`;

    const stationRes = await fetch(stationUrl);
    const stationData = await stationRes.json();

    const stations = stationData.stations || [];

    const nearest = stations
      .map((station) => ({
        id: station.id,
        name: station.name,
        lat: Number(station.lat),
        lon: Number(station.lng),
        distance: distanceMiles(lat, lon, Number(station.lat), Number(station.lng))
      }))
      .filter((station) => !Number.isNaN(station.distance))
      .sort((a, b) => a.distance - b.distance)[0];

    if (!nearest || nearest.distance > 75) return null;

    const dataUrl =
      `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter` +
      `?product=water_level&application=FishPatterns` +
      `&station=${nearest.id}` +
      `&date=latest&datum=MLLW&units=english&time_zone=lst_ldt&format=json`;

    const dataRes = await fetch(dataUrl);
    const data = await dataRes.json();

    const latest = data.data?.[0];

    async function fetchNoaaProduct(product) {
      try {
        const url =
          `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter` +
          `?product=${product}&application=FishPatterns` +
          `&station=${nearest.id}` +
          `&date=latest&units=english&time_zone=lst_ldt&format=json`;

        const res = await fetch(url);
        const result = await res.json();

        return result.data?.[0] || null;
      } catch {
        return null;
      }
    }

    const noaaWaterTemp = await fetchNoaaProduct("water_temperature");
    const noaaAirTemp = await fetchNoaaProduct("air_temperature");
    const noaaWind = await fetchNoaaProduct("wind");
    const noaaPressure = await fetchNoaaProduct("air_pressure");

    return {
      station: nearest.name,
      stationId: nearest.id,
      distance: nearest.distance,
      waterLevel: latest?.v ?? null,
      waterLevelTime: latest?.t ?? null,
      waterTemp: noaaWaterTemp?.v ?? null,
      airTemp: noaaAirTemp?.v ?? null,
      windSpeed: noaaWind?.s ?? null,
      windDirection: noaaWind?.d ?? null,
      pressure: noaaPressure?.v ?? null,
      source: "NOAA"
    };
  } catch (error) {
    console.error("NOAA fetch failed", error);
    return null;
  }
}

export async function getUsaceWaterData(lat, lon) {
  try {
    const locationsUrl =
      `https://cwms-data.usace.army.mil/cwms-data/locations` +
      `?office=*&format=json`;

    const res = await fetch(locationsUrl);
    const data = await res.json();

    const locations = data.locations || data.entries || [];

    const nearest = locations
      .map((item) => {
        const itemLat = Number(item.latitude || item.lat);
        const itemLon = Number(item.longitude || item.lon);

        return {
          name: item.name || item["location-id"] || item.locationId || "USACE location",
          office: item.office || item["office-id"] || "",
          lat: itemLat,
          lon: itemLon,
          distance: distanceMiles(lat, lon, itemLat, itemLon)
        };
      })
      .filter((item) => !Number.isNaN(item.distance))
      .sort((a, b) => a.distance - b.distance)[0];

    if (!nearest || nearest.distance > 75) return null;

    return {
      source: "USACE",
      location: nearest.name,
      office: nearest.office,
      distance: nearest.distance,
      note: "Nearest USACE project/location found. Real time-series values vary by district and will be wired per matching location."
    };
  } catch (error) {
    console.error("USACE fetch failed", error);
    return null;
  }
}

export async function getAllWaterData(lat, lon, lakeName = "") {
  const usgs = await getUsgsWaterData(lat, lon);
  const noaa = await getNoaaWaterData(lat, lon);
  const usace = await getUsaceWaterData(lat, lon);
  const managed = await getManagedWaterData(lakeName, lat, lon);
  const tva = await getTvaWaterData(lat, lon);
  const estimatedTemp = await getEstimatedWaterTemp(lat, lon);

  return {
    usgs,
    noaa,
    usace,
    tva,
    managed,
    summary: {
      bestSource: usgs ? "USGS" : noaa ? "NOAA" : usace ? "USACE" : managed ? managed.provider : "None",
      station: usgs?.station || noaa?.station || usace?.location || null,
      flow: usgs?.flow ?? null,
      gageHeight: usgs?.gageHeight ?? null,
      airTemp: noaa?.airTemp ?? null,
      waterTemp:
  usgs?.waterTemp != null
    ? cToF(usgs.waterTemp)
    : noaa?.waterTemp != null
      ? Number(noaa.waterTemp)
      : null,

      waterTempSource:
  usgs?.waterTemp != null
    ? "USGS"
    : noaa?.waterTemp != null
      ? "NOAA"
      : "None",
      waterTempUnit: "°F",
      waterLevel: noaa?.waterLevel ?? null,
      usaceLocation: usace?.location ?? null,
      conductance: usgs?.conductance ?? null,
      dissolvedOxygen: usgs?.dissolvedOxygen ?? null,
      ph: usgs?.ph ?? null,
      turbidity: usgs?.turbidity ?? null,
      precipitation: usgs?.precipitation ?? null,
      tvaDischarge: tva?.discharge ?? null,
      tvaElevation: tva?.elevation ?? null,
      noaaWaterTemp: noaa?.waterTemp ?? null,
      noaaAirTemp: noaa?.airTemp ?? null,
      noaaWindSpeed: noaa?.windSpeed ?? null,
      noaaWindDirection: noaa?.windDirection ?? null,
      noaaPressure: noaa?.pressure ?? null,
    }
  };
}

export async function getManagedWaterData(lakeName = "", lat, lon) {
  return identifyWaterManager(lakeName, lat, lon);
}

export async function getTvaWaterData(lat, lon) {
  try {
    const url = `https://api.tva.com/river/flows?format=json`;

    const res = await fetch(url);
    const data = await res.json();

    const stations = data?.stations || [];

    const nearest = stations
      .map((s) => ({
        name: s.name,
        lat: Number(s.latitude),
        lon: Number(s.longitude),
        discharge: s.discharge,
        elevation: s.elevation,
        distance: distanceMiles(lat, lon, Number(s.latitude), Number(s.longitude))
      }))
      .filter((s) => !Number.isNaN(s.distance))
      .sort((a, b) => a.distance - b.distance)[0];

    if (!nearest || nearest.distance > 75) return null;

    return {
      source: "TVA",
      station: nearest.name,
      distance: nearest.distance,
      discharge: nearest.discharge, // 🔥 CURRENT FLOW
      elevation: nearest.elevation  // lake level
    };
  } catch (e) {
    console.error("TVA fetch failed", e);
    return null;
  }
}

export async function getEstimatedWaterTemp(lat, lon) {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&hourly=lake_surface_water_temperature` +
      `&temperature_unit=fahrenheit`;

    const res = await fetch(url);
    const data = await res.json();

    const temps = data.hourly?.lake_surface_water_temperature;

    if (!temps || !temps.length) return null;

    return temps[new Date().getHours()];
  } catch (e) {
    console.error("Estimated water temp failed", e);
    return null;
  }
}

export async function identifyWaterManager(lakeName = "", lat, lon) {
  const name = String(lakeName || "").toLowerCase();

  const providers = [
    {
      id: "georgia_power",
      provider: "Georgia Power / Southern Company",
      keys: ["goat rock", "harding", "bartlett", "oliver", "jackson", "oconee", "sinclair"]
    },
    {
      id: "tva",
      provider: "TVA",
      keys: ["guntersville", "wheeler", "wilson", "pickwick", "kentucky lake", "chickamauga", "nickajack"]
    },
    {
      id: "usace",
      provider: "USACE / Army Corps",
      keys: ["eufaula", "west point", "lanier", "allatoona", "seminole", "allatoona lake", "lake lanier"]
    },
    {
      id: "duke_energy",
      provider: "Duke Energy",
      keys: ["norman", "wylie", "keowee", "jocassee", "hartwell"]
    }
  ];

  const match = providers.find((item) =>
    item.keys.some((key) => name.includes(key))
  );

  if (!match) {
    return {
      provider: "Unknown / Public Water",
      providerId: "unknown",
      system: "Unmatched water body",
      note: "No known water manager matched yet. App will fall back to USGS, NOAA, and estimated conditions.",
      latitude: lat,
      longitude: lon
    };
  }

  return {
    provider: match.provider,
    providerId: match.id,
    system: "Managed water body",
    note: `${match.provider} matched from lake name. Live provider-specific data can be added through this provider adapter.`,
    latitude: lat,
    longitude: lon
  };
}