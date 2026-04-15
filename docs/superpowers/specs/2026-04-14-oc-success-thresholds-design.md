# OC Success Thresholds — Design Spec
**Date:** 2026-04-14  
**Script:** TornOCSuccessHighlighter  
**Target version:** 4.0

---

## Summary

Add a per-level configurable success threshold to TornOCSuccessHighlighter. Currently all levels share a hardcoded 70% threshold. The new feature lets faction leaders set a minimum success % per OC level via a modal settings panel injected above the crime card list.

---

## Data Model

```js
const DEFAULT_THRESHOLDS = {
    1: 0,   // introductory — never highlight
    2: 70, 3: 70, 4: 70, 5: 70, 6: 70,  // simple/intermediate
    7: 60, 8: 60, 9: 60, 10: 60          // advanced/elaborate
};
let thresholds = { ...DEFAULT_THRESHOLDS };
```

- Level 1 defaults to 0% so it never triggers highlighting (any rate ≥ 0 passes).
- Stored as a single JSON string under the key `'oc_thresholds'` via `GM_setValue`/`GM_getValue`.
- Loaded once at script init; re-applied immediately after Save.

---

## Constants

- `MIN_LEVEL`: `1` (was `2`)
- `MAX_LEVEL`: `10` (was `6`)
- `SUCCESS_THRESHOLD` constant: **removed**

---

## Highlighting Logic Change

In `highlightSlotIssues()`, replace:

```js
if (successRate < SUCCESS_THRESHOLD)
```

with:

```js
if (successRate < thresholds[level])
```

A threshold of 0 means the level is never highlighted regardless of success rate.

---

## UI — Settings Button

- Injected as a `<div>` containing a `<button>` just above the first crime card in the OC list.
- Selector target: first `[data-oc-id]` element inside the crimes root; button inserted as `previousSibling`.
- Guarded against double-injection with an element ID check (`oc-threshold-btn-wrap`).
- Re-injection checked on each `runAllChecks()` call (OC tab may re-render).
- Button label: `⚙ OC Thresholds`, right-aligned.

---

## UI — Modal

- Single `<div id="oc-threshold-modal">` appended to `document.body` on first inject.
- Display toggled via `style.display` (none / block).
- Layout: 2-column × 5-row grid for levels 1–10, compact 32px-wide number inputs.
- Each input: `type="number"`, `min="0"`, `max="100"`, no spinner arrows (via CSS).
- Footer: Save (applies + persists + closes + re-runs checks) and Cancel (closes, discards).
- Clicking outside the modal panel closes it (mousedown on overlay).

---

## Grants

Both `TornOCSuccessHighlighter.meta.js` and `TornOCSuccessHighlighter.user.js`:

```
// @grant        GM_setValue
// @grant        GM_getValue
```

`@grant none` is removed (incompatible with other grants).

---

## Styles

Injected via a `<style>` tag (same pattern as existing `injectLabelStyles()`). Covers:
- `#oc-threshold-modal` overlay and panel
- `#oc-threshold-btn-wrap` button
- Input spinner suppression (`input[type=number]::-webkit-inner-spin-button { display:none }`)

---

## Version Bump

Both files: `3.5` → `4.0` (minor version, new user-facing feature).
