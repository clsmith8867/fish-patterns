export function getSimpleBiteScore({ wind, pressure, rain, clouds, temp }) {
  let score = 55;

  if (wind >= 4 && wind <= 12) score += 15;
  if (wind > 18) score -= 15;

  if (pressure >= 1008 && pressure <= 1018) score += 10;
  if (pressure > 1025) score -= 8;

  if (clouds >= 40 && clouds <= 85) score += 10;

  if (rain > 0 && rain < 0.1) score += 5;
  if (rain >= 0.25) score -= 10;

  if (temp >= 55 && temp <= 85) score += 10;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function average(numbers) {
  const clean = (numbers || []).map(Number).filter((n) => !Number.isNaN(n));
  if (!clean.length) return null;
  return clean.reduce((sum, n) => sum + n, 0) / clean.length;
}

export function estimateWaterTempFromWeather(weather = {}) {
  // --- 1. Seasonal baseline
  const date = weather.date ? new Date(weather.date) : new Date();
  const month = date.getMonth() + 1;

  let seasonalBase = 65;

  if ([1, 2].includes(month)) seasonalBase = 48;
  else if (month === 3) seasonalBase = 55;
  else if (month === 4) seasonalBase = 62;
  else if (month === 5) seasonalBase = 70 + ((date.getDate() / 31) * 4);
  else if (month === 6) seasonalBase = 78;
  else if ([7, 8].includes(month)) seasonalBase = 84;
  else if (month === 9) seasonalBase = 80;
  else if (month === 10) seasonalBase = 72;
  else if (month === 11) seasonalBase = 62;
  else if (month === 12) seasonalBase = 52;

  // --- 2. Weather influence (light)
  const avgAir = Number(weather.avgAirTemp);
  const currentAir = Number(weather.temp ?? weather.temperature_2m);

  let airInfluence = 0;

  if (!Number.isNaN(avgAir) && !Number.isNaN(currentAir)) {
    const blendedAir = avgAir * 0.7 + currentAir * 0.3;
    airInfluence = (blendedAir - seasonalBase) * 0.25;
  }

  // --- 3. Environmental adjustments
  const wind = Number(weather.wind ?? weather.wind_speed_10m ?? weather.avgWind ?? 0);
  const rain = Number(weather.rain ?? weather.precipitation ?? weather.avgRain ?? 0);
  const clouds = Number(weather.cloud ?? weather.cloud_cover ?? 50);

  let adjustment = 0;

  if (wind > 15) adjustment -= 1.5;
  if (rain > 0.25) adjustment -= 2;
  else if (rain > 0.1) adjustment -= 1;

  if (clouds > 80) adjustment -= 0.5;

  // --- 4. Final
  const estimated = seasonalBase + airInfluence + adjustment;

  return Math.round(estimated);
}

export function getMoonPhase(dateValue) {
  const d = new Date(dateValue);
  const lunarCycle = 29.53058867;
  const knownNewMoon = new Date("2000-01-06T18:14:00Z");
  const daysSince = (d - knownNewMoon) / 86400000;
  const age = ((daysSince % lunarCycle) + lunarCycle) % lunarCycle;

  if (age < 1.85) return "New Moon";
  if (age < 5.54) return "Waxing Crescent";
  if (age < 9.23) return "First Quarter";
  if (age < 12.92) return "Waxing Gibbous";
  if (age < 16.61) return "Full Moon";
  if (age < 20.30) return "Waning Gibbous";
  if (age < 23.99) return "Last Quarter";
  return "Waning Crescent";
}

export function getMoonIcon(phase = "") {
  const name = phase.toLowerCase();

  if (name.includes("new")) return "🌑";
  if (name.includes("waxing crescent")) return "🌒";
  if (name.includes("first quarter")) return "🌓";
  if (name.includes("waxing gibbous")) return "🌔";
  if (name.includes("full")) return "🌕";
  if (name.includes("waning gibbous")) return "🌖";
  if (name.includes("last quarter")) return "🌗";
  if (name.includes("waning crescent")) return "🌘";

  return "🌙";
}

export function cToF(celsius) {
  const n = Number(celsius);
  if (Number.isNaN(n)) return null;
  return Math.round((n * 9) / 5 + 32);
}

export function distanceMiles(lat1, lon1, lat2, lon2) {
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

export function windToCardinal(degrees) {
  if (degrees === null || degrees === undefined) return null;

  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const index = Math.round(degrees / 45) % 8;
  return directions[index];
}