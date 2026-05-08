import { useEffect, useMemo, useState } from "react";
import { LURE_COLORS, LURE_GROUPS, flattenLures } from "./data/lureLibrary";

export default function LurePicker({ onSelect, onClose }) {
  const [query, setQuery] = useState("");
  const [selectedGroup, setSelectedGroup] = useState(
    LURE_GROUPS[0]?.group || "",
  );
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedLure, setSelectedLure] = useState(null);
  const [selectedColor, setSelectedColor] = useState("");
  const [customName, setCustomName] = useState("");

  useEffect(() => {
    try {
      const savedText = localStorage.getItem("last-lure");
      if (!savedText) return;

      const saved = JSON.parse(savedText);

      if (saved.group) setSelectedGroup(saved.group);
      if (saved.category) setSelectedCategory(saved.category);
      if (saved.color) setSelectedColor(saved.color);
    } catch {}
  }, []);

  const allLures = useMemo(() => flattenLures(), []);

  const activeGroup = LURE_GROUPS.find((item) => item.group === selectedGroup);
  const categories = activeGroup ? Object.keys(activeGroup.categories) : [];

  const visibleLures = useMemo(() => {
    const q = query.trim().toLowerCase();

    if (q) {
      return allLures.filter((item) => item.search.includes(q)).slice(0, 80);
    }

    if (!activeGroup) return [];

    if (selectedCategory) {
      return activeGroup.categories[selectedCategory].map((type) => ({
        group: activeGroup.group,
        category: selectedCategory,
        type,
      }));
    }

    return Object.entries(activeGroup.categories).flatMap(([category, lures]) =>
      lures.map((type) => ({
        group: activeGroup.group,
        category,
        type,
      })),
    );
  }, [query, allLures, activeGroup, selectedCategory]);

  function confirm() {
    const type = selectedLure?.type || customName.trim();

    if (!type) return;

    const lure = {
      group: selectedLure?.group || "Custom",
      category: selectedLure?.category || "Custom",
      type,
      color: selectedColor || "Not specified",
      customName: customName.trim(),
    };

    onSelect(lure); // 👈 THIS closes the picker instantly
  }

  return (
    <div className="lurePickerOverlay">
      <div className="lurePickerHeader">
        <div>
          <p className="sectionLabel green">Lure Library</p>
          <h2>Select Lure</h2>
        </div>

        <button className="lureCloseButton" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="lureSearchWrap">
        <input
          autoFocus
          placeholder="Search lure, rig, bait, or technique..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedLure(null);
          }}
        />
      </div>

      <div className="lurePickerContent">
        <div className="lureGroupScroller">
          {LURE_GROUPS.map((item) => (
            <button
              key={item.group}
              className={selectedGroup === item.group ? "active" : ""}
              onClick={() => {
                setSelectedGroup(item.group);
                setSelectedCategory("");
                setQuery("");
                setSelectedLure(null);
              }}
            >
              {item.group}
            </button>
          ))}
        </div>

        {!query && (
          <div className="lureCategoryScroller">
            <button
              className={!selectedCategory ? "active" : ""}
              onClick={() => {
                setSelectedCategory("");
                setSelectedLure(null);
              }}
            >
              All
            </button>

            {categories.map((category) => (
              <button
                key={category}
                className={selectedCategory === category ? "active" : ""}
                onClick={() => {
                  setSelectedCategory(category);
                  setSelectedLure(null);
                }}
              >
                {category}
              </button>
            ))}
          </div>
        )}

        <div className="lureGrid">
          {visibleLures.map((item) => (
            <button
              key={`${item.group}-${item.category}-${item.type}`}
              className={
                selectedLure?.type === item.type &&
                selectedLure?.group === item.group &&
                selectedLure?.category === item.category
                  ? "selected"
                  : ""
              }
              onClick={() => {
                setSelectedLure(item);
                setCustomName("");
              }}
            >
              <strong>{item.type}</strong>
              <span>{item.category}</span>
              <small>{item.group}</small>
            </button>
          ))}
        </div>

        <div className="customLureBox">
          <p className="sectionLabel">Custom Lure / Bait</p>
          <input
            placeholder="Type your own lure name..."
            value={customName}
            onChange={(e) => {
              setCustomName(e.target.value);
              setSelectedLure(null);
            }}
          />
        </div>

        <div className="colorSection">
          <p className="sectionLabel">Color / Pattern</p>

          <div className="colorChipGrid">
            {LURE_COLORS.map((color) => (
              <button
                key={color}
                className={selectedColor === color ? "selected" : ""}
                onClick={() => setSelectedColor(color)}
              >
                {color}
              </button>
            ))}
          </div>
        </div>

        <div className="lurePickerSpacer" />
      </div>

      <div className="lureConfirmBar">
        <div>
          <strong>
            {selectedLure?.type || customName || "No lure selected"}
          </strong>
          <span>{selectedColor || "No color selected"}</span>
        </div>

        <button
          disabled={!selectedLure && !customName.trim()}
          onClick={confirm}
        >
          Use This
        </button>
      </div>
    </div>
  );
}
