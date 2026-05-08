const SPECIES_TRAITS = {
  largemouth_bass: {
    name: "Largemouth Bass",
    aliases: ["largemouth", "black bass", "bass"],
    traits: [
      "large mouth extends past the eye",
      "green body",
      "dark horizontal side stripe",
      "deep bass-shaped body",
      "connected dorsal fin"
    ],
    lookalikes: ["Spotted Bass", "Smallmouth Bass"]
  },

  spotted_bass: {
    name: "Spotted Bass",
    aliases: ["spot", "kentucky bass", "spotted bass"],
    traits: [
      "mouth usually does not extend far past the eye",
      "rows of small spots below the lateral line",
      "rough tongue patch",
      "greenish bass body",
      "less bold stripe than largemouth"
    ],
    lookalikes: ["Largemouth Bass", "Smallmouth Bass"]
  },

  smallmouth_bass: {
    name: "Smallmouth Bass",
    aliases: ["smallmouth", "brown bass"],
    traits: [
      "bronze or brown body",
      "vertical side bars",
      "smaller mouth",
      "red or orange eye",
      "no strong black horizontal stripe"
    ],
    lookalikes: ["Spotted Bass", "Largemouth Bass"]
  },

  bluegill: {
    name: "Bluegill",
    aliases: ["bluegill", "bream", "sunfish"],
    traits: [
      "round panfish body",
      "dark ear flap",
      "blue or purple tint near gill plate",
      "small mouth",
      "vertical body bars"
    ],
    lookalikes: ["Redear Sunfish", "Green Sunfish"]
  },

  redear_sunfish: {
    name: "Redear Sunfish",
    aliases: ["redear", "shellcracker", "sunfish"],
    traits: [
      "round panfish body",
      "red or orange edge on ear flap",
      "small mouth",
      "usually less blue on face than bluegill",
      "faint vertical bars"
    ],
    lookalikes: ["Bluegill", "Green Sunfish"]
  },

  black_crappie: {
    name: "Black Crappie",
    aliases: ["black crappie", "crappie", "speck"],
    traits: [
      "paper-thin body",
      "random black speckles",
      "large mouth",
      "tall dorsal fin",
      "silvery body"
    ],
    lookalikes: ["White Crappie"]
  },

  white_crappie: {
    name: "White Crappie",
    aliases: ["white crappie", "crappie"],
    traits: [
      "paper-thin body",
      "vertical dark bars",
      "large mouth",
      "silvery body",
      "long dorsal fin"
    ],
    lookalikes: ["Black Crappie"]
  },

  channel_catfish: {
    name: "Channel Catfish",
    aliases: ["channel cat", "catfish"],
    traits: [
      "whiskers/barbels",
      "forked tail",
      "slender body",
      "small dark spots on younger fish",
      "smooth skin with no scales"
    ],
    lookalikes: ["Blue Catfish", "Flathead Catfish"]
  },

  blue_catfish: {
    name: "Blue Catfish",
    aliases: ["blue cat", "catfish"],
    traits: [
      "whiskers/barbels",
      "forked tail",
      "blue-gray body",
      "smooth skin with no scales",
      "usually no spots"
    ],
    lookalikes: ["Channel Catfish"]
  },

  flathead_catfish: {
    name: "Flathead Catfish",
    aliases: ["flathead", "yellow cat", "catfish"],
    traits: [
      "broad flat head",
      "lower jaw sticks out",
      "mottled yellow-brown body",
      "rounded tail",
      "smooth skin with no scales"
    ],
    lookalikes: ["Channel Catfish", "Blue Catfish"]
  },

  striped_bass: {
    name: "Striped Bass",
    aliases: ["striper", "striped bass"],
    traits: [
      "long silver body",
      "bold horizontal black stripes",
      "forked tail",
      "two separate dorsal fins",
      "large mouth"
    ],
    lookalikes: ["White Bass", "Hybrid Striped Bass"]
  },

  white_bass: {
    name: "White Bass",
    aliases: ["white bass", "sand bass"],
    traits: [
      "deep silver body",
      "horizontal stripes often broken",
      "smaller than striped bass",
      "single tooth patch",
      "arched back"
    ],
    lookalikes: ["Striped Bass", "Hybrid Striped Bass"]
  },

  northern_pike: {
    name: "Northern Pike",
    aliases: ["pike", "northern"],
    traits: [
      "long torpedo body",
      "duckbill snout",
      "light spots on dark green body",
      "sharp teeth",
      "dorsal fin far back near tail"
    ],
    lookalikes: ["Chain Pickerel", "Muskie"]
  },

  chain_pickerel: {
    name: "Chain Pickerel",
    aliases: ["pickerel", "jackfish"],
    traits: [
      "long torpedo body",
      "chain-like markings",
      "dark tear mark below eye",
      "duckbill snout",
      "dorsal fin far back near tail"
    ],
    lookalikes: ["Northern Pike"]
  }
};

