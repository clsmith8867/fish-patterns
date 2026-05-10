import express from "express";
import OpenAI from "openai";
import cors from "cors";
import dotenv from "dotenv";
import * as cheerio from "cheerio";
import { chromium } from "playwright";

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const app = express();
app.use(cors());
app.use(express.json({ limit: "25mb" }));

app.get("/test", (req, res) => {
  res.json({ species: "Server is working" });
});

app.post("/identify-fish", async (req, res) => {
  try {
    console.log("Identify fish request received");

    const { image, examples = [] } = req.body;

    if (!image) {
      return res.status(400).json({ error: "No image provided" });
    }

    const prompt = `You are a professional freshwater fish identification expert.

Analyze the fish in this image carefully.

You MUST compare between these species:
- Largemouth Bass
- Spotted Bass
- Smallmouth Bass
- White Bass
- Striped Bass
- Hybrid Striped Bass
- Crappie
- Bluegill
- If the fish clearly matches a known species, assign confidence between 70–95
- Only use low confidence (under 50) if the image is unclear or obstructed
- Strong horizontal striping + silver body = high confidence White Bass or Striped Bass

Rules:
- Do NOT guess blindly
- Look at body shape, stripes, mouth size, and coloration
- If horizontal stripes are strong and continuous, prefer White Bass, Striped Bass, or Hybrid Striped Bass
- If mouth extends past the eye, prefer Largemouth Bass
- If the fish clearly matches a known species, assign confidence between 70–95
- Only use low confidence (under 50) if the image is unclear or obstructed
- Strong horizontal striping + silver body = high confidence White Bass or Striped Bass
- Do not return Unidentified Fish unless no fish is visible

Respond ONLY in JSON:

{
  "species": "...",
  "scientificName": "",
  "confidence": 0,
  "topGuesses": [
    { "species": "...", "confidence": 0, "reason": "short reason" }
  ],
  "visualTraits": ["trait", "trait"],
  "warning": ""
}`;

    const ai = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: prompt
            },
            {
              type: "input_image",
              image_url: image
            }
          ]
        }
      ]
    });

    const text = ai.output_text || "";
    const cleaned = text.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = {};
    }
    
    console.log("AI RAW TEXT:", text);
console.log("AI PARSED:", parsed);

    return res.json({
      species: parsed.species || "Unidentified Fish",
      scientificName: parsed.scientificName || "",
      confidence: parsed.confidence || 50,
      source: "openai-vision-new-prompt",
      topGuesses: parsed.topGuesses || [],
      visualTraits: parsed.visualTraits || [],
      warning: parsed.warning || ""
    });
  } catch (error) {
    console.error("Fish ID failed:", error);
    return res.status(500).json({ error: "Fish ID failed" });
  }
});

app.get("/api/hydro/debug", (req, res) => {
  res.json({ hydroRoutesLoaded: true });
});

function normalizeLakeName(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace("lake ", "")
    .replace(" dam", "")
    .trim();
}

