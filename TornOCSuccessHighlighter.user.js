// ==UserScript==
// @name         Torn OC Success Highlighter
// @namespace    https://xoke.org/
// @version      4.7
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
// The remote config URL is user-configurable and may point to any https:// domain
// @connect      *
// ==/UserScript==

(function() {
    'use strict';

    const DEBUG = false;

    function debugLog(...args) {
        if (DEBUG) console.log('[OC Highlighter]', ...args);
    }

    const MIN_LEVEL = 1;
    const MAX_LEVEL = 10;
    const DEFAULT_THRESHOLDS = { 1: 0, 2: 70, 3: 70, 4: 70, 5: 70, 6: 70, 7: 60, 8: 60, 9: 60, 10: 60 };
    let thresholds = Object.assign({}, DEFAULT_THRESHOLDS);

    const REMOTE_CONFIG_KEY = 'oc_remote_config';
    const REMOTE_CONFIG_TS_KEY = 'oc_remote_config_ts';
    const REMOTE_CONFIG_URL_KEY = 'oc_config_url';
    const REMOTE_CONFIG_STATUS_KEY = 'oc_remote_config_status';
    const REMOTE_CONFIG_USE_KEY = 'oc_use_remote_config';
    const REMOTE_CONFIG_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

    let remoteConfig = {};

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
        syncSharedConfig();
    }

    function loadCachedRemoteConfig() {
        const cached = GM_getValue(REMOTE_CONFIG_KEY, null);
        if (!cached) return;
        try { remoteConfig = JSON.parse(cached); } catch (e) {}
    }

    // GM_* storage is namespaced per script, so TornOCRecommender can't read our
    // GM values. Mirror the effective config to localStorage (shared across all
    // scripts on torn.com) whenever it changes.
    function syncSharedConfig() {
        try {
            localStorage.setItem('oc_thresholds', JSON.stringify(thresholds));
            localStorage.setItem('oc_remote_config', JSON.stringify(remoteConfig));
            localStorage.setItem('oc_use_remote_config', JSON.stringify(GM_getValue(REMOTE_CONFIG_USE_KEY, true) === true));
        } catch (e) {}
    }

    // Only fetch over HTTPS. The config URL is user-supplied and this script
    // declares @connect * to allow it, so reject anything that isn't a plain
    // https:// URL before handing it to GM_xmlhttpRequest.
    function isValidConfigUrl(url) {
        try {
            return new URL(url).protocol === 'https:';
        } catch (e) {
            return false;
        }
    }

    function loadRemoteConfig(forceRefresh) {
        const configUrl = GM_getValue(REMOTE_CONFIG_URL_KEY, '');
        if (!configUrl) return;
        if (!isValidConfigUrl(configUrl)) {
            GM_setValue(REMOTE_CONFIG_STATUS_KEY, 'error');
            loadCachedRemoteConfig();
            updateRemoteConfigStatus();
            return;
        }

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
                    // Must be a plain object map of crimeName -> { position: number }
                    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                        throw new Error('Config is not an object');
                    }
                    remoteConfig = parsed;
                    GM_setValue(REMOTE_CONFIG_KEY, response.responseText);
                    GM_setValue(REMOTE_CONFIG_TS_KEY, Date.now());
                    GM_setValue(REMOTE_CONFIG_STATUS_KEY, 'ok');
                    syncSharedConfig();
                } catch (e) {
                    GM_setValue(REMOTE_CONFIG_STATUS_KEY, 'error');
                    loadCachedRemoteConfig();
                }
                updateRemoteConfigStatus();
                runAllChecks();
            },
            onerror: function() {
                GM_setValue(REMOTE_CONFIG_STATUS_KEY, 'error');
                loadCachedRemoteConfig();
                updateRemoteConfigStatus();
                runAllChecks();
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
        const status = GM_getValue(REMOTE_CONFIG_STATUS_KEY, '');
        const ts = GM_getValue(REMOTE_CONFIG_TS_KEY, 0);
        if (status === 'error') {
            el.textContent = 'Failed' + (ts ? ' (using cache from ' + new Date(ts).toLocaleString() + ')' : '');
        } else if (ts) {
            el.textContent = 'Last loaded: ' + new Date(ts).toLocaleString();
        } else {
            el.textContent = 'Not yet loaded';
        }
    }

    loadThresholds();
    loadCachedRemoteConfig();
    syncSharedConfig();

    // Low success rate styling (red)
    const HIGHLIGHT_OUTLINE = '2px solid #ffff00';
    const HIGHLIGHT_BOX_SHADOW = '0 0 10px 3px rgba(255, 0, 0, 0.8)';

    // Stalled/paused OC styling (orange)
    const STALLED_OUTLINE = '2px solid #ffcc00';
    const STALLED_BOX_SHADOW = '0 0 10px 3px rgba(255, 136, 0, 0.8)';

    // Missing item styling (purple)
    const MISSING_ITEM_OUTLINE = '2px solid #dd66ff';
    const MISSING_ITEM_BOX_SHADOW = '0 0 10px 3px rgba(170, 0, 255, 0.8)';

    // OC2 style application (reapplied every cycle via setProperty)

    // Traverse up from el to find the OC crime card (data-oc-id ancestor)
    function getOCCard(el) {
        let parent = el.parentElement;
        while (parent && !parent.hasAttribute('data-oc-id')) {
            parent = parent.parentElement;
            if (!parent || parent === document.body) return null;
        }
        return parent;
    }

    // Find the crime level for a slot element by traversing up to find the crime card
    function getCrimeLevel(slotElement) {
        const card = getOCCard(slotElement);
        if (!card) return null;
        // Class pattern: levelValue___XXXXX
        const levelEl = card.querySelector('[class*="levelValue___"]');
        if (!levelEl) return null;
        const level = parseInt(levelEl.textContent.trim(), 10);
        return isNaN(level) ? null : level;
    }

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

    // Resolve the success threshold for a slot using the fallback chain:
    // 1. remoteConfig[crimeName][positionName]
    // 2. thresholds[level] (per-level fallback)
    function getThreshold(level, crimeCard, slotElement) {
        const crimeName = getCrimeName(crimeCard);
        const positionName = getPositionName(slotElement);
        if (GM_getValue(REMOTE_CONFIG_USE_KEY, true) && crimeName && positionName && remoteConfig[crimeName]) {
            const posThreshold = remoteConfig[crimeName][positionName];
            if (typeof posThreshold === 'number') return posThreshold;
        }
        return thresholds[level] ?? 0;
    }

    // Check if a slot has a player assigned (not empty/waiting)
    function hasPlayer(slotElement) {
        // If it has validSlot class, it has a player
        const slotBody = slotElement.querySelector('[class*="slotBody___"]');
        if (!slotBody) return false;

        // Check for validSlot class (indicates filled slot)
        if ((slotBody.getAttribute('class') || '').includes('validSlot')) return true;

        // Check for badge container (player badge)
        if (slotBody.querySelector('[class*="badgeContainer___"]')) return true;

        return false;
    }

    // Get success rate from slot
    function getSuccessRate(slotElement) {
        // Class pattern: successChance___XXXXX
        const successEl = slotElement.querySelector('[class*="successChance___"]');
        if (!successEl) return null;

        const rate = parseInt(successEl.textContent.trim(), 10);
        return isNaN(rate) ? null : rate;
    }

    // Check if a crime card is paused/stalled
    function isCrimePaused(crimeCard) {
        if (!crimeCard) return false;
        if (crimeCard.querySelector('[class*="paused___"]')) return true;
        if (crimeCard.querySelector('[aria-label="paused"]')) return true;
        return false;
    }

    // Check if a slot has a missing item (red no-entry SVG inside a div wrapper within slotIcon___)
    // Flying status uses the same fill color but its SVG sits directly in slotIcon___ with no wrapper div
    function hasMissingItem(slotElement) {
        return !!slotElement.querySelector('[class*="slotIcon___"] div path[fill="#ff794c"]');
    }

    // Get the slotHeader button within a slot wrapper
    function getSlotHeader(slotElement) {
        return slotElement.querySelector('[class*="slotHeader___"]');
    }

    // Inject label styles once
    (function injectLabelStyles() {
        const LABEL_STYLE_ID = 'oc-missing-item-label-styles';
        if (document.getElementById(LABEL_STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = LABEL_STYLE_ID;
        style.textContent = `
            .oc-missing-label {
                position: absolute;
                top: -22px;
                left: 50%;
                transform: translateX(-50%);
                background: #aa00ff;
                color: #fff;
                font-size: 10px;
                font-weight: bold;
                padding: 2px 7px;
                border-radius: 4px;
                white-space: nowrap;
                pointer-events: none;
                z-index: 9999;
                font-family: sans-serif;
                letter-spacing: 0.3px;
                box-shadow: 0 1px 4px rgba(0,0,0,0.4);
            }
        `;
        document.head.appendChild(style);
    })();

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
            #oc-use-remote-row {
                display: flex;
                align-items: center;
                gap: 6px;
                margin-top: 6px;
                font-size: 11px;
                color: #aaa;
                font-family: sans-serif;
            }
            #oc-use-remote-row input[type="checkbox"] {
                accent-color: #667;
                cursor: pointer;
            }
        `;
        document.head.appendChild(style);
    })();

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
            <div id="oc-remote-config-section">
                <h4>Remote Config URL</h4>
                <div id="oc-remote-config-row">
                    <input id="oc-config-url-input" type="text" placeholder="https://raw.githubusercontent.com/...">
                    <button id="oc-config-load-now">Load Now</button>
                </div>
                <div id="oc-use-remote-row">
                    <input type="checkbox" id="oc-use-remote-cb" checked>
                    <label for="oc-use-remote-cb">Use remote config thresholds</label>
                </div>
                <div id="oc-remote-config-status"></div>
            </div>
            <div class="oc-threshold-grid">${gridHTML}</div>
            <div id="oc-threshold-footer">
                <button id="oc-threshold-save">Save</button>
                <button id="oc-threshold-cancel">Cancel</button>
            </div>
        </div>`;
        document.body.appendChild(modal);
        // Set URL via DOM after rendering to avoid HTML injection
        const urlInputEl = modal.querySelector('#oc-config-url-input');
        if (urlInputEl) urlInputEl.value = GM_getValue(REMOTE_CONFIG_URL_KEY, '');

        document.getElementById('oc-threshold-save').addEventListener('click', () => {
            for (let lvl = MIN_LEVEL; lvl <= MAX_LEVEL; lvl++) {
                const input = document.getElementById(`oc-lvl-${lvl}`);
                const val = parseInt(input.value, 10);
                if (!isNaN(val) && val >= 0 && val <= 100) thresholds[lvl] = val;
            }
            saveThresholds();
            const urlInput = document.getElementById('oc-config-url-input');
            if (urlInput) GM_setValue(REMOTE_CONFIG_URL_KEY, urlInput.value.trim());
            const cb = document.getElementById('oc-use-remote-cb');
            if (cb) GM_setValue(REMOTE_CONFIG_USE_KEY, cb.checked);
            syncSharedConfig();
            modal.classList.remove('open');
            runAllChecks();
        });

        document.getElementById('oc-threshold-cancel').addEventListener('click', () => {
            modal.classList.remove('open');
        });

        modal.addEventListener('mousedown', e => {
            if (e.target === modal) modal.classList.remove('open');
        });

        document.getElementById('oc-config-load-now').addEventListener('click', () => {
            const urlInput = document.getElementById('oc-config-url-input');
            const url = urlInput.value.trim();
            const statusEl = document.getElementById('oc-remote-config-status');
            if (url && !isValidConfigUrl(url)) {
                if (statusEl) statusEl.textContent = 'Invalid URL (must be https://)';
                return;
            }
            GM_setValue(REMOTE_CONFIG_URL_KEY, url);
            if (statusEl) statusEl.textContent = 'Loading...';
            loadRemoteConfig(true);
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
            updateRemoteConfigStatus();
            const cb = document.getElementById('oc-use-remote-cb');
            if (cb) cb.checked = GM_getValue(REMOTE_CONFIG_USE_KEY, true);
            document.getElementById('oc-threshold-modal').classList.add('open');
        });
        wrap.appendChild(btn);
        firstCard.parentElement.insertBefore(wrap, firstCard);
    }

    // Briefly trigger a slot's tooltip to read "Used item: X", then dismiss it.
    // Returns a Promise<string> with the item name, or '?' if not found.
    function getItemName(slotHeader) {
        return new Promise(resolve => {
            slotHeader.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true }));
            slotHeader.dispatchEvent(new MouseEvent('mouseover',  { bubbles: true, cancelable: true }));

            // Poll for the tooltip text rather than using a fixed delay
            const MAX_WAIT_MS = 1500;
            const POLL_INTERVAL_MS = 50;
            let elapsed = 0;

            const poll = setInterval(() => {
                elapsed += POLL_INTERVAL_MS;
                const tooltip = document.querySelector('[role="tooltip"]');
                if (tooltip) {
                    const match = tooltip.textContent.match(/(?:Used|Required) item:\s*(.+?)(?:\n|$)/);
                    if (match) {
                        clearInterval(poll);
                        slotHeader.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true, cancelable: true }));
                        slotHeader.dispatchEvent(new MouseEvent('mouseout',   { bubbles: true, cancelable: true }));
                        resolve(match[1].trim());
                        return;
                    }
                }
                if (elapsed >= MAX_WAIT_MS) {
                    clearInterval(poll);
                    slotHeader.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true, cancelable: true }));
                    slotHeader.dispatchEvent(new MouseEvent('mouseout',   { bubbles: true, cancelable: true }));
                    resolve('?');
                }
            }, POLL_INTERVAL_MS);
        });
    }

    // Add a missing item label above the slot header button
    function applyMissingLabel(slotHeader, itemName) {
        if (slotHeader.querySelector('.oc-missing-label')) return; // already labelled
        const label = document.createElement('div');
        label.className = 'oc-missing-label';
        label.textContent = `\u2298 ${itemName}`;
        slotHeader.style.position = 'relative';
        slotHeader.appendChild(label);
    }

    // Remove all missing item labels (called on full clear/re-run)
    function clearMissingLabels() {
        document.querySelectorAll('.oc-missing-label').forEach(el => el.remove());
    }

    // Async: find all missing-item slots, extract item name via tooltip, and label them
    let _labellingInProgress = false;
    async function labelMissingItems() {
        if (_labellingInProgress) return;
        _labellingInProgress = true;
        try {
            const root = document.querySelector('#faction-crimes, .faction-crimes-wrap, #faction-crimes-root');
            if (!root) return;

            const slots = root.querySelectorAll('[class*="wrapper___"][class*="success"]');
            for (const slot of slots) {
                if (!slot.querySelector('[class*="slotHeader___"]')) continue;
                if (!hasMissingItem(slot)) continue;

                const slotHeader = getSlotHeader(slot);
                if (!slotHeader || slotHeader.querySelector('.oc-missing-label')) continue;

                const itemName = await getItemName(slotHeader);
                applyMissingLabel(slotHeader, itemName);
                debugLog('Missing item labelled:', itemName);

                // Small gap to avoid tooltip collisions between slots
                await new Promise(r => setTimeout(r, 200));
            }
        } finally {
            _labellingInProgress = false;
        }
    }

    // Apply highlight styling to an element (uses outline-offset to draw outside overlay layers)
    function applyHighlight(element, outline, boxShadow, tag) {
        element.style.setProperty('outline', outline, 'important');
        element.style.setProperty('outline-offset', '2px', 'important');
        element.style.setProperty('box-shadow', boxShadow, 'important');
        element.style.setProperty('position', 'relative', 'important');
        element.style.setProperty('z-index', '5', 'important');
        element.dataset.ocHighlighted = tag;
    }

    // Clear highlight styling from an element
    function clearHighlight(element) {
        element.style.removeProperty('outline');
        element.style.removeProperty('outline-offset');
        element.style.removeProperty('box-shadow');
        element.style.removeProperty('position');
        element.style.removeProperty('z-index');
        element.dataset.ocHighlighted = '';
    }

    // Highlight stalled OC crime cards (native view)
    function highlightStalledOCs() {
        const root = document.querySelector('#faction-crimes, .faction-crimes-wrap, #faction-crimes-root');
        if (!root) return;
        const crimeCards = root.querySelectorAll('[data-oc-id]');

        crimeCards.forEach(card => {
            const paused = isCrimePaused(card);
            const currentTag = card.dataset.ocHighlighted;

            if (paused && currentTag !== 'stalled') {
                applyHighlight(card, STALLED_OUTLINE, STALLED_BOX_SHADOW, 'stalled');
                debugLog('Stalled OC:', card.getAttribute('data-oc-id'));
            } else if (!paused && currentTag === 'stalled') {
                clearHighlight(card);
            }
        });
    }

    // Highlight stalled OC rows in OC2 table view
    function highlightStalledOC2Rows() {
        const oc2Root = document.querySelector('.OC2-memberViewer');
        if (!oc2Root) return;
        const crimeRows = oc2Root.querySelectorAll('[class*="OC2-crimeLi"]');

        crimeRows.forEach(row => {
            const hasDelay = row.textContent.includes('Delay:') || row.textContent.includes('Delay ');

            if (hasDelay && (row.getAttribute('class') || '').includes('OC2-crimeID_')) {
                row.style.setProperty('background-color', 'rgba(255, 136, 0, 0.3)', 'important');
                row.style.setProperty('border-left', '4px solid #ff8800', 'important');
            }
        });
    }

    // Main function to highlight low success slots and missing items
    function highlightSlotIssues() {
        const root = document.querySelector('#faction-crimes, .faction-crimes-wrap, #faction-crimes-root');
        if (!root) return;
        // Find all slot wrappers - class pattern: wrapper___XXXXX with success color class
        const slots = root.querySelectorAll('[class*="wrapper___"][class*="success"]');

        slots.forEach(slot => {
            // Skip if not a slot wrapper (check for slotHeader inside)
            if (!slot.querySelector('[class*="slotHeader___"]')) return;

            const currentTag = slot.dataset.ocHighlighted || '';

            // Get crime level
            const level = getCrimeLevel(slot);
            if (level === null) return;

            // Check for missing items (any level, any slot with a player)
            if (hasPlayer(slot) && hasMissingItem(slot)) {
                if (currentTag !== 'missingItem') {
                    applyHighlight(slot, MISSING_ITEM_OUTLINE, MISSING_ITEM_BOX_SHADOW, 'missingItem');
                    debugLog('Missing item: Level', level);
                }
                return;
            }

            // Low success rate check only for levels within range
            if (level < MIN_LEVEL || level > MAX_LEVEL) {
                if (currentTag === 'lowSuccess') clearHighlight(slot);
                return;
            }

            // Only highlight slots with actual players
            if (!hasPlayer(slot)) {
                if (currentTag === 'lowSuccess') clearHighlight(slot);
                return;
            }

            // Get success rate
            const successRate = getSuccessRate(slot);
            if (successRate === null) return;

            // Highlight if below threshold (0 means never highlight)
            const threshold = getThreshold(level, getOCCard(slot), slot);
            if (threshold > 0 && successRate < threshold) {
                if (currentTag !== 'lowSuccess') {
                    applyHighlight(slot, HIGHLIGHT_OUTLINE, HIGHLIGHT_BOX_SHADOW, 'lowSuccess');
                    debugLog('Low success slot: Level', level, 'Success', successRate + '%');
                }
            } else {
                if (currentTag === 'lowSuccess') clearHighlight(slot);
            }
        });
    }

    const UNAVAILABLE_STATUSES = new Set(['hospital', 'traveling', 'returning', 'jail', 'federal', 'abroad', 'flying']);

    // Highlight unavailable members in the OC2 table view
    function highlightUnavailableMembers() {
        const oc2Root = document.querySelector('.OC2-memberViewer');
        if (!oc2Root) return;
        const memberRows = oc2Root.querySelectorAll('[class*="OC2-crimeMemberLi"]');

        memberRows.forEach(memberRow => {
            const statusCell = memberRow.querySelector('[class*="OC2-tableCrimeMemberStatus"]');
            if (!statusCell) return;

            const statusText = statusCell.textContent.trim().toLowerCase();
            const isUnavailable = [...UNAVAILABLE_STATUSES].some(s => statusText.includes(s));

            if (isUnavailable) {
                memberRow.style.setProperty('background-color', 'rgba(255, 50, 50, 0.25)', 'important');
                memberRow.style.setProperty('border-left', '4px solid #ff4444', 'important');
            }
        });
    }

    // Run all checks
    function runAllChecks() {
        injectSettingsButton();
        highlightStalledOCs();
        highlightStalledOC2Rows();
        highlightSlotIssues();
        highlightUnavailableMembers();
        labelMissingItems(); // async — runs in background, won't block other checks
    }

    // Initialize with retry logic for dynamic content
    let initRetryCount = 0;
    const MAX_INIT_RETRIES = 40;

    function initialize() {
        // Look for the faction crimes root or OC2 container
        const crimesRoot = document.querySelector('#faction-crimes-root, [class*="scenario___"], .OC2-memberViewer');

        if (!crimesRoot) {
            initRetryCount++;
            if (initRetryCount < MAX_INIT_RETRIES) {
                setTimeout(initialize, 500);
            } else {
                debugLog('OC elements not found after', MAX_INIT_RETRIES, 'retries');
            }
            return;
        }

        debugLog('Initialized');
        injectSettingsUI();
        loadRemoteConfig(false);
        runAllChecks();

        // Set up MutationObserver with debouncing
        let debounceTimeout = null;
        const observer = new MutationObserver(() => {
            clearTimeout(debounceTimeout);
            debounceTimeout = setTimeout(runAllChecks, 100);
        });

        // Observe the native faction crimes container
        const container = document.querySelector('#faction-crimes, .faction-crimes-wrap, #faction-crimes-root');
        if (container) {
            observer.observe(container, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class']
            });
        }

        // Observe the OC2 container for style/class changes and new elements
        const oc2Container = document.querySelector('.OC2-memberViewer');
        if (oc2Container) {
            observer.observe(oc2Container, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class', 'style']
            });
        }

        // Fallback: observe faction page before body (reduces mutation overhead)
        if (!container && !oc2Container) {
            const fallback = document.querySelector('#factions-page');
            observer.observe(fallback || document.body, {
                childList: true,
                subtree: !!fallback
            });
        }

        // Periodic re-check as fallback (OC2 toggles display without triggering mutations)
        const periodicCheckInterval = setInterval(runAllChecks, 25000);

        // Cleanup on page unload
        window.addEventListener('beforeunload', () => {
            clearInterval(periodicCheckInterval);
            clearTimeout(debounceTimeout);
            observer.disconnect();
        });
    }

    // Start when page is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

})();
