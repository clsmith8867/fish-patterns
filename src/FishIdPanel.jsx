import { useMemo, useState } from "react";
import { getSpeciesOptions, saveFishIdCorrection } from "./fishIdEngine";

export default function FishIdPanel({
  rawResults = [],
  imageId,
  correctedSpeciesName = "",
  onSpeciesConfirmed
}) {
  const [confirmedSpecies, setConfirmedSpecies] = useState("");
  const [saved, setSaved] = useState(false);

  const speciesOptions = getSpeciesOptions();

  const smartResults = useMemo(() => {
    if (correctedSpeciesName) {
      return [
        {
          key: "corrected_species",
          name: correctedSpeciesName,
          confidence: 99,
          traits: ["This photo was previously corrected by you."],
          lookalikes: []
        }
      ];
    }

    return rawResults.map((result, index) => ({
      key: `ai_guess_${index}`,
      name: result.label,
      confidence: Math.round((result.score || 0) * 100),
      traits: [result.reason || "Backend AI guess"],
      lookalikes: []
    }));
  }, [rawResults, correctedSpeciesName]);

  const topGuess = smartResults[0];

  if (!topGuess) return null;

  function confirmSpecies(speciesName) {
  alert("FishIdPanel confirmed: " + speciesName);

  if (!speciesName) return;

  setConfirmedSpecies(speciesName);
  setSaved(true);

  onSpeciesConfirmed?.(speciesName);

  if (imageId) {
    saveFishIdCorrection({
      imageId,
      guessedSpeciesKey: topGuess.name,
      confirmedSpeciesKey: speciesName
    });
  }
}
  return (
    <div className="fish-id-card">
      <div className="fish-id-header">
        <div>
          <p className="eyebrow">Smart Fish ID</p>
          <h2>{topGuess.name}</h2>
        </div>

        <div className="confidence-badge">{topGuess.confidence}%</div>
      </div>

      <div className="guess-list">
        {smartResults.map((fish) => (
          <div key={fish.key} className="guess-row">
            <span>{fish.name}</span>
            <strong>{fish.confidence}%</strong>
          </div>
        ))}
      </div>

      <div className="trait-box">
        <h3>Why it thinks that</h3>
        <ul>
          {topGuess.traits.slice(0, 4).map((trait) => (
            <li key={trait}>{trait}</li>
          ))}
        </ul>
      </div>

      <div className="trait-box">
        <h3>Common mix-ups</h3>
        <p>{topGuess.lookalikes.join(", ")}</p>
      </div>

      <div className="confirm-area">
        <button onClick={() => confirmSpecies(topGuess.name)}>
          Correct
        </button>

        <select
          value={confirmedSpecies}
          onChange={(e) => {
            setConfirmedSpecies(e.target.value);
            setSaved(false);
          }}
        >
          <option value="">Wrong? Pick species</option>
          {speciesOptions.map((species) => (
            <option key={species.key} value={species.name}>
              {species.name}
            </option>
          ))}
        </select>

        <button
          disabled={!confirmedSpecies}
          onClick={() => confirmSpecies(confirmedSpecies)}
        >
          Save Correction
        </button>
      </div>

      {saved && (
        <p className="saved-note">
          Saved correction and updated species field.
        </p>
      )}
    </div>
  );
}