app.get("/api/hydro/georgia-power", async (req, res) => {
  try {
    const lakeQuery = normalizeLakeName(req.query.lake || "");

    if (!lakeQuery) {
      return res.status(400).json({ error: "Missing lake name" });
    }

    const response = await fetch("https://lakes.southernco.com/", {
  headers: {
    "User-Agent": "Mozilla/5.0",
  },
});
    const html = await response.text();

    const $ = cheerio.load(html);
    const pageText = $("body").text().replace(/\s+/g, " ");

    const updatedMatch = pageText.match(
      /Last updated:\s*([0-9/]+)\s+at\s+([0-9:]+\s*[AP]M)/i
    );

    const rows = [];

    $("tr").each((_, row) => {
      const cells = $(row)
        .find("td, th")
        .map((_, cell) => $(cell).text().replace(/\s+/g, " ").trim())
        .get()
        .filter(Boolean);

      if (cells.length >= 3 && cells[0].toLowerCase() !== "lake") rows.push(cells);
    });

    let match = null;

    for (const cells of rows) {
      const rowName = cells[0] || "";
      const normalizedRow = normalizeLakeName(rowName);

      if (
        normalizedRow.includes(lakeQuery) ||
        lakeQuery.includes(normalizedRow)
      ) {
        match = cells;
        break;
      }
    }

    if (!match) {
      const regex = new RegExp(
        `(${lakeQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^A-Za-z0-9]+.*?)(?=\\s[A-Z][A-Za-z]+\\s|$)`,
        "i"
      );

      return res.json({
        source: "Georgia Power / Southern Company",
        found: false,
        lake: req.query.lake,
        updatedText: updatedMatch
          ? `${updatedMatch[1]} ${updatedMatch[2]}`
          : null,
        note: "Lake row not parsed from table yet.",
        debugRows: rows.slice(0, 8),
      });
    }

    const nums = match
      .slice(1)
      .map((v) => Number(String(v).replace(/[^\d.-]/g, "")))
      .filter((n) => Number.isFinite(n));

    const fullPoolFt = nums.at(-1) ?? null;
    const currentElevationFt = nums.at(-2) ?? null;
    const rainInches = nums.length >= 3 ? nums.at(-3) : null;
    const generation = nums.length >= 3 ? nums[0] : null;

    const feetFromFullPool =
      currentElevationFt != null && fullPoolFt != null
        ? Number((currentElevationFt - fullPoolFt).toFixed(2))
        : null;

    res.json({
      source: "Georgia Power / Southern Company",
      found: true,
      lake: match[0],
      generation,
      rainInches,
      lakeLevelFt: currentElevationFt,
      fullPoolFt,
      feetFromFullPool,
      updatedText: updatedMatch
        ? `${updatedMatch[1]} ${updatedMatch[2]}`
        : null,
      rawRow: match,
    });
  } catch (error) {
    console.error("Georgia Power hydro failed:", error);
    res.status(500).json({ error: "Georgia Power hydro failed" });
  }
});

app.get("/api/hydro/render-test", async (req, res) => {
  let browser;

  try {
    const url =
      req.query.url ||
      "https://www.georgiapower.com/our-impact/lakes-rivers/water-levels.html";

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto(url, {
      waituntil: "documentloaded",
      timeout: 60000,
    });

    const text = await page.locator("body").innerText();

    const frames = page.frames().map((frame) => ({
      name: frame.name(),
      url: frame.url(),
    }));

    const scripts = await page.$$eval("script[src]", (scripts) =>
      scripts.map((s) => s.src)
    );

    const links = await page.$$eval("a[href], iframe[src]", (els) =>
      els.map((el) => ({
        tag: el.tagName,
        text: el.textContent?.trim(),
        href: el.href || el.src,
      }))
    );

    res.json({
      ok: true,
      url,
      includesBartletts: text.includes("Bartletts"),
      includesGoatRock: text.includes("Goat Rock"),
      includesRelease: text.toLowerCase().includes("release"),
      includesGeneration: text.toLowerCase().includes("generation"),
      frames,
      scripts,
      links,
      preview: text.slice(0, 3000),
    });
  } catch (error) {
    console.error("Render test failed:", error);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  } finally {
    if (browser) await browser.close();
  }
});

