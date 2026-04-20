# TornPropertyWatcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Greasemonkey userscript that polls the Torn v2 property market API every 10 seconds and alerts the player with a banner + audio chime when a Private Island is listed below $1.7 billion.

**Architecture:** A single self-contained IIFE userscript. On load it checks for a stored API key; if missing it renders a setup UI in the banner slot. Once a key exists, `setInterval` fires `checkMarket()` every 10 seconds via `GM_xmlhttpRequest`. Alert state is tracked in memory (`lastAlertedId`) — no persistence needed since a page reload is a fresh context and the market is live data.

**Tech Stack:** Vanilla JS, Greasemonkey 4 / Tampermonkey APIs (`GM_setValue`, `GM_getValue`, `GM_addStyle`, `GM_xmlhttpRequest`), Web Audio API.

---

### Task 1: Create meta.js

**Files:**
- Create: `TornPropertyWatcher.meta.js`

- [ ] **Step 1: Create the meta file**

```js
// ==UserScript==
// @name         Torn Property Watcher
// @namespace    https://xoke.org/
// @version      1.0
// @description  Alerts when a cheap Private Island appears on the Torn property market
// @author       Xoke
// @match        https://www.torn.com/*
// @run-at       document-end
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      api.torn.com
// @homepageURL  https://github.com/Xoke/torn
// @downloadURL  https://raw.githubusercontent.com/Xoke/torn/main/TornPropertyWatcher.user.js
// @updateURL    https://raw.githubusercontent.com/Xoke/torn/main/TornPropertyWatcher.meta.js
// ==/UserScript==
```

- [ ] **Step 2: Commit**

```bash
git add TornPropertyWatcher.meta.js
git commit -m "feat: add TornPropertyWatcher meta.js"
```

---

### Task 2: Create user.js scaffold with headers and CSS

**Files:**
- Create: `TornPropertyWatcher.user.js`

- [ ] **Step 1: Create user.js with headers, constants, and styles**

```js
// ==UserScript==
// @name         Torn Property Watcher
// @namespace    https://xoke.org/
// @version      1.0
// @description  Alerts when a cheap Private Island appears on the Torn property market
// @author       Xoke
// @match        https://www.torn.com/*
// @run-at       document-end
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      api.torn.com
// @homepageURL  https://github.com/Xoke/torn
// @downloadURL  https://raw.githubusercontent.com/Xoke/torn/main/TornPropertyWatcher.user.js
// @updateURL    https://raw.githubusercontent.com/Xoke/torn/main/TornPropertyWatcher.meta.js
// ==/UserScript==

// Note: This script polls api.torn.com every 10 seconds (6 calls/min).
// If running alongside TornRetalMonitor, TornTargetManager, or TornRankedWarTargetFinder,
// combined usage still fits within Torn's 100 calls/min limit.

(function () {
    'use strict';

    const DEBUG = false;
    const PRICE_THRESHOLD = 1_700_000_000;
    const POLL_INTERVAL = 10000;
    const PROPERTY_TYPE_ID = 13; // Private Island
    const API_KEY_STORAGE = 'tornPropertyWatcherApiKey';
    const MARKET_URL = 'https://www.torn.com/properties.php#/p=market';

    function debugLog(...args) {
        if (DEBUG) console.log('[Property Watcher]', ...args);
    }

    let apiKey = GM_getValue(API_KEY_STORAGE, '');
    let lastAlertedId = null;
    let bannerEl = null;
    let pollTimer = null;

    GM_addStyle(`
        #torn-pw-banner {
            position: fixed;
            top: 0;
            left: 50%;
            transform: translateX(-50%);
            z-index: 999999;
            font-family: Arial, sans-serif;
            font-size: 13px;
        }

        #torn-pw-inner {
            display: flex;
            align-items: center;
            gap: 10px;
            background: #1a1a1a;
            border: 2px solid #444;
            border-top: none;
            border-radius: 0 0 8px 8px;
            padding: 8px 14px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.6);
        }

        #torn-pw-link {
            color: #4fc;
            text-decoration: none;
            font-weight: bold;
            white-space: nowrap;
        }

        #torn-pw-link:hover {
            color: #7fe;
            text-decoration: underline;
        }

        #torn-pw-dismiss {
            background: rgba(255,255,255,0.1);
            border: 1px solid #555;
            color: #aaa;
            cursor: pointer;
            border-radius: 4px;
            width: 22px;
            height: 22px;
            font-size: 14px;
            line-height: 20px;
            text-align: center;
            flex-shrink: 0;
        }

        #torn-pw-dismiss:hover {
            background: rgba(255,255,255,0.2);
            color: #fff;
        }

        #torn-pw-setup {
            display: flex;
            align-items: center;
            gap: 8px;
            color: #ccc;
        }

        #torn-pw-key-input {
            background: #333;
            border: 1px solid #555;
            color: #fff;
            border-radius: 4px;
            padding: 4px 8px;
            font-size: 12px;
            width: 160px;
        }

        #torn-pw-key-save {
            background: #2a6;
            border: 1px solid #3b7;
            color: #fff;
            cursor: pointer;
            border-radius: 4px;
            padding: 4px 10px;
            font-size: 12px;
            font-weight: bold;
        }

        #torn-pw-key-save:hover {
            background: #3b7;
        }
    `);
})();
```

