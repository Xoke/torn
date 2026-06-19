// ==UserScript==
// @name         Torn Vault Catcher
// @namespace    https://xoke.org/
// @version      2.1
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

    function showNotification(message, type) {
        const notification = document.createElement('div');
        notification.style.cssText =
            'position:fixed;top:20px;right:20px;z-index:99999;' +
            'padding:10px 16px;border-radius:5px;font-size:12px;font-weight:bold;' +
            'background:' + (type === 'error' ? '#c0392b' : '#2980b9') + ';' +
            'color:white;box-shadow:0 2px 8px rgba(0,0,0,0.4);transition:opacity 0.3s;';
        notification.textContent = message;
        document.body.appendChild(notification);
        setTimeout(function() {
            notification.style.opacity = '0';
            setTimeout(function() { notification.remove(); }, 300);
        }, 3000);
    }

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

    function setMoneyInput(value) {
        const container = document.getElementById('option-give-to-user');
        if (!container) return;

        // Find visible and hidden money inputs (not inside depositor list)
        const allVisible = container.querySelectorAll('input.input-money:not([type="hidden"])');
        const allHidden = container.querySelectorAll('input[type="hidden"].input-money');

        let visibleInput = null;
        let hiddenInput = null;
        for (const input of allVisible) {
            if (!input.closest('li')) { visibleInput = input; break; }
        }
        for (const input of allHidden) {
            if (!input.closest('li')) { hiddenInput = input; break; }
        }

        const formatted = '$' + value.toLocaleString();

        // Use React's native setter to trigger change detection
        var nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value'
        ).set;

        if (visibleInput) {
            nativeSetter.call(visibleInput, formatted);
            visibleInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (hiddenInput) {
            nativeSetter.call(hiddenInput, String(value));
            hiddenInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }

    function addFillBalanceButton() {
        const container = document.getElementById('option-give-to-user');
        if (!container) return;
        if (container.querySelector('.vault-catcher-fill-btn')) return;

        // Find the money input group by anchoring to the give-money radio button.
        // Both the money and points panels share the same .input-money-group class,
        // so grabbing the first match is ambiguous after a re-render. Walking up from
        // the radio button guarantees we stay in the correct (money) panel.
        var moneyGroup = null;
        const radioAnchor = document.getElementById('give-money') ||
                            document.getElementById('add-money-to-balance');
        if (radioAnchor) {
            let el = radioAnchor.parentElement;
            while (el && el !== container) {
                const group = el.querySelector('.input-money-group');
                if (group && !group.closest('li')) { moneyGroup = group; break; }
                el = el.parentElement;
            }
        }
        // If radio buttons aren't present (e.g. confirm dialog is showing, or React
        // mid-render), bail out. The observer will retry once the form stabilises.
        if (!moneyGroup) return;

        // Make the group a positioning context for the inset button
        moneyGroup.style.position = 'relative';

        // Add right padding to the visible input so text doesn't slide under the button
        var visibleInput = moneyGroup.querySelector('input.input-money:not([type="hidden"])');
        if (visibleInput) visibleInput.style.paddingRight = '36px';

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'vault-catcher-fill-btn';
        btn.textContent = 'Bal';
        btn.style.cssText =
            'position: absolute; right: 0; top: 0; bottom: 0; ' +
            'padding: 0 8px; font-size: 11px; cursor: pointer; ' +
            'background: #2980b9; color: white; border: none; border-radius: 0 3px 3px 0; ' +
            'z-index: 1;';

        btn.addEventListener('mouseenter', function () { btn.style.background = '#3498db'; });
        btn.addEventListener('mouseleave', function () { btn.style.background = '#2980b9'; });

        btn.addEventListener('click', function (e) {
            e.preventDefault();
            var balance = getSelectedBalance();
            if (balance === null || isNaN(balance)) {
                showNotification('Could not determine the selected member\'s vault balance.', 'error');
                return;
            }
            if (balance <= 0) {
                showNotification('This member has no vault balance.', 'error');
                return;
            }
            setMoneyInput(balance);
        });

        moneyGroup.appendChild(btn);
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

        addFillBalanceButton();

        // Watch for React re-renders that destroy our button (e.g. user selection).
        // Debounce so we wait for React to finish before trying to re-add.
        var fillBtnTimer = null;
        var btnObserver = new MutationObserver(function () {
            if (!container.querySelector('.vault-catcher-fill-btn')) {
                clearTimeout(fillBtnTimer);
                fillBtnTimer = setTimeout(addFillBalanceButton, 300);
            }
        });
        btnObserver.observe(container, { childList: true, subtree: true });

        window.addEventListener('beforeunload', function () { btnObserver.disconnect(); });

        submitBtn.addEventListener('click', function (e) {
            if (submitBtn.dataset.vaultCatcherBypass) return;
            // Only check when giving money (not adding to balance)
            if (!isGivingMoney()) return;

            const amount = getGiveAmount();
            const balance = getSelectedBalance();

            if (amount === null || balance === null || isNaN(amount) || isNaN(balance)) {
                return;
            }

            if (amount > balance) {
                e.preventDefault();
                e.stopImmediatePropagation();

                // Format numbers only for display (no raw DOM text in confirm)
                function formatCurrency(n) {
                    var num = Number(n);
                    if (isNaN(num) || num < 0) return '$0';
                    return '$' + Math.floor(num).toLocaleString();
                }
                var formattedAmount = formatCurrency(amount);
                var formattedBalance = formatCurrency(balance);
                var fromFunds = formatCurrency(amount - balance);

                const proceed = confirm(
                    'Vault Catcher Warning!\n\n' +
                    'You are giving ' + formattedAmount + ' but this member\'s vault balance is only ' + formattedBalance + '.\n\n' +
                    'This means ' + fromFunds + ' will come from faction funds.\n\n' +
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
            let debounceTimer = null;
            const observer = new MutationObserver(function () {
                if (interceptActive) {
                    observer.disconnect();
                    return;
                }
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(interceptSubmit, 300);
            });

            const target = document.getElementById('option-give-to-user') || document.getElementById('faction-controls') || document.querySelector('#factions-page');
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
