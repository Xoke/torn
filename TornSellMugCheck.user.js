// ==UserScript==
// @name         Torn Sell-Mug Check
// @namespace    https://xoke.org/
// @version      1.0
// @description  On a seller's bazaar, shows their friends vs enemies and mugging history so you can judge whether they might sell-mug you
// @author       Xoke
// @match        https://www.torn.com/bazaar.php*
// @run-at       document-end
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      api.torn.com
// @homepageURL  https://github.com/Xoke/torn
// @downloadURL  https://raw.githubusercontent.com/Xoke/torn/main/TornSellMugCheck.user.js
// @updateURL    https://raw.githubusercontent.com/Xoke/torn/main/TornSellMugCheck.meta.js
// ==/UserScript==

// Note: Makes 2 API calls per seller (profile + public personal stats), cached
// for 30 minutes, and only when you open someone's bazaar.

(function () {
    'use strict';

    const DEBUG = false;
    const API_KEY_STORAGE = 'tornSellMugCheckApiKey';
    const CACHE_STORAGE = 'tornSellMugCheckCache';
    const CACHE_TTL_MS = 30 * 60 * 1000;
    const MUG_STATS = ['moneymugged', 'largestmug', 'attackswon'];

    // Risk heuristic. A seller is HIGH risk if they have lots of enemies
    // relative to friends or have mugged a lot of money; MEDIUM if either
    // signal is moderate.
    const HIGH_ENEMY_RATIO = 3;          // enemies >= 3x friends...
    const HIGH_MIN_ENEMIES = 20;         // ...and at least this many enemies
    const HIGH_MONEY_MUGGED = 1e9;       // $1b mugged total
    const MEDIUM_MONEY_MUGGED = 1e8;     // $100m mugged total

    function debugLog(...args) {
        if (DEBUG) console.log('[Sell-Mug Check]', ...args);
    }

    let apiKey = GM_getValue(API_KEY_STORAGE, '');
    let panelEl = null;
    let currentSellerId = null;

    GM_addStyle(`
        #torn-smc-panel {
            position: fixed;
            top: 0;
            left: 50%;
            transform: translateX(-50%);
            z-index: 999999;
            font-family: Arial, sans-serif;
            font-size: 13px;
            color: #fff;
            background: #1a1a1a;
            border: 2px solid #444;
            border-top: none;
            border-radius: 0 0 8px 8px;
            padding: 8px 14px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.6);
            max-width: calc(100vw - 32px);
            box-sizing: border-box;
        }

        #torn-smc-panel.torn-smc-low { background: #1e5631; border-color: #2a7a45; }
        #torn-smc-panel.torn-smc-medium { background: #8a5a00; border-color: #b07400; }
        #torn-smc-panel.torn-smc-high { background: #a71d2a; border-color: #dc3545; }

        #torn-smc-panel .torn-smc-title {
            font-weight: bold;
            margin-bottom: 4px;
        }

        #torn-smc-panel .torn-smc-stats {
            display: flex;
            flex-wrap: wrap;
            gap: 4px 14px;
        }

        #torn-smc-panel .torn-smc-close {
            position: absolute;
            top: 2px;
            right: 6px;
            cursor: pointer;
            opacity: 0.7;
        }

        #torn-smc-panel .torn-smc-close:hover { opacity: 1; }

        #torn-smc-key-input {
            background: #333;
            border: 1px solid #555;
            color: #fff;
            border-radius: 4px;
            padding: 4px 8px;
            font-size: 12px;
            width: 160px;
            margin: 0 6px;
        }

        #torn-smc-key-save {
            background: #2a6;
            border: 1px solid #3b7;
            color: #fff;
            cursor: pointer;
            border-radius: 4px;
            padding: 4px 10px;
            font-size: 12px;
            font-weight: bold;
        }
    `);

    function getSellerId() {
        const id = new URLSearchParams(window.location.search).get('userId');
        return id && /^\d+$/.test(id) ? id : null;
    }

    function formatMoney(n) {
        if (n >= 1e9) return '$' + (n / 1e9).toFixed(n >= 1e10 ? 0 : 1) + 'b';
        if (n >= 1e6) return '$' + (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'm';
        if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'k';
        return '$' + n;
    }

    function formatNumber(n) {
        return Number(n).toLocaleString('en-US');
    }

    function assessRisk(d) {
        const friends = d.friends || 0;
        const enemies = d.enemies || 0;
        const ratio = enemies / Math.max(friends, 1);
        const reasons = [];

        if (enemies >= HIGH_MIN_ENEMIES && ratio >= HIGH_ENEMY_RATIO) {
            reasons.push('lots of enemies');
        }
        if (d.moneymugged >= HIGH_MONEY_MUGGED) {
            reasons.push('big mugger');
        }
        if (reasons.length) return { level: 'high', reasons: reasons };

        if (enemies > friends) reasons.push('more enemies than friends');
        if (d.moneymugged >= MEDIUM_MONEY_MUGGED) reasons.push('has mugged a fair amount');
        if (reasons.length) return { level: 'medium', reasons: reasons };

        return { level: 'low', reasons: [] };
    }

    function buildPanel() {
        if (!panelEl) {
            panelEl = document.createElement('div');
            panelEl.id = 'torn-smc-panel';
            document.body.appendChild(panelEl);
        }
        panelEl.className = '';
        panelEl.innerHTML = '';
        panelEl.style.display = '';

        const close = document.createElement('span');
        close.className = 'torn-smc-close';
        close.textContent = '✕';
        close.title = 'Hide';
        close.addEventListener('click', function () { panelEl.style.display = 'none'; });
        panelEl.appendChild(close);
        return panelEl;
    }

    function hidePanel() {
        if (panelEl) panelEl.style.display = 'none';
    }

    function showMessage(text) {
        const panel = buildPanel();
        const msg = document.createElement('div');
        msg.textContent = text;
        panel.appendChild(msg);
    }

    function showSetupUI() {
        const panel = buildPanel();
        const label = document.createElement('span');
        label.textContent = 'Sell-Mug Check: enter API key';

        const input = document.createElement('input');
        input.id = 'torn-smc-key-input';
        input.type = 'password';
        input.placeholder = 'Torn API key (16 chars)';
        input.maxLength = 16;

        const save = document.createElement('button');
        save.id = 'torn-smc-key-save';
        save.textContent = 'Save';
        save.addEventListener('click', function () {
            const val = input.value.trim();
            if (!/^[a-zA-Z0-9]{16}$/.test(val)) {
                input.style.borderColor = '#c33';
                return;
            }
            apiKey = val;
            GM_setValue(API_KEY_STORAGE, apiKey);
            currentSellerId = null;
            check();
        });

        panel.appendChild(label);
        panel.appendChild(input);
        panel.appendChild(save);
    }

    function showResult(d) {
        const risk = assessRisk(d);
        const panel = buildPanel();
        panel.className = 'torn-smc-' + risk.level;

        const title = document.createElement('div');
        title.className = 'torn-smc-title';
        title.textContent = 'Sell-mug risk: ' + risk.level.toUpperCase() + ' — ' + d.name +
            (risk.reasons.length ? ' (' + risk.reasons.join(', ') + ')' : '');
        panel.appendChild(title);

        const stats = document.createElement('div');
        stats.className = 'torn-smc-stats';
        [
            'Friends: ' + formatNumber(d.friends),
            'Enemies: ' + formatNumber(d.enemies),
            'Mugged: ' + formatMoney(d.moneymugged) + ' total',
            'Largest mug: ' + formatMoney(d.largestmug),
            'Attacks won: ' + formatNumber(d.attackswon)
        ].forEach(function (text) {
            const s = document.createElement('span');
            s.textContent = text;
            stats.appendChild(s);
        });
        panel.appendChild(stats);
    }

    function apiGet(url) {
        return new Promise(function (resolve, reject) {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                onload: function (response) {
                    let data;
                    try {
                        data = JSON.parse(response.responseText);
                    } catch (e) {
                        reject(new Error('Bad API response'));
                        return;
                    }
                    if (data.error) {
                        const err = new Error(data.error.error || 'API error');
                        err.code = data.error.code;
                        reject(err);
                        return;
                    }
                    resolve(data);
                },
                onerror: function () { reject(new Error('Request failed')); }
            });
        });
    }

    function getCached(id) {
        const cache = GM_getValue(CACHE_STORAGE, {});
        const entry = cache[id];
        if (entry && Date.now() - entry.ts < CACHE_TTL_MS) return entry.data;
        return null;
    }

    function setCached(id, data) {
        const cache = GM_getValue(CACHE_STORAGE, {});
        const now = Date.now();
        Object.keys(cache).forEach(function (k) {
            if (now - cache[k].ts >= CACHE_TTL_MS) delete cache[k];
        });
        cache[id] = { ts: now, data: data };
        GM_setValue(CACHE_STORAGE, cache);
    }

    function fetchSeller(id) {
        const key = encodeURIComponent(apiKey);
        const base = 'https://api.torn.com/v2/user/' + encodeURIComponent(id);
        return Promise.all([
            apiGet(base + '/profile?key=' + key),
            apiGet(base + '/personalstats?stat=' + MUG_STATS.join(',') + '&key=' + key)
        ]).then(function (results) {
            const profile = results[0].profile || {};
            const stats = {};
            (results[1].personalstats || []).forEach(function (s) { stats[s.name] = s.value; });
            return {
                name: profile.name || ('[' + id + ']'),
                friends: profile.friends || 0,
                enemies: profile.enemies || 0,
                moneymugged: stats.moneymugged || 0,
                largestmug: stats.largestmug || 0,
                attackswon: stats.attackswon || 0
            };
        });
    }

    function check() {
        const id = getSellerId();
        if (!id) {
            // Your own bazaar (no userId) — nothing to check.
            currentSellerId = null;
            hidePanel();
            return;
        }
        if (id === currentSellerId) return;
        currentSellerId = id;

        if (!apiKey) {
            showSetupUI();
            return;
        }

        const cached = getCached(id);
        if (cached) {
            debugLog('Cached', id, cached);
            showResult(cached);
            return;
        }

        showMessage('Sell-Mug Check: looking up seller…');
        fetchSeller(id).then(function (data) {
            debugLog('Fetched', id, data);
            setCached(id, data);
            if (id === currentSellerId) showResult(data);
        }).catch(function (err) {
            debugLog('Error', err);
            if (id !== currentSellerId) return;
            if (err.code === 2) { // Incorrect key
                GM_setValue(API_KEY_STORAGE, '');
                apiKey = '';
                showSetupUI();
                return;
            }
            currentSellerId = null; // allow a retry on next navigation
            showMessage('Sell-Mug Check: ' + err.message);
        });
    }

    function initialize() {
        check();
        window.addEventListener('popstate', check);
        window.addEventListener('hashchange', check);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
})();
