# OC Position Thresholds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-position success thresholds to TornOCSuccessHighlighter, auto-loaded from a JSON config file in the same repo.

**Architecture:** A remote config JSON file (`TornOCSuccessHighlighter.config.json`) is fetched via `GM_xmlhttpRequest` on init, cached for 24 hours in `GM_getValue`. A new `getThreshold()` helper replaces all direct `thresholds[level]` lookups, implementing the fallback chain: remote config → per-level threshold. The settings modal gains a URL field + Load Now button.

**Tech Stack:** Greasemonkey/Tampermonkey userscript, plain JS, `GM_xmlhttpRequest`, `GM_setValue`/`GM_getValue`. No build system, no tests framework — verification is manual in browser DevTools.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `TornOCSuccessHighlighter.config.json` | Create | Repo-hosted config; faction leader edits this |
| `TornOCSuccessHighlighter.meta.js` | Modify | Version bump, add `@connect *`, add `@grant GM_xmlhttpRequest` |
| `TornOCSuccessHighlighter.user.js` | Modify | All logic + UI changes |

---

## Task 1: Create config file and update headers

**Files:**
- Create: `TornOCSuccessHighlighter.config.json`
- Modify: `TornOCSuccessHighlighter.meta.js`
- Modify: `TornOCSuccessHighlighter.user.js` (headers only)

- [ ] **Step 1: Create the config file**

Create `TornOCSuccessHighlighter.config.json` in the repo root:

```json
{}
```

- [ ] **Step 2: Update meta.js headers**

In `TornOCSuccessHighlighter.meta.js`, make these changes:
- `@version` → `4.1`
- Add `@grant GM_xmlhttpRequest` after existing `@grant` lines
- Add `@connect *` after `@grant` lines

Result:
```js
// ==UserScript==
// @name         Torn OC Success Highlighter
// @namespace    https://xoke.org/
// @version      4.1
// @run-at       document-end
// @description  Highlights low success OC participants, stalled OCs, and missing items (with item name label)
// @author       Xoke
// @match        https://www.torn.com/factions.php*
// @homepageURL  https://github.com/Xoke/torn
// @updateURL    https://raw.githubusercontent.com/Xoke/torn/main/TornOCSuccessHighlighter.meta.js
// @downloadURL  https://raw.githubusercontent.com/Xoke/torn/main/TornOCSuccessHighlighter.user.js
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==
```

- [ ] **Step 3: Update user.js headers to match**

In `TornOCSuccessHighlighter.user.js`, apply the same header changes (lines 1–14):

```js
// ==UserScript==
// @name         Torn OC Success Highlighter
// @namespace    https://xoke.org/
// @version      4.1
// @run-at       document-end
// @description  Highlights low success OC participants, stalled OCs, and missing items (with item name label)
// @author       Xoke
// @match        https://www.torn.com/factions.php*
// @homepageURL  https://github.com/Xoke/torn
// @updateURL    https://raw.githubusercontent.com/Xoke/torn/main/TornOCSuccessHighlighter.meta.js
// @downloadURL  https://raw.githubusercontent.com/Xoke/torn/main/TornOCSuccessHighlighter.user.js
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==
```

- [ ] **Step 4: Commit**

```bash
git add TornOCSuccessHighlighter.config.json TornOCSuccessHighlighter.meta.js TornOCSuccessHighlighter.user.js
git commit -m "feat: OC position thresholds - config file + header grants v4.1"
```

---

## Task 2: Add remote config state and loadRemoteConfig()

**Files:**
- Modify: `TornOCSuccessHighlighter.user.js`

This task adds the data layer. `remoteConfig` holds the parsed JSON. `loadRemoteConfig()` checks TTL, fetches if stale, caches result. Nothing calls it yet — that's wired in Task 6.

- [ ] **Step 1: Add remote config constants and state**

In `TornOCSuccessHighlighter.user.js`, after the `thresholds` variable declaration (after line ~28 where `let thresholds = ...`), add:

```js
    const REMOTE_CONFIG_KEY = 'oc_remote_config';
    const REMOTE_CONFIG_TS_KEY = 'oc_remote_config_ts';
    const REMOTE_CONFIG_URL_KEY = 'oc_config_url';
    const REMOTE_CONFIG_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

    let remoteConfig = {};
```

- [ ] **Step 2: Add loadRemoteConfig() function**

After `saveThresholds()` (around line ~43), add:

