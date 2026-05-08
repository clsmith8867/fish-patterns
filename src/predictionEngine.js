import { estimateWaterTempFromWeather, getSimpleBiteScore } from "./utils/fishing";

export function buildPatternMemory(catches, species, lake) {
  let filtered = catches || [];

  if (species !== "Any Species") {
    filtered = filtered.filter((fish) =>
      String(fish.species || "").toLowerCase().includes(species.toLowerCase())
    );
  }

  if (lake !== "Any Lake") {
    filtered = filtered.filter((fish) => fish.lake === lake);
  }

  const catchesOnly = filtered.filter((fish) => !fish.noCatch);
const missesOnly = filtered.filter((fish) => fish.noCatch);

if (catchesOnly.length < 3 && missesOnly.length < 2) return null;

  const baitCount = {};
  const spotWords = {
    dock: 0,
    grass: 0,
    rock: 0,
    point: 0,
    creek: 0,
    ledge: 0,
    brush: 0,
    shade: 0,
    current: 0
  };

  catchesOnly.forEach((fish) => {
    if (fish.bait) baitCount[fish.bait] = (baitCount[fish.bait] || 0) + 1;

    const notes = String(fish.notes || "").toLowerCase();
    Object.keys(spotWords).forEach((word) => {
      if (notes.includes(word)) spotWords[word]++;
    });
  });

  return {
  bestBait: Object.entries(baitCount).sort((a, b) => b[1] - a[1])[0]?.[0],
  bestSpot: Object.entries(spotWords).sort((a, b) => b[1] - a[1])[0]?.[0],
  catchCount: catchesOnly.length,
  missCount: missesOnly.length,
  confidence: Math.min(100, catchesOnly.length * 10 - missesOnly.length * 8)
};
}

export function getSeasonalPhase(waterTemp) {
  if (waterTemp < 50) return "Winter";
  if (waterTemp < 58) return "Pre-Spawn / Staging";
  if (waterTemp < 68) return "Spawn / Shallow Movement";
  if (waterTemp < 76) return "Post-Spawn / Early Summer";
  if (waterTemp < 86) return "Summer";
  return "Hot Water / Oxygen Pattern";
}

export function buildFishingPrediction({ species, weather = {}, water = {}, memory }) {
  const temp = Number(weather.temp ?? 72);
  const wind = Number(weather.wind ?? 6);
  const clouds = Number(weather.cloud ?? 50);
  const pressure = Number(weather.pressure ?? 1014);
  const rain = Number(weather.rain ?? 0);
  const waterTemp = Number(
    water.waterTemp ?? estimateWaterTempFromWeather(weather) ?? temp - 6
  );

  const biteScore = getSimpleBiteScore({ wind, pressure, rain, clouds, temp });
  const season = getSeasonalPhase(waterTemp);

  let depth = "4–10 ft";
  let location = "points, shaded banks, grass edges, docks, and current breaks";
  let lure = "chatterbait, spinnerbait, squarebill, or soft plastic";
  let mood = "moderate";
  let reason = "Conditions look average. Fish should relate to cover and structure.";

  if (waterTemp < 50) {
    depth = "15–30 ft";
    location = "deep points, channel swings, bluff walls, and slow current seams";
    lure = "jig, drop shot, blade bait, spoon, or slow jerkbait";
    mood = "slow";
    reason = "Cold water slows fish down. Stay deeper and fish slower.";
  } else if (waterTemp < 60) {
    depth = "8–15 ft";
    location = "secondary points, creek mouths, rocky banks, and staging areas";
    lure = "jerkbait, crankbait, jig, spinnerbait, or shaky head";
    mood = "improving";
    reason = "Fish may be staging and moving shallower during feeding windows.";
  } else if (waterTemp < 75) {
    depth = "2–10 ft";
    location = "shallow cover, grass lines, docks, points near spawning pockets, and baitfish areas";
    lure = "chatterbait, spinnerbait, topwater, wacky rig, Texas rig, or swim jig";
    mood = "good";
    reason = "This is a strong feeding range. Fish can be shallow and active.";
  } else {
    depth = "10–25 ft, or shallow early and late";
    location = "deep brush, ledges, offshore structure, shaded docks, and current";
    lure = "topwater early, deep crankbait, football jig, Carolina rig, or big worm";
    mood = "heat dependent";
    reason = "Warm water pushes fish toward shade, oxygen, deeper structure, or current.";
  }

  if (wind >= 8) {
    location = `wind-blown ${location}`;
    lure = `${lure}, plus moving baits`;
    reason += " Wind should position bait.";
  }

  if (clouds > 65) {
    location += ", roaming flats, and open banks";
    lure += ", buzzbait, walking bait";
    reason += " Cloud cover can keep fish roaming shallower.";
  }

  if (pressure > 1024) {
    lure = "finesse worm, jig, drop shot, Ned rig, or slow Texas rig";
    mood = "tougher";
    reason += " Higher pressure usually means slowing down.";
  }

  if (rain > 0.15) {
    location += ", drains, creek mouths, stained water edges";
    lure += ", dark spinnerbait or vibrating jig";
    reason += " Rain can create runoff and feeding lanes.";
  }

  if (species.includes("Crappie")) {
    depth = waterTemp < 60 ? "10–20 ft" : "6–15 ft";
    location = "brush piles, docks, bridge pilings, standing timber, and creek channels";
    lure = "small jig, minnow, underspin, or slip bobber rig";
  }

  if (species.includes("Striped")) {
    depth = "15–40 ft, depending on bait depth";
    location = "open water, humps, channel edges, dam areas, and bait schools";
    lure = "live bait, spoon, swimbait, topwater early, or umbrella rig";
  }

  if (species.includes("Catfish")) {
    depth = "deep holes, current seams, flats near channels";
    location = "river bends, creek mouths, ledges, and muddy/stained water";
    lure = "cut bait, live bait, stink bait, or chicken liver";
  }

  if (memory) {
  if (memory.bestBait) lure = `${memory.bestBait} (your top producer)`;
  if (memory.bestSpot) location = `${memory.bestSpot} areas, plus ${location}`;

  if (memory.catchCount > 0 && memory.missCount > 0) {
  reason = `Your history shows both catches and misses in this filtered pattern. Treat this as useful, but not automatic.`;
} else if (memory.catchCount > 0) {
  reason = `This recommendation is influenced by your saved catches, but current-condition matching is handled by Pattern Strength.`;
} else {
  reason = `Your history has no strong catch pattern here yet. Treat this as lower confidence and adjust quickly.`;
  mood = "low confidence";
}
}

  return {
    biteScore,
    season,
    mood,
    depth,
    location,
    lure,
    reason,
    inputs: { temp, wind, clouds, pressure, rain, waterTemp }
  };
}