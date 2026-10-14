// ==UserScript==
// @name         Torn Shoplifting Store Alert
// @namespace    https://xoke.org/
// @version      1.3
// @description  Alerts when the security you pick (cameras/guards/checkpoint) is disabled at any shoplifting store
// @author       Xoke (based on "Torn Jewelry Store Cluster Ring Alert" by swervelord)
// @match        https://www.torn.com/*
// @run-at       document-end
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      api.torn.com
// @homepageURL  https://github.com/Xoke/torn
// @downloadURL  https://raw.githubusercontent.com/Xoke/torn/main/TornShopliftingAlert.user.js
// @updateURL    https://raw.githubusercontent.com/Xoke/torn/main/TornShopliftingAlert.meta.js
// ==/UserScript==

// Note: This script polls api.torn.com every 30 seconds (2 calls/min).
// If running alongside TornRetalMonitor, TornTargetManager, TornRankedWarTargetFinder,
// or TornPropertyWatcher, combined usage still fits within Torn's 100 calls/min limit.

(function () {
    'use strict';

    const DEBUG = false;
    const POLL_INTERVAL = 30000;
    const API_KEY_STORAGE = 'tornShopliftingAlertApiKey';
    const ENABLED_STORES_STORAGE = 'tornShopliftingAlertEnabledStores'; // legacy, migrated below
    const REQUIREMENTS_STORAGE = 'tornShopliftingAlertRequirements';
    const SHOPLIFTING_URL = 'https://www.torn.com/page.php?sid=crimes#/shoplifting';

    // Known store keys as returned by the API, with display labels and the
    // security types each store has. Any store key or security type the API
    // returns that isn't listed here is required-down by default and shown
    // with an auto-generated label.
    const KNOWN_STORES = [
        { key: 'sallys_sweet_shop', label: "Sally's Sweet Shop", security: ['cameras'] },
        { key: 'Bits_n_bobs', label: "Bits 'n' Bobs", security: ['cameras'] },
        { key: 'tc_clothing', label: 'TC Clothing', security: ['cameras', 'checkpoint'] },
        { key: 'super_store', label: 'Super Store', security: ['cameras', 'checkpoint'] },
        { key: 'cyber_force', label: 'Cyber Force', security: ['cameras', 'guards'] },
        { key: 'pharmacy', label: 'Pharmacy', security: ['cameras', 'checkpoint'] },
        { key: 'big_als', label: "Big Al's Gun Shop", security: ['cameras', 'guards'] },
        { key: 'jewelry_store', label: 'Jewelry Store (Cluster Ring)', security: ['cameras', 'guards'] }
    ];

    function debugLog(...args) {
        if (DEBUG) console.log('[Shoplifting Alert]', ...args);
    }

    let apiKey = GM_getValue(API_KEY_STORAGE, '');
    let bannerEl = null;
    let settingsBtnEl = null;
    let settingsModalEl = null;
    let pollTimer = null;
    let audioCtx = null;
    let lastOpenStores = new Set();
    // store key -> list of security types, refreshed from each API response
    let lastKnownSecurity = {};
    KNOWN_STORES.forEach(function (s) { lastKnownSecurity[s.key] = s.security.slice(); });

    // Cross-tab leader election via localStorage so only one torn.com tab polls
    // the API. The leader refreshes its heartbeat every poll; a stale heartbeat
    // lets another tab take over.
    const LEADER_KEY = 'tornShopliftingAlertLeader';
    const LEADER_STALE_MS = 65000; // > 2 missed polls
    const TAB_ID = Date.now() + '-' + Math.random().toString(36).slice(2);

    function isLeaderTab() {
        try {
            const now = Date.now();
            let leader = null;
            try { leader = JSON.parse(localStorage.getItem(LEADER_KEY)); } catch (e) {}
            if (!leader || leader.id === TAB_ID || (now - leader.ts) > LEADER_STALE_MS) {
                localStorage.setItem(LEADER_KEY, JSON.stringify({ id: TAB_ID, ts: now }));
                return true;
            }
            return false;
        } catch (e) {
            return true; // localStorage unavailable — fall back to polling
        }
    }

    window.addEventListener('beforeunload', function () {
        try {
            const leader = JSON.parse(localStorage.getItem(LEADER_KEY));
            if (leader && leader.id === TAB_ID) localStorage.removeItem(LEADER_KEY);
        } catch (e) {}
    });

    // "One camera" / "Four cameras" -> "cameras", "Two guards" -> "guards", etc.
    // so a store's setting survives its camera/guard count changing.
    function securityType(title) {
        const t = String(title || '').toLowerCase();
        if (t.indexOf('camera') !== -1) return 'cameras';
        if (t.indexOf('guard') !== -1) return 'guards';
        if (t.indexOf('checkpoint') !== -1) return 'checkpoint';
        return t;
    }

    function securityLabel(type) {
        return type.charAt(0).toUpperCase() + type.slice(1);
    }

    // Requirements: { storeKey: { securityType: bool } } where true means
    // "this must be down for the store to alert". Missing entries default to
    // true; a store with nothing ticked never alerts.
    function getRequirements() {
        let reqs = GM_getValue(REQUIREMENTS_STORAGE, null);
        if (reqs) return reqs;

        // Migrate the old per-store on/off setting: a disabled store gets all
        // of its security unticked.
        reqs = {};
        const oldEnabled = GM_getValue(ENABLED_STORES_STORAGE, {});
        Object.keys(oldEnabled).forEach(function (storeKey) {
            if (oldEnabled[storeKey] !== false) return;
            reqs[storeKey] = {};
            (lastKnownSecurity[storeKey] || []).forEach(function (type) {
                reqs[storeKey][type] = false;
            });
        });
        GM_setValue(REQUIREMENTS_STORAGE, reqs);
        return reqs;
    }

    function isRequired(reqs, storeKey, type) {
        return !(reqs[storeKey] && reqs[storeKey][type] === false);
    }

    GM_addStyle(`
        #torn-sa-banner {
            position: fixed;
            top: 0;
            left: 50%;
            transform: translateX(-50%);
            z-index: 999999;
            font-family: Arial, sans-serif;
            font-size: 13px;
        }

        #torn-sa-inner {
            display: flex;
            align-items: center;
            gap: 10px;
            background: #dc3545;
            border: 2px solid #a71d2a;
            border-top: none;
            border-radius: 0 0 8px 8px;
            padding: 8px 14px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.6);
            animation: torn-sa-pulse 2s infinite;
        }

        @keyframes torn-sa-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.85; }
        }

        #torn-sa-link {
            color: #fff;
            text-decoration: none;
            font-weight: bold;
            white-space: nowrap;
            cursor: pointer;
        }

        #torn-sa-link:hover {
            text-decoration: underline;
        }

        #torn-sa-setup {
            display: flex;
            align-items: center;
            gap: 8px;
            color: #ccc;
            background: #1a1a1a;
            border: 2px solid #444;
            border-top: none;
            border-radius: 0 0 8px 8px;
            padding: 8px 14px;
        }

        #torn-sa-key-input {
            background: #333;
            border: 1px solid #555;
            color: #fff;
            border-radius: 4px;
            padding: 4px 8px;
            font-size: 12px;
            width: 160px;
        }

        #torn-sa-key-save {
            background: #2a6;
            border: 1px solid #3b7;
            color: #fff;
            cursor: pointer;
            border-radius: 4px;
            padding: 4px 10px;
            font-size: 12px;
            font-weight: bold;
        }

        #torn-sa-key-save:hover {
            background: #3b7;
        }

        #torn-sa-settings-btn {
            position: fixed;
            top: 50%;
            right: 20px;
            transform: translateY(-50%);
            z-index: 999998;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: #1a1a1a;
            border: 2px solid #555;
            color: #ccc;
            font-size: 18px;
            cursor: pointer;
            box-shadow: 0 2px 8px rgba(0,0,0,0.5);
        }

        #torn-sa-settings-btn:hover {
            background: #333;
            color: #fff;
        }

        #torn-sa-modal-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.6);
            z-index: 9999999;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        #torn-sa-modal {
            background: #1a1a1a;
            border: 2px solid #444;
            border-radius: 8px;
            padding: 20px;
            width: 380px;
            font-family: Arial, sans-serif;
            color: #ddd;
            box-shadow: 0 4px 20px rgba(0,0,0,0.6);
        }

        #torn-sa-modal h3 {
            margin: 0 0 12px 0;
            color: #fff;
        }

        #torn-sa-modal .torn-sa-hint {
            font-size: 12px;
            color: #999;
            margin-bottom: 10px;
        }

        #torn-sa-modal .torn-sa-store-row {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 4px 0;
        }

        #torn-sa-modal .torn-sa-store-name {
            flex: 1;
        }

        #torn-sa-modal .torn-sa-store-row label {
            cursor: pointer;
            margin-right: 6px;
        }

        #torn-sa-modal-buttons {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
            margin-top: 16px;
        }

        #torn-sa-modal-buttons button {
            padding: 6px 14px;
            border-radius: 4px;
            border: none;
            cursor: pointer;
            font-size: 13px;
        }

        #torn-sa-modal-close {
            background: #444;
            color: #fff;
        }

        #torn-sa-modal-close:hover {
            background: #555;
        }
    `);

    function storeDisplayName(key) {
        const known = KNOWN_STORES.find(function (s) { return s.key === key; });
        if (known) return known.label;
        return key
            .split('_')
            .map(function (word) { return word.charAt(0).toUpperCase() + word.slice(1); })
            .join(' ');
    }

    function isCrimesPage() {
        return window.location.pathname === '/page.php' && window.location.search.indexOf('sid=crimes') !== -1;
    }

    function buildBanner() {
        if (bannerEl) return;
        bannerEl = document.createElement('div');
        bannerEl.id = 'torn-sa-banner';
        document.body.appendChild(bannerEl);
    }

    function showSetupUI() {
        buildBanner();
        bannerEl.innerHTML = '';

        const setup = document.createElement('div');
        setup.id = 'torn-sa-setup';
        setup.innerHTML = '<span>Shoplifting Alert: enter API key</span>';

        const input = document.createElement('input');
        input.id = 'torn-sa-key-input';
        input.type = 'password';
        input.placeholder = 'Torn API key (16 chars)';
        input.maxLength = 16;

        const save = document.createElement('button');
        save.id = 'torn-sa-key-save';
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
        bannerEl.appendChild(setup);
        bannerEl.style.display = '';
    }

    function showAlertUI(openStores) {
        buildBanner();
        bannerEl.innerHTML = '';

        const inner = document.createElement('div');
        inner.id = 'torn-sa-inner';

        const link = document.createElement('a');
        link.id = 'torn-sa-link';
        link.href = SHOPLIFTING_URL;
        link.textContent = '🚨 ' + openStores.map(function (s) {
            return storeDisplayName(s.key) + ' (' + s.down.map(securityLabel).join(' + ') + ' down)';
        }).join(', ') + ' — click to shoplift';

        inner.appendChild(link);
        bannerEl.appendChild(inner);
        bannerEl.style.display = '';
    }

    function hideBanner() {
        if (bannerEl) bannerEl.style.display = 'none';
    }

    function playAlert() {
        try {
            if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();

            function playTone(freq, startTime, duration) {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.type = 'sine';
                osc.frequency.value = freq;
                gain.gain.setValueAtTime(0.4, startTime);
                gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
                osc.start(startTime);
                osc.stop(startTime + duration);
            }

            const t = audioCtx.currentTime;
            playTone(880, t, 0.2);
            playTone(1100, t + 0.22, 0.2);
        } catch (e) {
            debugLog('Audio failed:', e);
        }
    }

    function closeSettingsModal() {
        if (settingsModalEl) {
            settingsModalEl.remove();
            settingsModalEl = null;
        }
    }

    function openSettingsModal() {
        closeSettingsModal();

        const overlay = document.createElement('div');
        overlay.id = 'torn-sa-modal-overlay';
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) closeSettingsModal();
        });

        const modal = document.createElement('div');
        modal.id = 'torn-sa-modal';

        const title = document.createElement('h3');
        title.textContent = 'Shoplifting Alert Settings';
        modal.appendChild(title);

        const hint = document.createElement('div');
        hint.className = 'torn-sa-hint';
        hint.textContent = 'Alert when all ticked security at a store is down. ' +
            'Untick everything to ignore a store.';
        modal.appendChild(hint);

        const reqs = getRequirements();
        // Use whatever stores/security we've actually seen from the API (falls
        // back to the known list before the first successful poll), so a store
        // the API adds or changes in the future still shows up here.
        Object.keys(lastKnownSecurity).forEach(function (key) {
            const row = document.createElement('div');
            row.className = 'torn-sa-store-row';

            const name = document.createElement('span');
            name.className = 'torn-sa-store-name';
            name.textContent = storeDisplayName(key);
            row.appendChild(name);

            lastKnownSecurity[key].forEach(function (type) {
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.id = 'torn-sa-store-' + key + '-' + type.replace(/\W+/g, '_');
                checkbox.checked = isRequired(reqs, key, type);
                checkbox.addEventListener('change', function () {
                    const current = getRequirements();
                    current[key] = current[key] || {};
                    current[key][type] = checkbox.checked;
                    GM_setValue(REQUIREMENTS_STORAGE, current);
                });

                const label = document.createElement('label');
                label.htmlFor = checkbox.id;
                label.textContent = securityLabel(type);

                row.appendChild(checkbox);
                row.appendChild(label);
            });

            modal.appendChild(row);
        });

        const buttons = document.createElement('div');
        buttons.id = 'torn-sa-modal-buttons';

        const closeBtn = document.createElement('button');
        closeBtn.id = 'torn-sa-modal-close';
        closeBtn.textContent = 'Close';
        closeBtn.addEventListener('click', closeSettingsModal);

        buttons.appendChild(closeBtn);
        modal.appendChild(buttons);

        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        settingsModalEl = overlay;
    }

    function ensureSettingsButton() {
        if (!isCrimesPage()) {
            if (settingsBtnEl) {
                settingsBtnEl.remove();
                settingsBtnEl = null;
            }
            closeSettingsModal();
            return;
        }
        if (settingsBtnEl) return;

        settingsBtnEl = document.createElement('button');
        settingsBtnEl.id = 'torn-sa-settings-btn';
        settingsBtnEl.textContent = '⚙';
        settingsBtnEl.title = 'Shoplifting Alert Settings';
        settingsBtnEl.addEventListener('click', openSettingsModal);
        document.body.appendChild(settingsBtnEl);
    }

    function checkStores() {
        // Only one torn.com tab should poll the API
        if (!isLeaderTab()) return;

        GM_xmlhttpRequest({
            method: 'GET',
            url: 'https://api.torn.com/torn/?selections=shoplifting&key=' + encodeURIComponent(apiKey),
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
                    if (data.error.code === 2) { // Incorrect key
                        GM_setValue(API_KEY_STORAGE, '');
                        apiKey = '';
                        showSetupUI();
                    }
                    return;
                }

                const shoplifting = data.shoplifting || {};
                const allStoreKeys = Object.keys(shoplifting);
                if (allStoreKeys.length > 0) {
                    const seen = {};
                    allStoreKeys.forEach(function (storeKey) {
                        const items = shoplifting[storeKey];
                        seen[storeKey] = Array.isArray(items)
                            ? items.map(function (item) { return securityType(item && item.title); })
                            : [];
                    });
                    lastKnownSecurity = seen;
                }

                const reqs = getRequirements();
                const openStores = []; // [{ key, down: [security types that are down] }]

                allStoreKeys.forEach(function (storeKey) {
                    const items = shoplifting[storeKey];
                    if (!Array.isArray(items) || items.length === 0) return;
                    const required = items.filter(function (item) {
                        return item && isRequired(reqs, storeKey, securityType(item.title));
                    });
                    if (required.length === 0) return; // nothing ticked: store ignored
                    const allRequiredDown = required.every(function (item) { return item.disabled === true; });
                    if (!allRequiredDown) return;
                    openStores.push({
                        key: storeKey,
                        down: items
                            .filter(function (item) { return item && item.disabled === true; })
                            .map(function (item) { return securityType(item.title); })
                    });
                });

                debugLog('Open stores:', openStores);

                // Track store + what's down, so e.g. a second security going
                // down at an already-open store chimes again.
                const openSet = new Set(openStores.map(function (s) { return s.key + ':' + s.down.join('+'); }));
                const isNewOpening = Array.from(openSet).some(function (s) { return !lastOpenStores.has(s); });

                if (openStores.length > 0) {
                    if (isNewOpening) playAlert();
                    showAlertUI(openStores);
                } else {
                    hideBanner();
                }

                lastOpenStores = openSet;
            },
            onerror: function (err) {
                debugLog('Request error:', err);
            }
        });
    }

    function startPolling() {
        if (pollTimer) clearInterval(pollTimer);
        checkStores();
        pollTimer = setInterval(checkStores, POLL_INTERVAL);
    }

    function initialize() {
        ensureSettingsButton();
        window.addEventListener('hashchange', ensureSettingsButton);
        window.addEventListener('popstate', ensureSettingsButton);
        // Torn is a single-page app; hashchange/popstate don't always fire for
        // client-side navigation, so also watch the DOM as a fallback.
        let debounceTimer = null;
        new MutationObserver(function () {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(ensureSettingsButton, 300);
        }).observe(document.body, { childList: true, subtree: true });

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
})();
