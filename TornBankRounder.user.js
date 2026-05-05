// ==UserScript==
// @name         Torn Bank Rounder
// @namespace    https://xoke.org/
// @version      1.1
// @description  Adds a button to auto-fill deposit amount to the highest achievable $5M multiple
// @author       Xoke
// @match        https://www.torn.com/factions.php*
// @homepageURL  https://github.com/Xoke/torn
// @updateURL    https://raw.githubusercontent.com/Xoke/torn/main/TornBankRounder.meta.js
// @downloadURL  https://raw.githubusercontent.com/Xoke/torn/main/TornBankRounder.user.js
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const DEBUG = false;
    const FIVE_MILLION = 5_000_000;
    const MIN_KEEP_CASH = 1_000_000;

    function debugLog(...args) {
        if (DEBUG) console.log('[Bank Rounder]', ...args);
    }

    function isArmouryTab() {
        return window.location.hash.includes('tab=armoury');
    }

    function getBalances() {
        // The armoury page shows: "You have $X and a balance of $Y"
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
            const match = node.textContent.match(
                /You have \$([0-9,]+) and a balance of \$([0-9,]+)/i
            );
            if (match) {
                return {
                    cash: parseInt(match[1].replace(/,/g, ''), 10),
                    bank: parseInt(match[2].replace(/,/g, ''), 10),
                };
            }
        }
        return null;
    }

    function calcDeposit(bank, cash) {
        const available = cash - MIN_KEEP_CASH;
        if (available <= 0) return 0;
        const target = Math.floor((bank + available) / FIVE_MILLION) * FIVE_MILLION;
        return Math.max(0, target - bank);
    }

    function setInput(input, value) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(input, '$' + value.toLocaleString());
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function addRoundButton() {
        if (document.querySelector('.bank-rounder-btn')) return;

        const input = document.querySelector('input.amount.input-money');
        if (!input) return;

        const parent = input.parentElement;
        if (!parent) return;

        parent.style.position = 'relative';
        input.style.paddingRight = '36px';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'bank-rounder-btn';
        btn.textContent = '5M';
        btn.title = 'Fill to highest achievable $5M multiple (keeps $1M cash)';
        btn.style.cssText =
            'position: absolute; right: 0; top: 0; bottom: 0; ' +
            'padding: 0 8px; font-size: 11px; cursor: pointer; ' +
            'background: #27ae60; color: white; border: none; border-radius: 0 3px 3px 0; ' +
            'z-index: 1;';

        btn.addEventListener('mouseenter', function () { btn.style.background = '#2ecc71'; });
        btn.addEventListener('mouseleave', function () { btn.style.background = '#27ae60'; });

        btn.addEventListener('click', function (e) {
            e.preventDefault();
            const balances = getBalances();
            if (!balances) {
                alert('Bank Rounder: Could not find balance text on page.');
                return;
            }
            debugLog('Cash:', balances.cash, 'Bank:', balances.bank);
            const deposit = calcDeposit(balances.bank, balances.cash);
            if (deposit <= 0) {
                alert('Bank Rounder: Not enough cash to reach next $5M milestone (keeping $1M minimum).');
                return;
            }
            debugLog('Depositing:', deposit);
            setInput(input, deposit);
        });

        parent.appendChild(btn);
        debugLog('Button added');
    }

    let attempts = 0;
    let observer = null;

    function initialize() {
        if (!isArmouryTab()) return;

        attempts = 0;

        function tryAdd() {
            const input = document.querySelector('input.amount.input-money');
            if (!input) {
                if (++attempts < 40) setTimeout(tryAdd, 500);
                return;
            }
            addRoundButton();

            if (observer) observer.disconnect();
            observer = new MutationObserver(function () {
                if (isArmouryTab() && !document.querySelector('.bank-rounder-btn')) {
                    addRoundButton();
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
        }

        tryAdd();
    }

    window.addEventListener('hashchange', function () {
        setTimeout(initialize, 300);
    });

    setTimeout(initialize, 500);
})();
