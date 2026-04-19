# TornOCSuccessHighlighter — Per-Position Thresholds via Remote Config

**Date:** 2026-04-19
**Version target:** 4.1

## Overview

Add per-position success thresholds to TornOCSuccessHighlighter, loaded automatically from a JSON config file in the same repo. Eliminates the need for each faction member to configure thresholds manually — one person maintains the config file, everyone auto-syncs.

## Data Model

Config is keyed by crime name → position name → threshold percentage (integer, 0–100):

```json
{
  "Gaslight the Way": {
    "Imitator 1": 50,
    "Imitator 2": 70,
    "Imitator 3": 70,
    "Looter 1": 50,
    "Looter 2": 50,
    "Looter 3": 50
  }
}
```

Position names in the config match the forum post format ("Looter 1", no `#`). The DOM uses `#` notation ("Looter #1"), so the script normalizes DOM names by stripping `#` before lookup.

## Config File

- Filename: `TornOCSuccessHighlighter.config.json` in the repo root
- Raw URL: `https://raw.githubusercontent.com/Xoke/torn/main/TornOCSuccessHighlighter.config.json`
- Maintained alongside the script; updates are pushed to `main` and users auto-sync within 24 hours

## Threshold Lookup (Fallback Chain)

For each filled slot, the threshold is resolved in this order:

1. `remoteConfig[crimeName][positionName]` — if remote config is loaded and entry exists
2. `thresholds[level]` — existing per-level threshold (unchanged)

Per-level thresholds remain as-is and continue to work for any crime/position not covered by the remote config.

## Remote Config Loading

- `GM_xmlhttpRequest` fetches the config URL on script init
- `@connect *` added to both `.meta.js` and `.user.js` (URL is user-configurable)
- Fetched JSON cached in `GM_getValue('oc_remote_config')` as a string
- Cache timestamp stored in `GM_getValue('oc_remote_config_ts')`
- TTL: 24 hours — re-fetches once per day on init, uses cache otherwise
- On fetch failure: uses cached copy silently; if no cache exists, falls through to per-level thresholds
- On bad JSON: same fallback behavior, error swallowed silently

## New Helpers

- `getCrimeName(crimeCard)` — reads crime name element from card DOM (substring class match pattern)
- `getPositionName(slotElement)` — reads role name from slot header, strips `#` for config lookup
- `getThreshold(level, crimeCard, slotElement)` — replaces direct `thresholds[level]` call in `highlightSlotIssues()`; implements the fallback chain above

## UI Changes

The existing thresholds modal gains a new section **above** the level grid:

- Label: "Remote Config URL"
- Full-width text input bound to `GM_getValue('oc_config_url')`
- "Load Now" button — triggers immediate re-fetch, ignores TTL, updates status
- Status line: "Last loaded: [timestamp]" / "Not set" / "Failed"

URL saves alongside thresholds when the user clicks Save. No separate modal needed.

## File Changes

| File | Change |
|------|--------|
| `TornOCSuccessHighlighter.user.js` | All logic changes, version → 4.1 |
| `TornOCSuccessHighlighter.meta.js` | Add `@connect *`, version → 4.1, description match |
| `TornOCSuccessHighlighter.config.json` | New file — empty `{}` initially, faction fills in |
