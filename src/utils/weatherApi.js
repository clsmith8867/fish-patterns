import { windToCardinal } from "./fishing";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

export async function getWeather(lat, lon, date) {
  const d = new Date(date);
  const day = d.toISOString().split("T")[0];
  const hour = d.getHours();

  const url =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
    `&start_date=${day}&end_date=${day}` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch` +
    `&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,pressure_msl,wind_speed_10m,wind_direction_10m,precipitation,cloud_cover`;

  const res = await fetch(url);
  const data = await res.json();

  const windDir = data.hourly?.wind_direction_10m?.[hour];

  return {
    temp: data.hourly?.temperature_2m?.[hour],
    feelsLike: data.hourly?.apparent_temperature?.[hour],
    humidity: data.hourly?.relative_humidity_2m?.[hour],
    pressure: data.hourly?.pressure_msl?.[hour],
    wind: data.hourly?.wind_speed_10m?.[hour],
    windDir,
    windCardinal: windToCardinal(windDir),
    rain: data.hourly?.precipitation?.[hour],
    cloud: data.hourly?.cloud_cover?.[hour]
  };
}

export async function getCurrentWeather(lat, lon) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&temperature_unit=fahrenheit` +
    `&wind_speed_unit=mph` +
    `&precipitation_unit=inch` +
    `&timezone=auto` +
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,pressure_msl,wind_speed_10m,wind_direction_10m,rain,precipitation,cloud_cover,weather_code` +
    `&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,rain,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,relative_humidity_2m,pressure_msl` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_probability_max,precipitation_sum,rain_sum,sunrise,sunset,daylight_duration,sunshine_duration,uv_index_max,wind_speed_10m_max,wind_direction_10m_dominant`;

  console.log("HOME WEATHER URL:", url);

  const res = await fetch(url);

  console.log("HOME WEATHER STATUS:", res.status);

  if (!res.ok) {
    throw new Error("Weather request failed");
  }

  const data = await res.json();

  console.log("HOME WEATHER DATA:", data);

  return data;
}

export async function reverseGeocodeLocation(lat, lon) {
  try {
    const url =
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lon},${lat}.json` +
      `?types=place,locality` +
      `&limit=1` +
      `&access_token=${MAPBOX_TOKEN}`;

    const res = await fetch(url);
    const data = await res.json();

    console.log("HOME LOCATION DATA:", data);

    const result = data.features?.[0];

    if (!result) {
      return `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
    }

    const place = result.text || "Current Location";

    const statePart = result.context?.find((item) =>
      item.id?.startsWith("region")
    );

    const state = statePart?.text || "";

    return state ? `${place}, ${state}` : place;
  } catch (e) {
    console.error("Reverse geocode failed", e);
    return `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
  }
}

export async function getRecentWeatherAverages(lat, lon, dateValue = new Date()) {
  const end = new Date(dateValue);
  const start = new Date(end);

  start.setDate(start.getDate() - 6);

  const startDate = start.toISOString().split("T")[0];
  const endDate = end.toISOString().split("T")[0];

  const url =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
    `&start_date=${startDate}&end_date=${endDate}` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max` +
    `&timezone=auto`;

  const res = await fetch(url);

  if (!res.ok) {
    throw new Error("Recent weather average request failed");
  }

  const data = await res.json();

  const highs = data.daily?.temperature_2m_max || [];
  const lows = data.daily?.temperature_2m_min || [];
  const rainTotals = data.daily?.precipitation_sum || [];
  const winds = data.daily?.wind_speed_10m_max || [];

  const avg = (arr) => {
    const clean = arr.map(Number).filter((n) => !Number.isNaN(n));
    if (!clean.length) return null;
    return clean.reduce((sum, n) => sum + n, 0) / clean.length;
  };

  const avgHigh = avg(highs);
  const avgLow = avg(lows);

  return {
    avgAirTemp:
      avgHigh != null && avgLow != null
        ? Math.round((avgHigh + avgLow) / 2)
        : null,
    recentHighs: highs,
    recentLows: lows,
    avgRain: avg(rainTotals),
    avgWind: avg(winds),
    daysUsed: highs.length
  };
}