# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This repository contains Greasemonkey/Tampermonkey userscripts for the browser game Torn (torn.com). These scripts enhance gameplay by providing additional UI features, data extraction, and monitoring capabilities.

## Script Architecture

### Dependencies
- **FF Scouter**: An external userscript that must be installed. It provides battle stat estimates and fair fight values for Torn players. All scripts in this repository assume FF Scouter is already installed and running.
- **Torn API**: Some scripts use the Torn API for data fetching (requires user API key)

### Common Patterns

**DOM Element Selection:**
Scripts use CSS class selectors that match Torn's dynamically-generated class names (e.g., `.col1____LGQW`, `.message___Z4JCk`, `.row___XdzXz`). These are obfuscated classes that may change with Torn updates.

**FF Scouter Integration:**
Scripts look for specific FF Scouter elements in the DOM:
- `.ff-scouter-est-visible` - Visible battle stat estimates
- `.ff-scouter-est-hidden` - Hidden battle stat estimates
- `.ff` or `[class*="ff-scouter"]` - Fair fight values (typically 1.0-5.0)

**Battle Stats Parsing:**
Scripts parse battle stat strings like "1.5m", "500k", "2.3b" into numeric values:
```javascript
function parseBattleStats(text) {
    // Handles: 1.5m → 1500000, 500k → 500000, 2.3b → 2300000000
}
```

**Status Detection:**
Player status is determined by:
1. Status color from API (green=online, red=hospital, blue=traveling, orange=jail)
2. Status text parsing from DOM elements
3. Last action timestamp for idle/offline determination (5min threshold for idle, 10min for offline)

**Storage:**
Scripts use `GM_setValue`/`GM_getValue` for persistent storage across page loads. Common storage keys:
- `'tornWarTargets'` - Cached faction member data
- `'tornWarHidden'` - Hidden user IDs
- `'apiKey'` - User's Torn API key
- `'scrapedFactionId'` - Last scraped faction ID

### Script Structure

Each script follows this pattern:

1. **UserScript Header** - Defines metadata (`@name`, `@match`, `@grant`, etc.)
2. **IIFE Wrapper** - `(function() { 'use strict'; ... })();` for scope isolation
3. **Initialization Logic** - Wait for DOM ready, then initialize
4. **MutationObserver** - Watch for DOM changes (Torn uses dynamic content loading)
5. **UI Injection** - Create buttons, overlays, or monitoring elements

### Testing Scripts

Scripts cannot be unit tested traditionally. To test:
1. Install in Tampermonkey/Greasemonkey
2. Navigate to the matching Torn page URL (check `@match` in script header)
3. Check browser console for debug logs (all scripts log initialization and key events)
4. Verify UI elements appear and function correctly

### URL Patterns

- **Attack page**: `https://www.torn.com/loader.php?sid=attack*`
- **Faction page**: `https://www.torn.com/factions.php?*`
- **General pages**: `https://www.torn.com/*`

### Torn API Integration

When using the API:
- Base URL: `https://api.torn.com/`
- Format: `/faction/{id}?selections=basic&key={apiKey}`
- Rate limiting: Torn allows 100 API calls per minute (~1.6 seconds per call average)
  - Scripts typically use 5-second delays (`API_DELAY = 5000`) which is very conservative
  - Minimum safe delay for continuous polling: ~2 seconds
- Error handling: Check for `data.error` in API responses
  - Error code 2: Invalid API key (permanent error)
  - Error code 10: Access denied (permanent error)
  - Other errors may be transient and worth retrying

## Script-Specific Notes

### Torn Attack Monitor
- Watches attack log entries for "initiated an attack" messages
- Uses a Set to track unique attackers (no duplicate notifications)
- Creates stacked notifications in top-right corner
- Requires the attack log container (`.list___UZYhA`) to be present

### Torn Faction CSV Exporter
- Scrapes faction member table data (requires FF Scouter to be loaded first)
- Sorts members by battle stats (highest to lowest) before export
- Skips fallen/fedded members automatically
- Output filename: `faction_members_sorted_v26.csv`

### Torn Ranked War Target Finder
- Two data loading methods:
  1. Scrape from faction page (preserves FF values)
  2. Fetch from API (loses FF values but gets live status)
- Auto-refresh feature updates status every 2 seconds via API
- Preserves FF and battle stat estimates when refreshing from API
- Hidden targets are stored separately and can be toggled visible
- Filters are client-side (no API calls for filtering)

## Userscript Version Management

**CRITICAL**: When updating userscripts, ALWAYS update BOTH files:
1. The main script file (`*.user.js`)
2. The metadata file (`*.meta.js`)

Both files MUST have:
- Matching version numbers in the `@version` field
- Matching descriptions in the `@description` field
- All other metadata fields synchronized

The `.meta.js` file is used by userscript managers to check for updates, so failing to update it will prevent users from receiving script updates.

## Creating New Scripts

When creating new scripts for this repository:

1. Use the same UserScript header format with appropriate `@match` URLs
2. **ALWAYS set `@author` to `Xoke` in the UserScript header**
3. Wrap code in IIFE: `(function() { 'use strict'; ... })();`
4. Add console.log statements for debugging key events
5. Use MutationObserver when monitoring dynamic content
6. Check for element existence before accessing (Torn loads content asynchronously)
7. Follow the retry pattern: `setTimeout(init, 500)` if elements aren't found yet
8. Version scripts appropriately (format: X.Y where X = major changes, Y = minor)
9. If integrating with FF Scouter, wait for its elements to be present in the DOM
10. Use `GM_addStyle` for CSS injection to avoid CSP issues
11. For faction-related scripts, handle both member table structures (old and new Torn UI)
12. **ALWAYS create both `.user.js` and `.meta.js` files for new scripts**
13. **ALWAYS set `@author` to `Xoke` in BOTH the `.user.js` and `.meta.js` files**
14. Please make sure the scripts will work on Torn PDA