```js
    function loadCachedRemoteConfig() {
        const cached = GM_getValue(REMOTE_CONFIG_KEY, null);
        if (!cached) return;
        try { remoteConfig = JSON.parse(cached); } catch (e) {}
    }

    function loadRemoteConfig(forceRefresh) {
        const configUrl = GM_getValue(REMOTE_CONFIG_URL_KEY, '');
        if (!configUrl) return;

        if (!forceRefresh) {
            const ts = GM_getValue(REMOTE_CONFIG_TS_KEY, 0);
            if (Date.now() - ts < REMOTE_CONFIG_TTL_MS) {
                loadCachedRemoteConfig();
                updateRemoteConfigStatus();
                return;
            }
        }

        GM_xmlhttpRequest({
            method: 'GET',
            url: configUrl,
            onload: function(response) {
                try {
                    const parsed = JSON.parse(response.responseText);
                    remoteConfig = parsed;
                    GM_setValue(REMOTE_CONFIG_KEY, response.responseText);
                    GM_setValue(REMOTE_CONFIG_TS_KEY, Date.now());
                    GM_setValue('oc_remote_config_status', 'ok');
                } catch (e) {
                    GM_setValue('oc_remote_config_status', 'error');
                    loadCachedRemoteConfig();
                }
                updateRemoteConfigStatus();
                runAllChecks();
            },
            onerror: function() {
                GM_setValue('oc_remote_config_status', 'error');
                loadCachedRemoteConfig();
                updateRemoteConfigStatus();
            }
        });
    }

    function updateRemoteConfigStatus() {
        const el = document.getElementById('oc-remote-config-status');
        if (!el) return;
        const configUrl = GM_getValue(REMOTE_CONFIG_URL_KEY, '');
        if (!configUrl) {
            el.textContent = 'Not set';
            return;
        }
        const status = GM_getValue('oc_remote_config_status', '');
        const ts = GM_getValue(REMOTE_CONFIG_TS_KEY, 0);
        if (status === 'error') {
            el.textContent = 'Failed' + (ts ? ' (using cache from ' + new Date(ts).toLocaleString() + ')' : '');
        } else if (ts) {
            el.textContent = 'Last loaded: ' + new Date(ts).toLocaleString();
        } else {
            el.textContent = 'Not yet loaded';
        }
    }
```

- [ ] **Step 3: Call loadCachedRemoteConfig() at startup**

Near the bottom of the top-level scope, after `loadThresholds();` (around line ~45), add:

```js
    loadCachedRemoteConfig();
```

- [ ] **Step 4: Verify in browser console (manual)**

Open Torn factions page with the script installed. In DevTools console run:
```js
console.log(typeof GM_xmlhttpRequest); // should be 'function'
console.log(window.remoteConfig);      // undefined (it's in IIFE scope, that's fine)
```
No errors in console on page load = good.

- [ ] **Step 5: Commit**

```bash
git add TornOCSuccessHighlighter.user.js
git commit -m "feat: OC position thresholds - remote config load/cache layer"
```

---

## Task 3: Add getCrimeName() and getPositionName() helpers

**Files:**
- Modify: `TornOCSuccessHighlighter.user.js`

**DOM note:** Torn uses obfuscated class suffixes. The selectors below are the most likely candidates based on existing patterns in the script. If either returns `null` on the live page, open DevTools, inspect a crime card, and find the element containing the crime name text — update the selector accordingly. The same applies to position name within the slot header.

- [ ] **Step 1: Add getCrimeName() after getCrimeLevel()**

In `TornOCSuccessHighlighter.user.js`, after `getCrimeLevel()` (around line ~80), add:

```js
    // Get the crime name from a crime card element
    function getCrimeName(crimeCard) {
        if (!crimeCard) return null;
        // Try common class patterns for the crime title
        const nameEl = crimeCard.querySelector('[class*="title___"]') ||
                       crimeCard.querySelector('[class*="name___"]') ||
                       crimeCard.querySelector('[class*="crimeName___"]');
        if (!nameEl) return null;
        return nameEl.textContent.trim() || null;
    }
```

- [ ] **Step 2: Add getPositionName() after getCrimeName()**

```js
    // Get the position/role name from a slot element, normalized to match config format
    // DOM shows "Looter #1", config uses "Looter 1" — strip the #
    function getPositionName(slotElement) {
        // Try specific role name class first, then fall back to first text in slot header
        const nameEl = slotElement.querySelector('[class*="roleName___"]') ||
                       slotElement.querySelector('[class*="positionName___"]') ||
                       slotElement.querySelector('[class*="slotName___"]');
        let name = null;
        if (nameEl) {
            name = nameEl.textContent.trim();
        } else {
            // Fallback: first text node inside slotHeader
            const header = slotElement.querySelector('[class*="slotHeader___"]');
            if (header) {
                const walker = document.createTreeWalker(header, NodeFilter.SHOW_TEXT);
                const node = walker.nextNode();
                name = node ? node.textContent.trim() : null;
            }
        }
        if (!name) return null;
        return name.replace(/#/g, '').replace(/\s+/g, ' ').trim();
    }
```