app.get("/api/hydro/georgia-power-operations", async (req, res) => {
  let browser;

  try {
    const lakeQuery = String(req.query.lake || "")
      .toLowerCase()
      .trim();

    browser = await chromium.launch({
      headless: true,
    });

    const page = await browser.newPage();

    await page.goto(
      "https://resources.georgiapower.com/content/tools/hydro-operations/index.cshtml",
      {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      }
    );

    await page.waitForTimeout(2500);

   await page.evaluate(() => {
  const river = document.querySelector("#riveroptions");
  const lake = document.querySelector("#lakeoptions");

  if (river) {
    river.value = [...river.options].find(
      (opt) => opt.textContent.trim() === "Chattahoochee River"
    )?.value;

    river.dispatchEvent(new Event("change", { bubbles: true }));
  }
});

await page.waitForTimeout(1500);

const result = await page.evaluate((requestedLake) => {
  const app = window.hydroApp;
  if (!app?.data?.data) return null;

  const clean = (value = "") =>
    String(value).toLowerCase().replace(/\s+/g, "");

  const target = clean(requestedLake);

  for (const river of app.data.data) {
    for (const lake of river.lakes || []) {
      const prettyName = app.formatName(lake.lakeName);
      const rawName = lake.lakeName;

      if (clean(prettyName).includes(target) || target.includes(clean(prettyName))) {
        return {
          river: river.riverName,
          lake: prettyName,
          rawLake: rawName,
          observedAt: lake.current?.timestamp || null,
          lakeLevelFt: lake.current?.elevation ?? null,
          turbineReleaseCfs:
            lake.current?.flow === -99 ? null : Math.round(lake.current?.flow),
          specialOperationMessage: lake.current?.specialOperationMessage || null,
          schedule: (lake.lakeSchedule || []).map((row) => ({
            date: row.timestamp ? row.timestamp.split("T")[0] : null,
            time: row.hourStart,
            units: row.units,
          })),
        };
      }
    }
  }

  return null;
}, req.query.lake || "");

 if (!result) {
  return res.json({
    found: false,
    lake: req.query.lake,
    note: "Lake not found in Georgia Power operations data.",
  });
}

res.json({
  found: true,
  source: "Georgia Power Hydro Operations",
  ...result,
});

  } catch (error) {
    console.error("Operations scrape failed:", error);

    res.status(500).json({
      found: false,
      error: error.message,
    });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

app.get("/api/hydro/tva-test", async (req, res) => {
  let browser;

  try {
    const lake = req.query.lake || "chickamauga";
    const url = `https://www.tva.com/environment/lake-levels/${lake}`;

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.waitForTimeout(3000);

    const text = await page.locator("body").innerText();

    res.json({
      ok: true,
      lake,
      url,
      includesElevation: text.toLowerCase().includes("elevation"),
      includesDischarge: text.toLowerCase().includes("discharge"),
      includesRelease: text.toLowerCase().includes("release"),
      includesGeneration: text.toLowerCase().includes("generation"),
      preview: text.slice(0, 5000),
    });
  } catch (error) {
    console.error("TVA test failed:", error);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  } finally {
    if (browser) await browser.close();
  }
});

app.get("/api/hydro/usace-test", async (req, res) => {
  try {
    const url = "https://water.usace.army.mil/cwms-data/locations";
    const response = await fetch(url);
    const text = await response.text();

    res.json({
      ok: response.ok,
      status: response.status,
      includesLake: text.toLowerCase().includes("lake"),
      includesProject: text.toLowerCase().includes("project"),
      preview: text.slice(0, 1000),
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.get("/api/hydro/usace-search", async (req, res) => {
  try {
    const query = String(req.query.q || "").toLowerCase().replace(/\s+/g, "");

    const url =
      "https://cwms-data.usace.army.mil/cwms-data/locations?office=SAM";

    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    const data = await response.json();

    const matches = data
      .filter((item) => {
        const text = `${item.name || ""} ${item["map-label"] || ""} ${
          item["nearest-city"] || ""
        }`
          .toLowerCase()
          .replace(/\s+/g, "");

        return text.includes(query);
      })
      .slice(0, 20);

    res.json({
      ok: response.ok,
      status: response.status,
      query: req.query.q,
      count: matches.length,
      matches,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.get("/api/hydro/usace-timeseries", async (req, res) => {
  try {
    const office = req.query.office || "SAM";
    const location = req.query.location || "WestPoint-Pool";

    const url =
      "https://cwms-data.usace.army.mil/cwms-data/catalog/TIMESERIES" +
      "?office=" +
      encodeURIComponent(office) +
      "&like=" +
      encodeURIComponent(`*${location}*`);

    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    const data = await response.json();

    res.json({
      ok: response.ok,
      status: response.status,
      office,
      location,
      preview: data,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.get("/api/hydro/usace-values", async (req, res) => {
  try {
    const office = req.query.office || "SAM";

    const name =
      req.query.name || "WestPoint.Flow-Out.Inst.15Minutes.0.Rev-CCP";

    const now = new Date();
    const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const url =
      "https://cwms-data.usace.army.mil/cwms-data/timeseries" +
      "?office=" +
      encodeURIComponent(office) +
      "&name=" +
      encodeURIComponent(name) +
      "&begin=" +
      encodeURIComponent(start.toISOString()) +
      "&end=" +
      encodeURIComponent(now.toISOString());

    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    const data = await response.json();

    const values = data?.values || [];
    const latest = values.at(-1);

    res.json({
      ok: response.ok,
      status: response.status,
      office,
      name,
      units: data?.units || null,
      count: values.length,
      latest: latest
        ? {
            time: latest[0],
            value: latest[1],
            quality: latest[2],
          }
        : null,
      preview: values.slice(-5),
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.get("/api/hydro/usace", async (req, res) => {
  try {
    const office = req.query.office || "SAM";
    const lake = req.query.lake || "WestPoint";

    const series = {
  lakeLevel: `${lake}.Elev.Inst.15Minutes.0.Raw-USGS`,
  guideCurve: `${lake}.Elev-Guide Curve.Inst.15Minutes.0.Rev-PROJECT`,
  outflow: `${lake}.Flow-Out.Inst.15Minutes.0.Rev-CCP`,
  inflow: `${lake}.Flow-In.Ave.15Minutes.15Minutes.Raw-CCP_CAVI`,
};

    async function getLatest(name) {
      const now = new Date();
      const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const url =
        "https://cwms-data.usace.army.mil/cwms-data/timeseries" +
        "?office=" +
        encodeURIComponent(office) +
        "&name=" +
        encodeURIComponent(name) +
        "&begin=" +
        encodeURIComponent(start.toISOString()) +
        "&end=" +
        encodeURIComponent(now.toISOString());

      const response = await fetch(url, {
        headers: { Accept: "application/json" },
      });

      const data = await response.json();
      const latest = data?.values?.at(-1);

      if (!latest) return null;

      return {
        name,
        units: data?.units || null,
        observedAt: new Date(latest[0]).toISOString(),
        value: latest[1],
        quality: latest[2],
      };
    }

    const [level, guideCurve, outflow, inflow] = await Promise.all([
  getLatest(series.lakeLevel),
  getLatest(series.guideCurve),
  getLatest(series.outflow),
  getLatest(series.inflow),
]);

    res.json({
      found: true,
      source: "USACE CWMS",
      office,
      lake,

      lakeLevelFt: level?.value ?? null,

      fullPoolFt: guideCurve?.value ?? null,

feetFromFullPool:
  level?.value != null && guideCurve?.value != null
    ? Number((level.value - guideCurve.value).toFixed(2))
    : null,

      // Use absolute value because some CWMS flow series report reverse/signed flow.
      dischargeCfs:
        outflow?.value != null ? Math.round(Math.abs(outflow.value)) : null,

      inflowCfs:
        inflow?.value != null ? Math.round(Math.abs(inflow.value)) : null,

      observedAt: level?.observedAt || outflow?.observedAt || inflow?.observedAt,

      raw: {
  level,
  guideCurve,
  outflow,
  inflow,
},
    });
  } catch (error) {
    console.error("USACE normalized route failed:", error);

    res.status(500).json({
      found: false,
      error: error.message,
    });
  }
});

app.get("/api/hydro/tva-api-hunt", async (req, res) => {
  try {
    const lake = req.query.lake || "chickamauga";

    const urls = [
      `https://www.tva.com/api/environment/lake-levels/${lake}`,
      `https://www.tva.com/api/lake-levels/${lake}`,
      `https://www.tva.com/environment/lake-levels/${lake}?format=json`,
      `https://www.tva.com/api/sitecore/LakeLevels/GetLakeLevels?lake=${lake}`,
    ];

    const results = [];

    for (const url of urls) {
      try {
        const response = await fetch(url, {
          headers: {
            Accept: "application/json,text/plain,*/*",
            "User-Agent": "Mozilla/5.0",
          },
        });

        const text = await response.text();

        results.push({
          url,
          status: response.status,
          contentType: response.headers.get("content-type"),
          preview: text.slice(0, 500),
        });
      } catch (error) {
        results.push({
          url,
          error: error.message,
        });
      }
    }

    res.json({
      ok: true,
      lake,
      results,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.get("/api/hydro/lakelevels", async (req, res) => {
  try {
    const query = String(req.query.lake || "")
      .toLowerCase()
      .replace(/\s+/g, "");

    const response = await fetch("https://www.lakelevels.info/", {
      headers: {
        "User-Agent": "Mozilla/5.0",
      },
    });

    const html = await response.text();
    const $ = cheerio.load(html);

    const rows = [];

    $("tr").each((_, row) => {
      const cells = $(row)
        .find("td")
        .map((_, cell) => $(cell).text().replace(/\s+/g, " ").trim())
        .get()
        .filter(Boolean);

      if (cells.length >= 4) rows.push(cells);
    });

    const match = rows.find((cells) => {
      const name = String(cells[0] || "")
        .toLowerCase()
        .replace(/\s+/g, "");

      return name.includes(query) || query.includes(name.replace(/\(.+\)/, ""));
    });

    if (!match) {
      return res.json({
        found: false,
        lake: req.query.lake,
        note: "Lake not found on LakeLevels.info.",
        debugRows: rows.slice(0, 8),
      });
    }

    res.json({
      found: true,
      source: "LakeLevels.info",
      lake: match[0],
      lakeLevelFt: Number(match[1]) || null,
      fullPoolFt: Number(match[2]) || null,
      feetFromFullPool: Number(match[3]) || null,
      observedAt: match.slice(4).join(" ") || null,
      rawRow: match,
    });
  } catch (error) {
    res.status(500).json({
      found: false,
      error: error.message,
    });
  }
});

app.get("/api/noaa/ndbc-stations", async (req, res) => {
  try {
    const response = await fetch("https://www.ndbc.noaa.gov/activestations.xml", {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/xml,text/xml,*/*",
      },
    });

    const text = await response.text();

    res.set("Access-Control-Allow-Origin", "*");
    res.set("Content-Type", "application/xml");
    res.status(response.status).send(text);
  } catch (error) {
    console.error("NDBC station fetch failed:", error);
    res.status(500).json({ error: "Failed to fetch NOAA stations" });
  }
});

app.get("/api/noaa/ndbc/:stationId", async (req, res) => {
  try {
    const stationId = String(req.params.stationId || "").replace(/[^A-Za-z0-9]/g, "");

    if (!stationId) {
      return res.status(400).json({ error: "Missing station ID" });
    }

    const response = await fetch(
      `https://www.ndbc.noaa.gov/data/realtime2/${stationId}.txt`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0",
          Accept: "text/plain,*/*",
        },
      },
    );

    const text = await response.text();

    res.set("Access-Control-Allow-Origin", "*");
    res.set("Content-Type", "text/plain");
    res.status(response.status).send(text);
  } catch (error) {
    console.error("NDBC realtime fetch failed:", error);
    res.status(500).json({ error: "Failed to fetch NOAA realtime data" });
  }
});

app.listen(3001, () => {
  console.log("Fish ID server running on http://localhost:3001");
});