# TornPropertyWatcher — Design Spec

**Date:** 2026-04-19

## Overview

A Greasemonkey userscript that polls the Torn v2 market API for cheap Private Island (PI) property listings and alerts the player with a banner and audio when one appears below a price threshold.

## Files

- `TornPropertyWatcher.meta.js` — UserScript headers only (for `@updateURL`)
- `TornPropertyWatcher.user.js` — Full script

## Core Behavior

**Polling:**
- Interval: every 10 seconds (6 calls/min)
- Endpoint: `GET https://api.torn.com/v2/market/13/properties`
  - Property type 13 = Private Island
- Filter: `cost < 1_700_000_000`
- Selection: pick the single cheapest qualifying listing

**Note in header comment:** At 6 calls/min, this script competes with TornRetalMonitor, TornTargetManager, and TornRankedWarTargetFinder for Torn's 100 calls/min API budget. Running all simultaneously is safe but should be kept in mind.

## Alert Logic

- Track `lastAlertedId` (the property ID of the last alerted listing)
- Play audio + show banner only when a qualifying property appears with an ID different from `lastAlertedId`
- If user dismisses the banner, do not re-alert for the same property ID until it disappears from the listings and then reappears
- On each poll: if no qualifying listings exist, reset `lastAlertedId` so a future reappearance triggers a fresh alert

## Banner

- Fixed position: top-center of page
- Dark background, white text
- Content: `"PI available for $X,XXX,XXX,XXX — Click to buy"`
- Entire banner is a link to `https://www.torn.com/properties.php#/p=market`
- × dismiss button on the right
- Persists until manually dismissed (no auto-dismiss)

## Audio Alert

- Triggered only on new qualifying detection (not every poll)
- Web Audio API: two sequential `OscillatorNode`s via `AudioContext`
  - Tone 1: 880 Hz, 200ms
  - Tone 2: 1100 Hz, 200ms
- No external files or dependencies

## Configuration / First Run

- API key stored via `GM_getValue`/`GM_setValue` under key `tornPropertyWatcherApiKey`
- If no key is stored on first load:
  - Banner area shows an input field + save button instead of a property alert
  - Once key is saved, polling begins immediately
- Price threshold is a constant in the script (`PRICE_THRESHOLD = 1_700_000_000`) — not user-configurable via UI

## Script Headers

```
@name         Torn Property Watcher
@namespace    https://xoke.org/
@version      1.0
@description  Alerts when a cheap Private Island appears on the Torn property market
@author       Xoke
@match        https://www.torn.com/*
@run-at       document-end
@grant        GM_setValue
@grant        GM_getValue
@grant        GM_addStyle
@grant        GM_xmlhttpRequest
@connect      api.torn.com
```

## Structure

Follows the standard pattern used by other scripts in this repo:

```js
(function() {
    'use strict';
    const DEBUG = false;
    // constants, state
    // GM_addStyle(...)
    // buildUI() — create banner DOM
    // playAlert() — Web Audio chime
    // checkMarket() — API call + filter logic
    // setInterval(checkMarket, 10000)
    // initialize() — key check, UI inject, start polling
    // DOMContentLoaded / immediate call
})();
```
