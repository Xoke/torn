// ==UserScript==
// @name         Torn Revive Chance Highlighter
// @namespace    https://xoke.org/
// @version      1.1
// @description  Highlights revive attempts on the hospital page whose chance of success meets a configurable threshold (default 90%)
// @author       Xoke
// @match        https://www.torn.com/hospitalview.php*
// @run-at       document-end
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @homepageURL  https://github.com/Xoke/torn
// @downloadURL  https://raw.githubusercontent.com/Xoke/torn/main/TornReviveChanceHighlighter.user.js
// @updateURL    https://raw.githubusercontent.com/Xoke/torn/main/TornReviveChanceHighlighter.meta.js
// ==/UserScript==

(function () {
    'use strict';

    const DEBUG = false;
    const THRESHOLD_STORAGE = 'tornReviveChanceThreshold';
    const DEFAULT_THRESHOLD = 90;

    // e.g. "Reviving Grundig has a 61.04% chance of success and will use 40 energy"
    const REVIVE_RE = /Reviving\s+(.+?)\s+has\s+a\s+([\d.]+)%\s+chance\s+of\s+success/i;

    const GOOD_CLASS = 'torn-rch-good';
    const BAD_CLASS = 'torn-rch-bad';
    const PCT_ATTR = 'data-torn-rch-pct';

    function debugLog(...args) {
        if (DEBUG) console.log('[Revive Chance]', ...args);
    }

    let threshold = Number(GM_getValue(THRESHOLD_STORAGE, DEFAULT_THRESHOLD));
    if (!isFinite(threshold)) threshold = DEFAULT_THRESHOLD;

    let settingsBtnEl = null;
    let settingsModalEl = null;

    GM_addStyle(`
        .${GOOD_CLASS} {
            background: rgba(40, 167, 69, 0.35) !important;
            outline: 2px solid #28a745 !important;
            border-radius: 4px;
        }

        .${BAD_CLASS} {
            background: rgba(220, 53, 69, 0.18) !important;
            outline: 1px solid rgba(220, 53, 69, 0.6) !important;
            border-radius: 4px;
        }

        #torn-rch-settings-btn {
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

        #torn-rch-settings-btn:hover {
            background: #333;
            color: #fff;
        }

        #torn-rch-modal-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.6);
            z-index: 9999999;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        #torn-rch-modal {
            background: #1a1a1a;
            border: 2px solid #444;
            border-radius: 8px;
            padding: 20px;
            width: 300px;
            font-family: Arial, sans-serif;
            color: #ddd;
            box-shadow: 0 4px 20px rgba(0,0,0,0.6);
        }

        #torn-rch-modal h3 {
            margin: 0 0 12px 0;
            color: #fff;
        }

        #torn-rch-modal label {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        #torn-rch-threshold-input {
            background: #333;
            border: 1px solid #555;
            color: #fff;
            border-radius: 4px;
            padding: 4px 8px;
            font-size: 13px;
            width: 70px;
        }

        #torn-rch-modal-buttons {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
            margin-top: 16px;
        }

        #torn-rch-modal-buttons button {
            padding: 6px 14px;
            border-radius: 4px;
            border: none;
            cursor: pointer;
            font-size: 13px;
            color: #fff;
        }

        #torn-rch-modal-save {
            background: #2a6;
        }

        #torn-rch-modal-save:hover {
            background: #3b7;
        }

        #torn-rch-modal-close {
            background: #444;
        }

        #torn-rch-modal-close:hover {
            background: #555;
        }
    `);

    function applyHighlight(el) {
        const pct = parseFloat(el.getAttribute(PCT_ATTR));
        const good = pct >= threshold;
        el.classList.toggle(GOOD_CLASS, good);
        el.classList.toggle(BAD_CLASS, !good);
    }

    function clearHighlight(row) {
        row.removeAttribute(PCT_ATTR);
        row.classList.remove(GOOD_CLASS, BAD_CLASS);
    }

    // Clicking REVIVE on a row loads the confirmation text into that row's
    // .confirm-revive box via AJAX. Highlight the whole row (the <li>) based on
    // the chance it shows; clear it once the box shows something else (e.g.
    // after reviving).
    function scan() {
        document.querySelectorAll('.user-info-list-wrap .confirm-revive').forEach(function (box) {
            const row = box.closest('li');
            if (!row) return;

            const match = REVIVE_RE.exec(box.textContent);
            if (!match) {
                if (row.hasAttribute(PCT_ATTR)) clearHighlight(row);
                return;
            }

            const pct = match[2];
            if (row.getAttribute(PCT_ATTR) === pct) return;

            row.setAttribute(PCT_ATTR, pct);
            applyHighlight(row);
            debugLog(match[1], pct + '%');
        });
    }

    function reapplyAll() {
        document.querySelectorAll('[' + PCT_ATTR + ']').forEach(applyHighlight);
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
        overlay.id = 'torn-rch-modal-overlay';
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) closeSettingsModal();
        });

        const modal = document.createElement('div');
        modal.id = 'torn-rch-modal';

        const title = document.createElement('h3');
        title.textContent = 'Revive Chance Settings';
        modal.appendChild(title);

        const label = document.createElement('label');
        label.textContent = 'Highlight at or above';

        const input = document.createElement('input');
        input.id = 'torn-rch-threshold-input';
        input.type = 'number';
        input.min = '0';
        input.max = '100';
        input.step = '0.01';
        input.value = String(threshold);

        label.appendChild(input);
        label.appendChild(document.createTextNode('%'));
        modal.appendChild(label);

        const buttons = document.createElement('div');
        buttons.id = 'torn-rch-modal-buttons';

        const saveBtn = document.createElement('button');
        saveBtn.id = 'torn-rch-modal-save';
        saveBtn.textContent = 'Save';
        saveBtn.addEventListener('click', function () {
            const val = parseFloat(input.value);
            if (!isFinite(val) || val < 0 || val > 100) {
                input.style.borderColor = '#c33';
                return;
            }
            threshold = val;
            GM_setValue(THRESHOLD_STORAGE, threshold);
            reapplyAll();
            closeSettingsModal();
        });

        const closeBtn = document.createElement('button');
        closeBtn.id = 'torn-rch-modal-close';
        closeBtn.textContent = 'Close';
        closeBtn.addEventListener('click', closeSettingsModal);

        buttons.appendChild(saveBtn);
        buttons.appendChild(closeBtn);
        modal.appendChild(buttons);

        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        settingsModalEl = overlay;
        input.focus();
    }

    function addSettingsButton() {
        settingsBtnEl = document.createElement('button');
        settingsBtnEl.id = 'torn-rch-settings-btn';
        settingsBtnEl.textContent = '⚙';
        settingsBtnEl.title = 'Revive Chance Settings';
        settingsBtnEl.addEventListener('click', openSettingsModal);
        document.body.appendChild(settingsBtnEl);
    }

    function initialize() {
        addSettingsButton();
        scan();

        // Revive text appears dynamically (list loads / revive clicks), so
        // rescan on DOM changes, debounced.
        let debounceTimer = null;
        new MutationObserver(function () {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(scan, 150);
        }).observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
})();
