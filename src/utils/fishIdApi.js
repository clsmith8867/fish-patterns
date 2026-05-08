const FISH_ID_SERVER = "http://192.168.1.203:3001";

export async function identifyFish(photoDataUrl, examples = []) {
  try {
    const res = await fetch(`${FISH_ID_SERVER}/identify-fish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        image: photoDataUrl,
        examples
      })
    });

    const data = await res.json();

    if (!res.ok) return null;

    return {
      species: data.species || "",
      scientificName: data.scientificName || "",
      confidence: data.confidence || null,
      source: data.source || "",
      topGuesses: data.topGuesses || []
    };
  } catch (error) {
    console.error("Fish ID failed", error);
    return null;
  }
}