- [ ] **Step 3: Verify selectors on live page (manual)**

Open Torn factions page. In DevTools console, find a crime card element and run:
```js
// Paste the data-oc-id value from a card in the DOM
const card = document.querySelector('[data-oc-id]');
const nameEl = card.querySelector('[class*="title___"]') || card.querySelector('[class*="name___"]') || card.querySelector('[class*="crimeName___"]');
console.log('Crime name:', nameEl?.textContent.trim());

const slot = card.querySelector('[class*="wrapper___"][class*="success"]');
const roleEl = slot?.querySelector('[class*="roleName___"]') || slot?.querySelector('[class*="positionName___"]') || slot?.querySelector('[class*="slotName___"]');
console.log('Role el:', roleEl?.textContent.trim());
```

Expected: crime name like "Gaslight the Way", role name like "Looter #1". If either is null, inspect the DOM manually and update the selector in the function. The pattern will always follow `[class*="something___"]`.

- [ ] **Step 4: Commit**

```bash
git add TornOCSuccessHighlighter.user.js
git commit -m "feat: OC position thresholds - getCrimeName and getPositionName helpers"
```

---

## Task 4: Add getThreshold() and wire into highlightSlotIssues()

**Files:**
- Modify: `TornOCSuccessHighlighter.user.js`

- [ ] **Step 1: Add getThreshold() after getPositionName()**

```js
    // Resolve the success threshold for a slot using the fallback chain:
    // 1. remoteConfig[crimeName][positionName]
    // 2. thresholds[level] (per-level fallback)
    function getThreshold(level, crimeCard, slotElement) {
        const crimeName = getCrimeName(crimeCard);
        const positionName = getPositionName(slotElement);
        if (crimeName && positionName && remoteConfig[crimeName]) {
            const posThreshold = remoteConfig[crimeName][positionName];
            if (typeof posThreshold === 'number') return posThreshold;
        }
        return thresholds[level] ?? 0;
    }
```

- [ ] **Step 2: Replace thresholds[level] in highlightSlotIssues()**

In `highlightSlotIssues()`, find this block (around line ~493):

```js
            // Highlight if below per-level threshold (threshold of 0 means never highlight)
            if (thresholds[level] > 0 && successRate < thresholds[level]) {
```

Replace it with:

```js
            // Highlight if below threshold (0 means never highlight)
            const threshold = getThreshold(level, getOCCard(slot), slot);
            if (threshold > 0 && successRate < threshold) {
```

Also update the else clause on the next few lines — find:
```js
            } else {
                if (currentTag === 'lowSuccess') clearHighlight(slot);
            }
```
This doesn't need changing — it still works.

- [ ] **Step 3: Verify threshold resolution on live page (manual)**

With `const DEBUG = true` temporarily, reload Torn factions. Console should log "Low success slot:" entries as before. Then set a URL and load a config with one crime/position entry — confirm that slot's threshold changes accordingly. Set `DEBUG` back to `false` when done.

- [ ] **Step 4: Commit**

```bash
git add TornOCSuccessHighlighter.user.js
git commit -m "feat: OC position thresholds - getThreshold with fallback chain"
```

---

## Task 5: Update settings modal UI

**Files:**
- Modify: `TornOCSuccessHighlighter.user.js`

This task adds the URL input, Load Now button, and status line to the existing modal.

- [ ] **Step 1: Add CSS for the new URL section**

In `injectThresholdStyles()`, inside the `style.textContent = \`...\`` template literal, add before the closing backtick:

```css
            #oc-remote-config-section {
                margin-bottom: 12px;
                padding-bottom: 10px;
                border-bottom: 1px solid #334;
            }
            #oc-remote-config-section h4 {
                color: #aac;
                font-size: 11px;
                margin: 0 0 6px 0;
                font-weight: normal;
                letter-spacing: 0.3px;
            }
            #oc-remote-config-row {
                display: flex;
                gap: 5px;
                align-items: center;
                margin-bottom: 4px;
            }
            #oc-config-url-input {
                flex: 1;
                background: #1a1a2e;
                color: #eee;
                border: 1px solid #445;
                border-radius: 3px;
                font-size: 10px;
                padding: 3px 5px;
                font-family: monospace;
            }
            #oc-config-load-now {
                background: #2a2a3e;
                color: #aac;
                border: 1px solid #445;
                border-radius: 3px;
                padding: 3px 8px;
                font-size: 10px;
                cursor: pointer;
                font-family: sans-serif;
                white-space: nowrap;
            }
            #oc-config-load-now:hover { background: #333355; }
            #oc-remote-config-status {
                font-size: 10px;
                color: #666;
                font-family: sans-serif;
            }
```

- [ ] **Step 2: Inject the URL section into the modal HTML**

