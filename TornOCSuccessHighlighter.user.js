// ==UserScript==
// @name         Torn OC Success Highlighter
// @namespace    https://xoke.org/
// @version      2.9
// @run-at       document-end
// @description  Highlights low success OC participants, stalled OCs, and missing items (with item name label)
// @author       Xoke
// @match        https://www.torn.com/factions.php*
// @homepageURL  https://github.com/Xoke/torn
// @updateURL    https://raw.githubusercontent.com/Xoke/torn/main/TornOCSuccessHighlighter.meta.js
// @downloadURL  https://raw.githubusercontent.com/Xoke/torn/main/TornOCSuccessHighlighter.user.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const DEBUG = false;

    function debugLog() {
        if (DEBUG) console.log.apply(console, ['[OC Highlighter]'].concat(Array.prototype.slice.call(arguments)));
    }

    const SUCCESS_THRESHOLD = 70;
    const MIN_LEVEL = 2;
    const MAX_LEVEL = 6;

    // Low success rate styling (red)
    const HIGHLIGHT_BORDER = '4px solid #ff0000';
    const HIGHLIGHT_OUTLINE = '2px solid #ffff00';
    const HIGHLIGHT_BOX_SHADOW = '0 0 10px 3px rgba(255, 0, 0, 0.8)';

    // Stalled/paused OC styling (orange)
    const STALLED_BORDER = '4px solid #ff8800';
    const STALLED_OUTLINE = '2px solid #ffcc00';
    const STALLED_BOX_SHADOW = '0 0 10px 3px rgba(255, 136, 0, 0.8)';

    // Missing item styling (purple)
    const MISSING_ITEM_BORDER = '4px solid #aa00ff';
    const MISSING_ITEM_OUTLINE = '2px solid #dd66ff';
    const MISSING_ITEM_BOX_SHADOW = '0 0 10px 3px rgba(170, 0, 255, 0.8)';

    // OC2 style application (reapplied every cycle via setProperty)

    // Find the crime level for a slot element by traversing up to find the crime card
    function getCrimeLevel(slotElement) {
        // Look for parent crime card with data-oc-id attribute
        let parent = slotElement.parentElement;
        while (parent && !parent.hasAttribute('data-oc-id')) {
            parent = parent.parentElement;
            if (!parent || parent === document.body) return null;
        }

        if (!parent) return null;

        // Find the level value within the crime card
        // Class pattern: levelValue___XXXXX
        const levelEl = parent.querySelector('[class*="levelValue___"]');
        if (!levelEl) return null;

        const level = parseInt(levelEl.textContent.trim(), 10);
        return isNaN(level) ? null : level;
    }

    // Check if a slot has a player assigned (not empty/waiting)
    function hasPlayer(slotElement) {
        // If it has validSlot class, it has a player
        const slotBody = slotElement.querySelector('[class*="slotBody___"]');
        if (!slotBody) return false;

        // Check for validSlot class (indicates filled slot)
        if (slotBody.className.includes('validSlot')) return true;

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

    // Get the crime card element from a child element
    function getCrimeCard(element) {
        let parent = element.parentElement;
        while (parent && !parent.hasAttribute('data-oc-id')) {
            parent = parent.parentElement;
            if (!parent || parent === document.body) return null;
        }
        return parent;
    }

    // Check if a crime card is paused/stalled
    function isCrimePaused(crimeCard) {
        if (!crimeCard) return false;
        if (crimeCard.querySelector('[class*="paused___"]')) return true;
        if (crimeCard.querySelector('[aria-label="paused"]')) return true;
        return false;
    }

    // Check if a slot has a missing item (new Torn UI uses inactive___ class on the slot icon)
    function hasMissingItem(slotElement) {
        return !!slotElement.querySelector('[class*="inactive___"]');
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

    // Briefly trigger a slot's tooltip to read "Used item: X", then dismiss it.
    // Returns a Promise<string> with the item name, or '?' if not found.
    function getItemName(slotHeader) {
        return new Promise(resolve => {
            slotHeader.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true }));
            slotHeader.dispatchEvent(new MouseEvent('mouseover',  { bubbles: true, cancelable: true }));
            setTimeout(() => {
                const tooltip = document.querySelector('[role="tooltip"]');
                let itemName = null;
                if (tooltip) {
                    const match = tooltip.textContent.match(/Used item:\s*(.+?)(?:\n|$)/);
                    if (match) itemName = match[1].trim();
                }
                slotHeader.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true, cancelable: true }));
                slotHeader.dispatchEvent(new MouseEvent('mouseout',   { bubbles: true, cancelable: true }));
                resolve(itemName || '?');
            }, 300);
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
    function applyHighlight(element, border, outline, boxShadow, tag) {
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
                applyHighlight(card, STALLED_BORDER, STALLED_OUTLINE, STALLED_BOX_SHADOW, 'stalled');
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

            if (hasDelay && row.className.includes('OC2-crimeID_')) {
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
                    applyHighlight(slot, MISSING_ITEM_BORDER, MISSING_ITEM_OUTLINE, MISSING_ITEM_BOX_SHADOW, 'missingItem');
                    debugLog('Missing item: Level', level);
                }
                return;
            }

            // Low success rate check only for level 2-6
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

            // Highlight if below threshold
            if (successRate < SUCCESS_THRESHOLD) {
                if (currentTag !== 'lowSuccess') {
                    applyHighlight(slot, HIGHLIGHT_BORDER, HIGHLIGHT_OUTLINE, HIGHLIGHT_BOX_SHADOW, 'lowSuccess');
                    debugLog('Low success slot: Level', level, 'Success', successRate + '%');
                }
            } else {
                if (currentTag === 'lowSuccess') clearHighlight(slot);
            }
        });
    }

    // Highlight unavailable members in the OC2 table view
    function highlightUnavailableMembers() {
        const oc2Root = document.querySelector('.OC2-memberViewer');
        if (!oc2Root) return;
        const memberRows = oc2Root.querySelectorAll('[class*="OC2-crimeMemberLi"]');

        memberRows.forEach(memberRow => {
            const statusCell = memberRow.querySelector('[class*="OC2-tableCrimeMemberStatus"]');
            if (!statusCell) return;

            const statusText = statusCell.textContent.trim().toLowerCase();
            const isUnavailable = statusText.includes('hospital') ||
                statusText.includes('traveling') ||
                statusText.includes('returning') ||
                statusText.includes('jail') ||
                statusText.includes('federal') ||
                statusText.includes('abroad') ||
                statusText.includes('flying');

            if (isUnavailable) {
                memberRow.style.setProperty('background-color', 'rgba(255, 50, 50, 0.25)', 'important');
                memberRow.style.setProperty('border-left', '4px solid #ff4444', 'important');
            }
        });
    }

    // Run all checks
    function runAllChecks() {
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

        // Initial highlight
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