function normalizeText(value = "") {
  return String(value).toLowerCase().replace(/[_-]/g, " ").trim();
}

function matchSpeciesFromLabel(label = "") {
  const clean = normalizeText(label);

  for (const [key, species] of Object.entries(SPECIES_TRAITS)) {
    if (clean.includes(normalizeText(species.name))) return key;

    for (const alias of species.aliases) {
      if (clean.includes(normalizeText(alias))) return key;
    }
  }

  return null;
}

function clampConfidence(value) {
  return Math.max(1, Math.min(99, Math.round(value)));
}

export function buildSmartFishIdResults(rawModelResults = [], userCorrections = []) {
  const scores = {};

  for (const result of rawModelResults) {
    const label = result.label || result.class || result.name || "";
    const score = Number(result.score ?? result.confidence ?? 0.1);
    const speciesKey = matchSpeciesFromLabel(label);

    if (!speciesKey) continue;

    scores[speciesKey] = (scores[speciesKey] || 0) + score * 100;
  }

  for (const correction of userCorrections) {
    if (!correction?.confirmedSpeciesKey) continue;
    scores[correction.confirmedSpeciesKey] =
      (scores[correction.confirmedSpeciesKey] || 0) + 8;
  }

  let ranked = Object.entries(scores)
    .map(([key, score]) => {
      const species = SPECIES_TRAITS[key];

      return {
        key,
        name: species.name,
        confidence: clampConfidence(score),
        traits: species.traits,
        lookalikes: species.lookalikes
      };
    })
    .sort((a, b) => b.confidence - a.confidence);

  if (ranked.length === 0) {
    ranked = [
      {
        key: "largemouth_bass",
        name: "Largemouth Bass",
        confidence: 34,
        traits: SPECIES_TRAITS.largemouth_bass.traits,
        lookalikes: SPECIES_TRAITS.largemouth_bass.lookalikes
      },
      {
        key: "bluegill",
        name: "Bluegill",
        confidence: 22,
        traits: SPECIES_TRAITS.bluegill.traits,
        lookalikes: SPECIES_TRAITS.bluegill.lookalikes
      },
      {
        key: "black_crappie",
        name: "Black Crappie",
        confidence: 18,
        traits: SPECIES_TRAITS.black_crappie.traits,
        lookalikes: SPECIES_TRAITS.black_crappie.lookalikes
      }
    ];
  }

  return ranked.slice(0, 5);
}

export function saveFishIdCorrection({ imageId, guessedSpeciesKey, confirmedSpeciesKey }) {
  const key = "fish-id-corrections";
  const existing = JSON.parse(localStorage.getItem(key) || "[]");

  const correction = {
    id: crypto.randomUUID(),
    imageId,
    guessedSpeciesKey,
    confirmedSpeciesKey,
    createdAt: new Date().toISOString()
  };

  localStorage.setItem(key, JSON.stringify([correction, ...existing]));
  return correction;
}

export function getFishIdCorrections() {
  return JSON.parse(localStorage.getItem("fish-id-corrections") || "[]");
}

export function getSpeciesOptions() {
  return Object.entries(SPECIES_TRAITS).map(([key, value]) => ({
    key,
    name: value.name
  }));
}

export { SPECIES_TRAITS };