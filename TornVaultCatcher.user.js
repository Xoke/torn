// ==UserScript==
// @name         Torn Vault Catcher
// @namespace    https://xoke.org/
// @version      1.0
// @description  Warns when giving a faction member more money than their vault balance
// @author       Xoke (based on VaultCatcher by Lazerpent [2112641])
// @match        https://www.torn.com/factions.php*
// @homepageURL  https://github.com/Xoke/torn
// @updateURL    https://raw.githubusercontent.com/Xoke/torn/main/TornVaultCatcher.meta.js
// @downloadURL  https://raw.githubusercontent.com/Xoke/torn/main/TornVaultCatcher.user.js
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const DEBUG = false;
    function debugLog(...args) { if (DEBUG) console.log('[VaultCatcher]', ...args); }

    let interceptActive = false;

    function isGiveToUserTab() {
        const hash = window.location.hash;
        // The give-to-user tab within faction controls
        return hash.includes('tab=controls') &&
            (hash.includes('option=give-to-user') || !hash.includes('option='));
    }

    function getSelectedBalance() {
        // The page shows "PlayerName's current balance is $X,XXX,XXX"
        // in a <p class="formTitle___..."><span>...</span></p>
        const container = document.getElementById('option-give-to-user');
        if (!container) return null;

        // Look for the balance text - it's stable across builds
        const spans = container.querySelectorAll('span');
        for (const span of spans) {
            const text = span.textContent;
            const match = text.match(/current balance is \$([0-9,]+)/i);
            if (match) {
                return parseInt(match[1].replace(/,/g, ''), 10);
            }
        }

        // Fallback: search the depositor list for the selected user
        return getBalanceFromList();
    }

    function getBalanceFromList() {
        const container = document.getElementById('option-give-to-user');
        if (!container) return null;

        // Get the selected username from the autocomplete input
        const userInput = container.querySelector('input[data-testid="autocomplete-input"], input[name="searchAccount"]');
        if (!userInput || !userInput.value) return null;

        // Extract just the name (format: "PlayerName [ID]")
        const nameMatch = userInput.value.match(/^(.+?)\s*\[/);
        const selectedName = nameMatch ? nameMatch[1].trim() : userInput.value.trim();
        debugLog('Looking for user:', selectedName);

        // Find all list items in the depositor section
        const listItems = container.querySelectorAll('li');
        for (const li of listItems) {
            // Get the player name from honor-text spans
            const nameSpans = li.querySelectorAll('span.honor-text');
            if (nameSpans.length === 0) continue;

            // The last honor-text span contains the plain text name
            const nameText = nameSpans[nameSpans.length - 1].textContent.trim();
            if (nameText.toLowerCase() !== selectedName.toLowerCase()) continue;

            // Found the user - get their balance from the hidden input
            const hiddenInput = li.querySelector('input[type="hidden"].input-money');
            if (hiddenInput && hiddenInput.value) {
                return parseInt(hiddenInput.value, 10);
            }

            // Fallback: parse the displayed balance text
            const balanceWrap = li.querySelector('[class*="editBalanceWrap"]');
            if (balanceWrap) {
                const balanceText = balanceWrap.childNodes[0];
                if (balanceText && balanceText.nodeType === Node.TEXT_NODE) {
                    const cleaned = balanceText.textContent.replace(/[$,\s]/g, '');
                    const val = parseInt(cleaned, 10);
                    if (!isNaN(val)) return val;
                }
            }
        }

        return null;
    }

    function getGiveAmount() {
        const container = document.getElementById('option-give-to-user');
        if (!container) return null;

        // The give form has its own input-money-group (not inside the depositor list)
        // Find the form area - it contains the radio buttons and the money input
        const radioGroup = container.querySelector('[role="radiogroup"]');
        if (!radioGroup) return null;

        // The money input is a sibling area to the radio group, within the same form
        // Look for the hidden input-money that's NOT inside a list item
        const allMoneyInputs = container.querySelectorAll('input[type="hidden"].input-money');
        for (const input of allMoneyInputs) {
            // Skip inputs inside the depositor list (those are individual balances)
            if (input.closest('li')) continue;
            if (input.value) {
                return parseInt(input.value, 10);
            }
        }

        return null;
    }

    function isGivingMoney() {
        // "Give money" vs "Add to balance"
        const giveRadio = document.getElementById('give-money');
        if (giveRadio) return giveRadio.checked;

        // Fallback: if we can't find the radio, assume giving money (safer to warn)
        const addRadio = document.getElementById('add-money-to-balance');
        if (addRadio) return !addRadio.checked;

        return true;
    }

    function interceptSubmit() {
        if (interceptActive) return;

        const container = document.getElementById('option-give-to-user');
        if (!container) return;

        const submitBtn = container.querySelector('button[type="submit"].torn-btn');
        if (!submitBtn) return;

        // Mark as intercepted to avoid double-binding
        if (submitBtn.dataset.vaultCatcher) return;
        submitBtn.dataset.vaultCatcher = 'true';
        interceptActive = true;

        debugLog('Submit button intercepted');

        submitBtn.addEventListener('click', function (e) {
            // Only check when giving money (not adding to balance)
            if (!isGivingMoney()) {
                debugLog('Adding to balance - no check needed');
                return;
            }

            const amount = getGiveAmount();
            const balance = getSelectedBalance();

            debugLog('Amount:', amount, 'Balance:', balance);

            if (amount === null || balance === null || isNaN(amount) || isNaN(balance)) {
                debugLog('Could not determine amount or balance');
                return; // Don't block if we can't determine values
            }

            if (amount > balance) {
                e.preventDefault();
                e.stopImmediatePropagation();

                const formattedAmount = '$' + amount.toLocaleString();
                const formattedBalance = '$' + balance.toLocaleString();

                const proceed = confirm(
                    'Vault Catcher Warning!\n\n' +
                    'You are giving ' + formattedAmount + ' but this member\'s vault balance is only ' + formattedBalance + '.\n\n' +
                    'This means ' + '$' + (amount - balance).toLocaleString() + ' will come from faction funds.\n\n' +
                    'Do you want to continue?'
                );

                if (proceed) {
                    // Temporarily remove our listener to allow the click through
                    submitBtn.dataset.vaultCatcherBypass = 'true';
                    submitBtn.click();
                    delete submitBtn.dataset.vaultCatcherBypass;
                }
            }
        }, true); // Capture phase to run before Torn's handlers
    }

    // Watch for the give-to-user tab to load
    function init() {
        if (!isGiveToUserTab()) return;

        interceptActive = false;
        interceptSubmit();

        if (!interceptActive) {
            // DOM not ready yet, observe for changes
            const observer = new MutationObserver(function () {
                if (interceptActive) {
                    observer.disconnect();
                    return;
                }
                interceptSubmit();
            });

            const target = document.getElementById('option-give-to-user') || document.getElementById('faction-controls');
            if (target) {
                observer.observe(target, { childList: true, subtree: true });
            } else {
                // Faction controls not loaded yet, watch body briefly
                observer.observe(document.body, { childList: true, subtree: true });
                setTimeout(function () { observer.disconnect(); }, 15000);
            }
        }
    }

    // Run on page load and hash changes (SPA navigation)
    window.addEventListener('hashchange', function () {
        interceptActive = false;
        setTimeout(init, 500);
    });

    // Initial run
    setTimeout(init, 500);
})();