- [ ] **Step 2: Load the script in Tampermonkey and verify no console errors on any torn.com page**

- [ ] **Step 3: Commit**

```bash
git add TornPropertyWatcher.user.js
git commit -m "feat: add TornPropertyWatcher scaffold with styles"
```

---

### Task 3: Add banner DOM builder

**Files:**
- Modify: `TornPropertyWatcher.user.js` — add `buildBanner()`, `showSetupUI()`, `showAlertUI()`, `hideBanner()` inside the IIFE before the closing `})();`

- [ ] **Step 1: Add banner functions**

```js
    function buildBanner() {
        if (bannerEl) return;
        bannerEl = document.createElement('div');
        bannerEl.id = 'torn-pw-banner';
        const inner = document.createElement('div');
        inner.id = 'torn-pw-inner';
        bannerEl.appendChild(inner);
        document.body.appendChild(bannerEl);
    }

    function showSetupUI() {
        buildBanner();
        const inner = bannerEl.querySelector('#torn-pw-inner');
        inner.innerHTML = '';

        const setup = document.createElement('div');
        setup.id = 'torn-pw-setup';
        setup.innerHTML = '<span>Property Watcher: enter API key</span>';

        const input = document.createElement('input');
        input.id = 'torn-pw-key-input';
        input.type = 'text';
        input.placeholder = 'Torn API key (16 chars)';
        input.maxLength = 16;

        const save = document.createElement('button');
        save.id = 'torn-pw-key-save';
        save.textContent = 'Save';
        save.addEventListener('click', function () {
            const val = input.value.trim();
            if (!/^[a-zA-Z0-9]{16}$/.test(val)) {
                input.style.borderColor = '#c33';
                return;
            }
            apiKey = val;
            GM_setValue(API_KEY_STORAGE, apiKey);
            hideBanner();
            startPolling();
        });

        setup.appendChild(input);
        setup.appendChild(save);
        inner.appendChild(setup);
    }

    function showAlertUI(price, propertyId) {
        buildBanner();
        const inner = bannerEl.querySelector('#torn-pw-inner');
        inner.innerHTML = '';

        const link = document.createElement('a');
        link.id = 'torn-pw-link';
        link.href = MARKET_URL;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = 'PI available for $' + price.toLocaleString() + ' \u2014 Click to buy';

        const dismiss = document.createElement('button');
        dismiss.id = 'torn-pw-dismiss';
        dismiss.textContent = '\u00d7';
        dismiss.title = 'Dismiss';
        dismiss.addEventListener('click', function () {
            hideBanner();
        });

        inner.appendChild(link);
        inner.appendChild(dismiss);
        bannerEl.style.display = '';
    }

    function hideBanner() {
        if (bannerEl) bannerEl.style.display = 'none';
    }
```

- [ ] **Step 2: Temporarily call `showSetupUI()` at the bottom of the IIFE (before `})();`) to verify the setup banner renders correctly on a torn.com page**

- [ ] **Step 3: Remove that temporary call after verifying**

- [ ] **Step 4: Commit**

```bash
git add TornPropertyWatcher.user.js
git commit -m "feat: add banner DOM builder functions"
```

---

### Task 4: Add audio alert

**Files:**
- Modify: `TornPropertyWatcher.user.js` — add `playAlert()` inside the IIFE

- [ ] **Step 1: Add playAlert function**

```js
    function playAlert() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();

            function playTone(freq, startTime, duration) {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.type = 'sine';
                osc.frequency.value = freq;
                gain.gain.setValueAtTime(0.4, startTime);
                gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
                osc.start(startTime);
                osc.stop(startTime + duration);
            }

            const t = ctx.currentTime;
            playTone(880, t, 0.2);
            playTone(1100, t + 0.22, 0.2);
        } catch (e) {
            debugLog('Audio failed:', e);
        }
    }
```

- [ ] **Step 2: Temporarily call `playAlert()` at the bottom of the IIFE to verify the chime plays on a torn.com page (browsers may require a user gesture first — click anywhere on the page, then reload)**