In `injectSettingsUI()`, find the `modal.innerHTML = ...` assignment. Add the remote config section before the level grid. Change:

```js
        modal.innerHTML = `<div id="oc-threshold-panel">
            <h3>&#9881; OC Success Thresholds</h3>
            <div class="oc-threshold-grid">${gridHTML}</div>
```

To:

```js
        const savedUrl = GM_getValue(REMOTE_CONFIG_URL_KEY, '');
        modal.innerHTML = `<div id="oc-threshold-panel">
            <h3>&#9881; OC Success Thresholds</h3>
            <div id="oc-remote-config-section">
                <h4>Remote Config URL</h4>
                <div id="oc-remote-config-row">
                    <input id="oc-config-url-input" type="text" placeholder="https://raw.githubusercontent.com/..." value="${savedUrl.replace(/"/g, '&quot;')}">
                    <button id="oc-config-load-now">Load Now</button>
                </div>
                <div id="oc-remote-config-status"></div>
            </div>
            <div class="oc-threshold-grid">${gridHTML}</div>
```

- [ ] **Step 3: Wire Load Now button and update Save to include URL**

In `injectSettingsUI()`, after the existing save/cancel/backdrop listeners, add:

```js
        document.getElementById('oc-config-load-now').addEventListener('click', () => {
            const urlInput = document.getElementById('oc-config-url-input');
            const url = urlInput.value.trim();
            GM_setValue(REMOTE_CONFIG_URL_KEY, url);
            const statusEl = document.getElementById('oc-remote-config-status');
            if (statusEl) statusEl.textContent = 'Loading...';
            loadRemoteConfig(true);
        });
```

In the existing save listener, before `modal.classList.remove('open')`, add:

```js
            const urlInput = document.getElementById('oc-config-url-input');
            if (urlInput) GM_setValue(REMOTE_CONFIG_URL_KEY, urlInput.value.trim());
```

- [ ] **Step 4: Populate status when modal opens**

In the button click handler inside `injectSettingsButton()` (the `btn.addEventListener('click', ...)` block), after the loop that sets input values, add:

```js
            updateRemoteConfigStatus();
```

- [ ] **Step 5: Verify UI on live page (manual)**

Open the OC Thresholds modal. Confirm:
- URL section appears above the level grid with a text input and Load Now button
- Status line reads "Not set" when no URL is configured
- Entering a URL and clicking Load Now shows "Loading..." then "Last loaded: [timestamp]" or "Failed"
- Clicking Save stores the URL (reopen modal to confirm value persists)

- [ ] **Step 6: Commit**

```bash
git add TornOCSuccessHighlighter.user.js
git commit -m "feat: OC position thresholds - settings modal URL input and Load Now button"
```

---

## Task 6: Wire loadRemoteConfig() into initialize() and final cleanup

**Files:**
- Modify: `TornOCSuccessHighlighter.user.js`

- [ ] **Step 1: Call loadRemoteConfig() in initialize()**

In `initialize()`, after `injectSettingsUI()` and before `runAllChecks()`, add:

```js
        loadRemoteConfig(false);
```

So the block reads:
```js
        debugLog('Initialized');
        injectSettingsUI();
        loadRemoteConfig(false);
        runAllChecks();
```

- [ ] **Step 2: Verify end-to-end on live page (manual)**

1. Push the script and a test config JSON to the repo (or use a local file URL for testing)
2. Set the config URL in the modal
3. Click Load Now — confirm status updates and `remoteConfig` is populated
4. Reload the page — confirm the cache is used (no new fetch within 24h), status shows last timestamp
5. Confirm slots with a crime/position in the config are highlighted according to that threshold, not the per-level one
6. Confirm slots NOT in the config still use per-level thresholds

- [ ] **Step 3: Final commit**

```bash
git add TornOCSuccessHighlighter.user.js
git commit -m "feat: OC position thresholds - wire loadRemoteConfig into init, v4.1 complete"
```

---

## Self-Review Notes

- **Spec: `@connect *`** — covered in Task 1 (both files)
- **Spec: 24h TTL** — `REMOTE_CONFIG_TTL_MS = 24 * 60 * 60 * 1000` in Task 2
- **Spec: fallback chain** — `getThreshold()` in Task 4 covers remote → per-level
- **Spec: Load Now ignores TTL** — `loadRemoteConfig(true)` in Task 5 step 3
- **Spec: status line** — `updateRemoteConfigStatus()` in Task 2, called from modal open + after fetch
- **Spec: config file** — `TornOCSuccessHighlighter.config.json` created in Task 1
- **DOM selector uncertainty** — Task 3 Step 3 includes explicit manual verification with console commands
- **`#` stripping** — handled in `getPositionName()` via `.replace(/#/g, '')`
- **Version bump** — both files updated to 4.1 in Task 1
