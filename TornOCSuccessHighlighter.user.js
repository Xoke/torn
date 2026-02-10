// ==UserScript==
// @name         Torn OC Success Highlighter
// @namespace    https://xoke.org/
// @version      1.7
// @description  Highlights OC participants with under 70% success rate for levels 2-6
// @author       Xoke
// @match        https://www.torn.com/factions.php*
// @homepageURL  https://github.com/Xoke/torn
// @updateURL    https://raw.githubusercontent.com/Xoke/torn/main/TornOCSuccessHighlighter.meta.js
// @downloadURL  https://raw.githubusercontent.com/Xoke/torn/main/TornOCSuccessHighlighter.user.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const SUCCESS_THRESHOLD = 70;
    const MIN_LEVEL = 2;
    const MAX_LEVEL = 6;
    const HIGHLIGHT_BORDER = '4px solid #ff0000';
    const HIGHLIGHT_OUTLINE = '2px solid #ffff00';
    const HIGHLIGHT_BOX_SHADOW = '0 0 10px 3px rgba(255, 0, 0, 0.8)';

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

    // Main function to highlight low success slots
    function highlightLowSuccessSlots() {
        // Find all slot wrappers - class pattern: wrapper___XXXXX with success color class
        const slots = document.querySelectorAll('[class*="wrapper___"][class*="success"]');

        slots.forEach(slot => {
            // Skip if not a slot wrapper (check for slotHeader inside)
            if (!slot.querySelector('[class*="slotHeader___"]')) return;

            // Check if already processed
            const isHighlighted = slot.dataset.ocHighlighted === 'true';
            const wasChecked = slot.dataset.ocChecked === 'true';

            // Get crime level
            const level = getCrimeLevel(slot);
            if (level === null) return;

            // Skip if not in target level range (2-6)
            if (level < MIN_LEVEL || level > MAX_LEVEL) {
                if (isHighlighted) {
                    slot.style.removeProperty('border');
                    slot.style.removeProperty('outline');
                    slot.style.removeProperty('box-shadow');
                    slot.dataset.ocHighlighted = 'false';
                }
                return;
            }

            // Only highlight slots with actual players
            if (!hasPlayer(slot)) {
                if (isHighlighted) {
                    slot.style.removeProperty('border');
                    slot.style.removeProperty('outline');
                    slot.style.removeProperty('box-shadow');
                    slot.dataset.ocHighlighted = 'false';
                }
                return;
            }

            // Get success rate
            const successRate = getSuccessRate(slot);
            if (successRate === null) return;

            // Highlight if below threshold using inline styles
            if (successRate < SUCCESS_THRESHOLD) {
                if (!isHighlighted) {
                    slot.style.setProperty('border', HIGHLIGHT_BORDER, 'important');
                    slot.style.setProperty('outline', HIGHLIGHT_OUTLINE, 'important');
                    slot.style.setProperty('box-shadow', HIGHLIGHT_BOX_SHADOW, 'important');
                    slot.dataset.ocHighlighted = 'true';
                    console.log(`Highlighted slot: Level ${level}, Success ${successRate}%`);
                }
            } else {
                if (isHighlighted) {
                    slot.style.removeProperty('border');
                    slot.style.removeProperty('outline');
                    slot.style.removeProperty('box-shadow');
                    slot.dataset.ocHighlighted = 'false';
                }
            }
            slot.dataset.ocChecked = 'true';
        });
    }

    // Initialize with retry logic for dynamic content
    let initRetryCount = 0;
    const MAX_INIT_RETRIES = 40;

    function initialize() {
        // Look for the faction crimes root
        const crimesRoot = document.querySelector('#faction-crimes-root, [class*="scenario___"]');

        if (!crimesRoot) {
            initRetryCount++;
            if (initRetryCount < MAX_INIT_RETRIES) {
                setTimeout(initialize, 500);
            } else {
                console.log('Torn OC Success Highlighter: OC elements not found');
            }
            return;
        }

        console.log('Torn OC Success Highlighter: Initialized');

        // Initial highlight
        highlightLowSuccessSlots();

        // Set up MutationObserver for dynamic updates
        const observer = new MutationObserver((mutations) => {
            // Debounce updates
            clearTimeout(window.ocHighlighterTimeout);
            window.ocHighlighterTimeout = setTimeout(highlightLowSuccessSlots, 100);
        });

        // Observe the faction crimes container
        const container = document.querySelector('#faction-crimes, .faction-crimes-wrap, #faction-crimes-root');
        if (container) {
            observer.observe(container, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class']
            });
        }

        // Also observe body for SPA navigation
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    // Start when page is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

})();
