# OC Success Thresholds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-level configurable success thresholds (levels 1–10) to TornOCSuccessHighlighter, with a modal settings panel injected above the crime card list.

**Architecture:** All changes are in `TornOCSuccessHighlighter.user.js` (single-file script). The `thresholds` object replaces the `SUCCESS_THRESHOLD` constant. A settings button injected above the first crime card opens a modal that reads/writes `GM_setValue`. Grants are updated in both `.user.js` and `.meta.js`.

**Tech Stack:** Vanilla JS userscript, Tampermonkey `GM_setValue`/`GM_getValue`, no build system.

---

### Task 1: Update headers — grants and version

**Files:**
- Modify: `TornOCSuccessHighlighter.meta.js` (lines 1–13)
- Modify: `TornOCSuccessHighlighter.user.js` (lines 1–13)

No automated tests for this project. Verify manually: after saving, load the script in Tampermonkey — it should not throw "GM_setValue is not defined".

- [ ] **Step 1: Update meta.js header**

Replace the entire header block in `TornOCSuccessHighlighter.meta.js`:

```js
// ==UserScript==
// @name         Torn OC Success Highlighter
// @namespace    https://xoke.org/
// @version      4.0
// @run-at       document-end
// @description  Highlights low success OC participants, stalled OCs, and missing items (with item name label)
// @author       Xoke
// @match        https://www.torn.com/factions.php*
// @homepageURL  https://github.com/Xoke/torn
// @updateURL    https://raw.githubusercontent.com/Xoke/torn/main/TornOCSuccessHighlighter.meta.js
// @downloadURL  https://raw.githubusercontent.com/Xoke/torn/main/TornOCSuccessHighlighter.user.js
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==
```

- [ ] **Step 2: Update user.js header**

Replace the entire header block in `TornOCSuccessHighlighter.user.js` (lines 1–13):

```js
// ==UserScript==
// @name         Torn OC Success Highlighter
// @namespace    https://xoke.org/
// @version      4.0
// @run-at       document-end
// @description  Highlights low success OC participants, stalled OCs, and missing items (with item name label)
// @author       Xoke
// @match        https://www.torn.com/factions.php*
// @homepageURL  https://github.com/Xoke/torn
// @updateURL    https://raw.githubusercontent.com/Xoke/torn/main/TornOCSuccessHighlighter.meta.js
// @downloadURL  https://raw.githubusercontent.com/Xoke/torn/main/TornOCSuccessHighlighter.user.js
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==
```

- [ ] **Step 3: Commit**

```bash
git add TornOCSuccessHighlighter.meta.js TornOCSuccessHighlighter.user.js
git commit -m "TornOCSuccessHighlighter v4.0 - update grants for GM_setValue/GM_getValue"
```

---

### Task 2: Replace SUCCESS_THRESHOLD with per-level thresholds

**Files:**
- Modify: `TornOCSuccessHighlighter.user.js`

- [ ] **Step 1: Replace constants block**

In `TornOCSuccessHighlighter.user.js`, replace lines 24–26:

```js
    const SUCCESS_THRESHOLD = 70;
    const MIN_LEVEL = 2;
    const MAX_LEVEL = 6;
```

with:

```js
    const MIN_LEVEL = 1;
    const MAX_LEVEL = 10;
    const DEFAULT_THRESHOLDS = { 1: 0, 2: 70, 3: 70, 4: 70, 5: 70, 6: 70, 7: 60, 8: 60, 9: 60, 10: 60 };
    let thresholds = Object.assign({}, DEFAULT_THRESHOLDS);

    function loadThresholds() {
        const saved = GM_getValue('oc_thresholds', null);
        if (!saved) return;
        try {
            const parsed = JSON.parse(saved);
            for (let lvl = MIN_LEVEL; lvl <= MAX_LEVEL; lvl++) {
                if (typeof parsed[lvl] === 'number') thresholds[lvl] = parsed[lvl];
            }
        } catch (e) {}
    }

    function saveThresholds() {
        GM_setValue('oc_thresholds', JSON.stringify(thresholds));
    }

    loadThresholds();
```

- [ ] **Step 2: Update highlightSlotIssues() — fix range check comment and threshold lookup**

In `highlightSlotIssues()`, replace:

```js
            // Low success rate check only for level 2-6
            if (level < MIN_LEVEL || level > MAX_LEVEL) {
```

with:

```js
            // Low success rate check only for levels within range
            if (level < MIN_LEVEL || level > MAX_LEVEL) {
```

Then replace:

