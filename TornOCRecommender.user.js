// ==UserScript==
// @name         Torn OC Recommender
// @namespace    https://xoke.org/
// @version      1.0
// @description  Recommends the best OC to join based on your success rates
// @author       Xoke
// @match        https://www.torn.com/factions.php*
// @homepageURL  https://xoke.org/
// @updateURL    https://xoke.org/TornOCRecommender.meta.js
// @downloadURL  https://xoke.org/TornOCRecommender.user.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Thresholds
    const THRESHOLD_LEVEL_2_6 = 70;  // Level 2-6 need 70%+
    const THRESHOLD_LEVEL_7_PLUS = 50;  // Level 7+ need 50%+

    // Styling for recommendations
    const RECOMMEND_BORDER = '4px solid #00ff00';
    const RECOMMEND_OUTLINE = '2px solid #00ffff';
    const RECOMMEND_BOX_SHADOW = '0 0 15px 5px rgba(0, 255, 0, 0.6)';

    // Get crime level from a slot element
    function getCrimeLevel(slotElement) {
        let parent = slotElement.parentElement;
        while (parent && !parent.hasAttribute('data-oc-id')) {
            parent = parent.parentElement;
            if (!parent || parent === document.body) return null;
        }
        if (!parent) return null;

        const levelEl = parent.querySelector('[class*="levelValue___"]');
        if (!levelEl) return null;

        const level = parseInt(levelEl.textContent.trim(), 10);
        return isNaN(level) ? null : level;
    }

    // Get crime name from a slot element
    function getCrimeName(slotElement) {
        let parent = slotElement.parentElement;
        while (parent && !parent.hasAttribute('data-oc-id')) {
            parent = parent.parentElement;
            if (!parent || parent === document.body) return null;
        }
        if (!parent) return null;

        const nameEl = parent.querySelector('[class*="panelTitle___"]');
        return nameEl ? nameEl.textContent.trim() : 'Unknown';
    }

    // Get crime card element from a slot
    function getCrimeCard(slotElement) {
        let parent = slotElement.parentElement;
        while (parent && !parent.hasAttribute('data-oc-id')) {
            parent = parent.parentElement;
            if (!parent || parent === document.body) return null;
        }
        return parent;
    }

    // Check if slot is empty (waiting for someone to join)
    function isEmptySlot(slotElement) {
        return slotElement.className.includes('waitingJoin');
    }

    // Get success rate from slot
    function getSuccessRate(slotElement) {
        const successEl = slotElement.querySelector('[class*="successChance___"]');
        if (!successEl) return null;

        const rate = parseInt(successEl.textContent.trim(), 10);
        return isNaN(rate) ? null : rate;
    }

    // Get role name from slot
    function getRoleName(slotElement) {
        const titleEl = slotElement.querySelector('[class*="title___"]');
        return titleEl ? titleEl.textContent.trim() : 'Unknown Role';
    }

    // Check if slot meets threshold for its level
    function meetsThreshold(level, successRate) {
        if (level >= 7) {
            return successRate >= THRESHOLD_LEVEL_7_PLUS;
        } else if (level >= 2) {
            return successRate >= THRESHOLD_LEVEL_2_6;
        } else {
            // Level 1 - always OK as fallback
            return true;
        }
    }

    // Find all joinable slots and analyze them
    function analyzeJoinableSlots() {
        const slots = document.querySelectorAll('[class*="wrapper___"][class*="success"]');
        const joinableSlots = [];

        slots.forEach(slot => {
            if (!slot.querySelector('[class*="slotHeader___"]')) return;
            if (!isEmptySlot(slot)) return;

            const level = getCrimeLevel(slot);
            const successRate = getSuccessRate(slot);
            const crimeName = getCrimeName(slot);
            const roleName = getRoleName(slot);
            const crimeCard = getCrimeCard(slot);

            if (level === null || successRate === null) return;

            joinableSlots.push({
                element: slot,
                crimeCard: crimeCard,
                level: level,
                successRate: successRate,
                crimeName: crimeName,
                roleName: roleName,
                meetsThreshold: meetsThreshold(level, successRate)
            });
        });

        return joinableSlots;
    }

    // Find the best OC to recommend
    function findBestOC(slots) {
        if (slots.length === 0) return null;

        // Group by level
        const byLevel = {};
        slots.forEach(slot => {
            if (!byLevel[slot.level]) byLevel[slot.level] = [];
            byLevel[slot.level].push(slot);
        });

        // Check if user qualifies for Level 7+
        // They need 50%+ in a Level 7+ slot AND should be 70%+ capable in Level 2-6
        const level7PlusSlots = slots.filter(s => s.level >= 7 && s.successRate >= THRESHOLD_LEVEL_7_PLUS);

        // Check if they're "high level" - meaning they have 70%+ in all available Level 2-6 slots
        const level2to6Slots = slots.filter(s => s.level >= 2 && s.level <= 6);
        const allLevel2to6Meet70 = level2to6Slots.length === 0 ||
            level2to6Slots.every(s => s.successRate >= THRESHOLD_LEVEL_2_6);

        // If they qualify for Level 7+ and are competent at Level 2-6, recommend highest Level 7+
        if (level7PlusSlots.length > 0 && allLevel2to6Meet70) {
            // Sort by level descending, then by success rate descending
            level7PlusSlots.sort((a, b) => {
                if (b.level !== a.level) return b.level - a.level;
                return b.successRate - a.successRate;
            });
            return level7PlusSlots[0];
        }

        // Otherwise, find highest Level 2-6 with 70%+
        const qualifyingSlots = slots.filter(s =>
            s.level >= 2 && s.level <= 6 && s.successRate >= THRESHOLD_LEVEL_2_6
        );

        if (qualifyingSlots.length > 0) {
            // Sort by level descending, then by success rate descending
            qualifyingSlots.sort((a, b) => {
                if (b.level !== a.level) return b.level - a.level;
                return b.successRate - a.successRate;
            });
            return qualifyingSlots[0];
        }

        // Fallback: recommend Level 1 if available
        const level1Slots = slots.filter(s => s.level === 1);
        if (level1Slots.length > 0) {
            level1Slots.sort((a, b) => b.successRate - a.successRate);
            return level1Slots[0];
        }

        return null;
    }

    // Clear all recommendations
    function clearRecommendations() {
        document.querySelectorAll('[data-oc-recommended="true"]').forEach(el => {
            el.style.removeProperty('border');
            el.style.removeProperty('outline');
            el.style.removeProperty('box-shadow');
            el.dataset.ocRecommended = 'false';
        });

        // Remove recommendation labels
        document.querySelectorAll('.oc-recommend-label').forEach(el => el.remove());
    }

    // Apply recommendation styling
    function applyRecommendation(slot) {
        const element = slot.element;

        element.style.setProperty('border', RECOMMEND_BORDER, 'important');
        element.style.setProperty('outline', RECOMMEND_OUTLINE, 'important');
        element.style.setProperty('box-shadow', RECOMMEND_BOX_SHADOW, 'important');
        element.dataset.ocRecommended = 'true';

        // Add a label if not already present
        if (!element.querySelector('.oc-recommend-label')) {
            const label = document.createElement('div');
            label.className = 'oc-recommend-label';
            label.style.cssText = `
                position: absolute;
                top: -20px;
                left: 50%;
                transform: translateX(-50%);
                background: #00ff00;
                color: #000;
                padding: 2px 8px;
                font-size: 10px;
                font-weight: bold;
                border-radius: 3px;
                z-index: 1000;
                white-space: nowrap;
            `;
            label.textContent = `★ JOIN THIS (Lv${slot.level} - ${slot.successRate}%)`;

            // Make sure parent has relative positioning
            if (getComputedStyle(element).position === 'static') {
                element.style.position = 'relative';
            }
            element.appendChild(label);
        }
    }

    // Main function
    function updateRecommendations() {
        clearRecommendations();

        const joinableSlots = analyzeJoinableSlots();

        if (joinableSlots.length === 0) {
            console.log('Torn OC Recommender: No joinable slots found');
            return;
        }

        console.log('Torn OC Recommender: Found', joinableSlots.length, 'joinable slots');

        const bestOC = findBestOC(joinableSlots);

        if (bestOC) {
            console.log(`Torn OC Recommender: Best OC is Level ${bestOC.level} "${bestOC.crimeName}" - ${bestOC.roleName} (${bestOC.successRate}%)`);
            applyRecommendation(bestOC);
        } else {
            console.log('Torn OC Recommender: No suitable OC found');
        }
    }

    // Initialize
    let initRetryCount = 0;
    const MAX_INIT_RETRIES = 40;

    function initialize() {
        const crimesRoot = document.querySelector('#faction-crimes-root, [class*="scenario___"]');

        if (!crimesRoot) {
            initRetryCount++;
            if (initRetryCount < MAX_INIT_RETRIES) {
                setTimeout(initialize, 500);
            } else {
                console.log('Torn OC Recommender: OC elements not found');
            }
            return;
        }

        console.log('Torn OC Recommender: Initialized');

        // Initial update
        updateRecommendations();

        // Set up MutationObserver
        const observer = new MutationObserver(() => {
            clearTimeout(window.ocRecommenderTimeout);
            window.ocRecommenderTimeout = setTimeout(updateRecommendations, 200);
        });

        const container = document.querySelector('#faction-crimes, .faction-crimes-wrap, #faction-crimes-root');
        if (container) {
            observer.observe(container, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class']
            });
        }

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

})();
