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
})();