```js
            // Highlight if below threshold
            if (successRate < SUCCESS_THRESHOLD) {
                if (currentTag !== 'lowSuccess') {
                    applyHighlight(slot, HIGHLIGHT_OUTLINE, HIGHLIGHT_BOX_SHADOW, 'lowSuccess');
                    debugLog('Low success slot: Level', level, 'Success', successRate + '%');
                }
            } else {
                if (currentTag === 'lowSuccess') clearHighlight(slot);
            }
```

with:

```js
            // Highlight if below per-level threshold (threshold of 0 means never highlight)
            if (thresholds[level] > 0 && successRate < thresholds[level]) {
                if (currentTag !== 'lowSuccess') {
                    applyHighlight(slot, HIGHLIGHT_OUTLINE, HIGHLIGHT_BOX_SHADOW, 'lowSuccess');
                    debugLog('Low success slot: Level', level, 'Success', successRate + '%');
                }
            } else {
                if (currentTag === 'lowSuccess') clearHighlight(slot);
            }
```

- [ ] **Step 3: Commit**

```bash
git add TornOCSuccessHighlighter.user.js
git commit -m "TornOCSuccessHighlighter v4.0 - per-level thresholds replace SUCCESS_THRESHOLD"
```

---

### Task 3: Inject styles for settings UI

**Files:**
- Modify: `TornOCSuccessHighlighter.user.js`

- [ ] **Step 1: Add injectThresholdStyles IIFE**

After the existing `injectLabelStyles` IIFE (after line 133, before the `getItemName` function), add:

```js
    // Inject threshold settings UI styles once
    (function injectThresholdStyles() {
        const STYLE_ID = 'oc-threshold-styles';
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            #oc-threshold-btn-wrap {
                display: flex;
                justify-content: flex-end;
                margin-bottom: 6px;
            }
            #oc-threshold-btn-wrap button {
                background: #2a2a3e;
                border: 1px solid #445;
                border-radius: 4px;
                color: #aac;
                font-size: 11px;
                padding: 4px 10px;
                cursor: pointer;
                font-family: sans-serif;
            }
            #oc-threshold-btn-wrap button:hover {
                background: #333355;
            }
            #oc-threshold-modal {
                display: none;
                position: fixed;
                inset: 0;
                background: rgba(0,0,0,0.6);
                z-index: 99999;
                align-items: center;
                justify-content: center;
            }
            #oc-threshold-modal.open {
                display: flex;
            }
            #oc-threshold-panel {
                background: #222;
                border: 1px solid #445;
                border-radius: 8px;
                padding: 14px 16px;
                box-shadow: 0 6px 24px rgba(0,0,0,0.7);
                font-family: sans-serif;
            }
            #oc-threshold-panel h3 {
                color: #ccc;
                font-size: 12px;
                margin: 0 0 10px 0;
            }
            .oc-threshold-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 6px 14px;
                margin-bottom: 12px;
            }
            .oc-threshold-row {
                display: flex;
                align-items: center;
                gap: 5px;
                font-size: 11px;
                color: #aaa;
            }
            .oc-threshold-row label {
                min-width: 44px;
            }
            .oc-threshold-row input {
                width: 32px;
                background: #1a1a2e;
                color: #eee;
                border: 1px solid #445;
                border-radius: 3px;
                text-align: center;
                font-size: 11px;
                padding: 2px 0;
            }
            .oc-threshold-row input::-webkit-inner-spin-button,
            .oc-threshold-row input::-webkit-outer-spin-button { display: none; }
            .oc-threshold-row span { color: #555; }
            #oc-threshold-footer {
                display: flex;
                gap: 6px;
                justify-content: flex-end;
            }
            #oc-threshold-save {
                background: #2d2d5e;
                color: #aac;
                border: 1px solid #446;
                border-radius: 3px;
                padding: 3px 12px;
                font-size: 11px;
                cursor: pointer;
                font-family: sans-serif;
            }
            #oc-threshold-cancel {
                background: #2a2a2a;
                color: #888;
                border: 1px solid #444;
                border-radius: 3px;
                padding: 3px 12px;
                font-size: 11px;
                cursor: pointer;
                font-family: sans-serif;
            }
        `;
        document.head.appendChild(style);
    })();
