function clamp(num, min, max) {
  return Math.max(min, Math.min(max, num));
}

function diffScore(a, b, perfectRange, maxRange, points) {
  const n1 = Number(a);
  const n2 = Number(b);

  if (Number.isNaN(n1) || Number.isNaN(n2)) return 0;

  const diff = Math.abs(n1 - n2);

  if (diff <= perfectRange) return points;
  if (diff >= maxRange) return 0;

  return Math.round(points * (1 - diff / maxRange));
}

export function getPatternStrength(catches, current) {
  if (!catches?.length) {
    return {
      strength: 35,
      label: "Base Pattern",
      summary: "Based mostly on seasonal and weather logic.",
      bestMatches: []
    };
  }

  const scored = catches
    .filter((c) => !c.noCatch)
    .map((c) => {
      let score = 0;

      // User-confirmed quality matters
      score += Number(c.confidence || 3) * 8;

      // Same lake matters a lot
      if (current.lake && c.lake === current.lake) score += 18;

      // Weather similarity
      score += diffScore(c.weather?.temp, current.temp, 4, 18, 16);
      score += diffScore(c.weather?.wind, current.wind, 4, 18, 12);
      score += diffScore(c.weather?.cloud, current.cloud, 15, 60, 8);
      score += diffScore(c.weather?.pressure, current.pressure, 5, 25, 8);

      // Water temp similarity is huge
      score += diffScore(
        c.water?.summary?.waterTemp,
        current.waterTemp,
        4,
        18,
        18
      );

      // Pattern/lure data
      if (c.bait && c.bait !== "Unknown bait") score += 8;
      if (c.patternTag) score += 8;

      return {
        ...c,
        patternScore: clamp(score, 0, 100)
      };
    })
    .filter((c) => c.patternScore >= 35)
    .sort((a, b) => b.patternScore - a.patternScore)
    .slice(0, 5);

  if (!scored.length) {
    return {
      strength: 42,
      label: "Exploratory Pattern",
      summary: "Not strongly backed by your history yet.",
      bestMatches: []
    };
  }

  const avg =
    scored.reduce((sum, item) => sum + item.patternScore, 0) / scored.length;

  const strength = clamp(Math.round(avg), 0, 100);

  let label = "Developing Pattern";
  if (strength >= 80) label = "Strong Pattern";
  else if (strength >= 65) label = "Good Pattern";
  else if (strength < 50) label = "Weak Pattern";

  return {
    strength,
    label,
    summary:
      scored.length >= 3
        ? "Backed by several similar catches from your history."
        : "Backed by limited but useful catch history.",
    bestMatches: scored
  };
}