- [ ] **Step 3: Remove the temporary call**

- [ ] **Step 4: Commit**

```bash
git add TornPropertyWatcher.user.js
git commit -m "feat: add Web Audio two-tone alert"
```

---

### Task 5: Add checkMarket() API polling logic

**Files:**
- Modify: `TornPropertyWatcher.user.js` — add `checkMarket()` and `startPolling()` inside the IIFE

- [ ] **Step 1: Add checkMarket and startPolling**

```js
    function checkMarket() {
        GM_xmlhttpRequest({
            method: 'GET',
            url: 'https://api.torn.com/v2/market/' + PROPERTY_TYPE_ID + '/properties?key=' + apiKey,
            onload: function (response) {
                let data;
                try {
                    data = JSON.parse(response.responseText);
                } catch (e) {
                    debugLog('JSON parse error:', e);
                    return;
                }

                if (data.error) {
                    debugLog('API error:', data.error);
                    return;
                }

                const listings = data.properties || [];
                const cheap = listings
                    .filter(function (p) { return p.cost < PRICE_THRESHOLD; })
                    .sort(function (a, b) { return a.cost - b.cost; });

                if (cheap.length === 0) {
                    lastAlertedId = null;
                    return;
                }

                const best = cheap[0];
                if (best.id === lastAlertedId) return;

                lastAlertedId = best.id;
                debugLog('Found cheap PI:', best.id, best.cost);
                playAlert();
                showAlertUI(best.cost, best.id);
            },
            onerror: function (err) {
                debugLog('Request error:', err);
            }
        });
    }

    function startPolling() {
        if (pollTimer) clearInterval(pollTimer);
        checkMarket();
        pollTimer = setInterval(checkMarket, POLL_INTERVAL);
    }
```

- [ ] **Step 2: Verify the function exists without syntax errors (reload the script in Tampermonkey, check the browser console for errors)**

- [ ] **Step 3: Commit**

```bash
git add TornPropertyWatcher.user.js
git commit -m "feat: add checkMarket polling and startPolling"
```

---

### Task 6: Wire up initialize() and complete the script

**Files:**
- Modify: `TornPropertyWatcher.user.js` — add `initialize()` and the DOMContentLoaded guard at the bottom of the IIFE

- [ ] **Step 1: Add initialize and startup**

```js
    function initialize() {
        if (!apiKey) {
            showSetupUI();
            return;
        }
        startPolling();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
```

- [ ] **Step 2: Full smoke test — first-run flow**
  - Remove stored key: in browser console run `GM_deleteValue('tornPropertyWatcherApiKey')` or clear via Tampermonkey storage editor
  - Reload a torn.com page
  - Expected: setup banner appears at top-center asking for API key
  - Enter a valid 16-char key, click Save
  - Expected: banner hides, polling starts (check console with `DEBUG = true` temporarily)

- [ ] **Step 3: Full smoke test — alert flow**
  - Temporarily lower `PRICE_THRESHOLD` to a very high number (e.g. `9_999_999_999`) so any listing triggers the alert
  - Reload the page
  - Expected within 10 seconds: chime plays + alert banner appears with price and "Click to buy" link
  - Click the banner — expected: opens `https://www.torn.com/properties.php#/p=market` in a new tab
  - Click × — expected: banner hides, does not reappear for same property on next poll
  - Restore `PRICE_THRESHOLD` to `1_700_000_000`

- [ ] **Step 4: Commit**

```bash
git add TornPropertyWatcher.user.js
git commit -m "feat: wire up initialize and startup guard"
```

---

### Task 7: Final version bump and consistency check

**Files:**
- Verify: `TornPropertyWatcher.meta.js` and `TornPropertyWatcher.user.js` have matching `@version` and `@description`

- [ ] **Step 1: Confirm both files have `@version 1.0` and identical `@description` lines**

Compare:
```bash
grep -E "@version|@description" TornPropertyWatcher.meta.js TornPropertyWatcher.user.js
```

Expected output — both lines match in each file:
```
TornPropertyWatcher.meta.js:// @version      1.0
TornPropertyWatcher.meta.js:// @description  Alerts when a cheap Private Island appears on the Torn property market
TornPropertyWatcher.user.js:// @version      1.0
TornPropertyWatcher.user.js:// @description  Alerts when a cheap Private Island appears on the Torn property market
```

- [ ] **Step 2: Commit if any corrections were needed, otherwise done**

```bash
git add TornPropertyWatcher.meta.js TornPropertyWatcher.user.js
git commit -m "fix: ensure meta and user.js version/description match"
```