```

- [ ] **Step 2: Commit**

```bash
git add TornOCSuccessHighlighter.user.js
git commit -m "TornOCSuccessHighlighter v4.0 - inject threshold settings styles"
```

---

### Task 4: Add settings button and modal, wire into runAllChecks

**Files:**
- Modify: `TornOCSuccessHighlighter.user.js`

- [ ] **Step 1: Add injectSettingsUI function**

After the `injectThresholdStyles` IIFE (before `getItemName`), add:

```js
    // Create the modal once and append to document.body
    function injectSettingsUI() {
        if (document.getElementById('oc-threshold-modal')) return;

        let gridHTML = '';
        for (let lvl = MIN_LEVEL; lvl <= MAX_LEVEL; lvl++) {
            gridHTML += `<div class="oc-threshold-row">
                <label>Level ${lvl}</label>
                <input id="oc-lvl-${lvl}" type="number" min="0" max="100" value="${thresholds[lvl]}">
                <span>%</span>
            </div>`;
        }

        const modal = document.createElement('div');
        modal.id = 'oc-threshold-modal';
        modal.innerHTML = `<div id="oc-threshold-panel">
            <h3>&#9881; OC Success Thresholds</h3>
            <div class="oc-threshold-grid">${gridHTML}</div>
            <div id="oc-threshold-footer">
                <button id="oc-threshold-save">Save</button>
                <button id="oc-threshold-cancel">Cancel</button>
            </div>
        </div>`;
        document.body.appendChild(modal);

        document.getElementById('oc-threshold-save').addEventListener('click', () => {
            for (let lvl = MIN_LEVEL; lvl <= MAX_LEVEL; lvl++) {
                const input = document.getElementById(`oc-lvl-${lvl}`);
                const val = parseInt(input.value, 10);
                if (!isNaN(val) && val >= 0 && val <= 100) thresholds[lvl] = val;
            }
            saveThresholds();
            modal.classList.remove('open');
            runAllChecks();
        });

        document.getElementById('oc-threshold-cancel').addEventListener('click', () => {
            modal.classList.remove('open');
        });

        modal.addEventListener('mousedown', e => {
            if (e.target === modal) modal.classList.remove('open');
        });
    }

    // Inject the settings button above the first crime card (re-checked each runAllChecks)
    function injectSettingsButton() {
        if (document.getElementById('oc-threshold-btn-wrap')) return;
        const root = document.querySelector('#faction-crimes, .faction-crimes-wrap, #faction-crimes-root');
        if (!root) return;
        const firstCard = root.querySelector('[data-oc-id]');
        if (!firstCard) return;

        const wrap = document.createElement('div');
        wrap.id = 'oc-threshold-btn-wrap';
        const btn = document.createElement('button');
        btn.textContent = '\u2699 OC Thresholds';
        btn.addEventListener('click', () => {
            for (let lvl = MIN_LEVEL; lvl <= MAX_LEVEL; lvl++) {
                const input = document.getElementById(`oc-lvl-${lvl}`);
                if (input) input.value = thresholds[lvl];
            }
            document.getElementById('oc-threshold-modal').classList.add('open');
        });
        wrap.appendChild(btn);
        firstCard.parentElement.insertBefore(wrap, firstCard);
    }
```

- [ ] **Step 2: Wire injectSettingsUI into initialize and injectSettingsButton into runAllChecks**

In `initialize()`, after `debugLog('Initialized');` and before `runAllChecks();`, add:

```js
        injectSettingsUI();
```

In `runAllChecks()`, add `injectSettingsButton();` as the first line:

```js
    function runAllChecks() {
        injectSettingsButton();
        highlightStalledOCs();
        highlightStalledOC2Rows();
        highlightSlotIssues();
        highlightUnavailableMembers();
        labelMissingItems(); // async — runs in background, won't block other checks
    }
```

- [ ] **Step 3: Verify manually**

Load the script on `https://www.torn.com/factions.php?step=your` (OC tab). Confirm:
- A `⚙ OC Thresholds` button appears above the first crime card, right-aligned
- Clicking it opens the modal with a 2×5 grid of levels 1–10
- Level 1 defaults to 0, levels 2–6 to 70, levels 7–10 to 60
- Changing a value and clicking Save persists it (reload page and reopen modal to confirm)
- Clicking Cancel or clicking the overlay backdrop closes without saving
- OC slots for levels 7–10 now highlight red when below 60% (previously ignored)
- Level 1 OC slots are never highlighted regardless of success rate

- [ ] **Step 4: Commit**

```bash
git add TornOCSuccessHighlighter.user.js
git commit -m "TornOCSuccessHighlighter v4.0 - settings button and modal for per-level thresholds"
```

- [ ] **Step 5: Push**

```bash
git push
```
