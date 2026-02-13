// ==UserScript==
// @name         Torn OC Recommender
// @namespace    https://xoke.org/
// @version      1.5
// @description  Recommends the best OC to join based on your success rates
// @author       Xoke
// @match        https://www.torn.com/factions.php*
// @homepageURL  https://github.com/Xoke/torn
// @updateURL    https://raw.githubusercontent.com/Xoke/torn/main/TornOCRecommender.meta.js
// @downloadURL  https://raw.githubusercontent.com/Xoke/torn/main/TornOCRecommender.user.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Thresholds
    const THRESHOLD_LEVEL_2_6 = 70;  // Level 2-6 need 70%+
    const THRESHOLD_LEVEL_7_PLUS = 50;  // Level 7+ need 50%+
    const PREFERRED_LEVEL_7_PLUS = 60;  // Level 7+ preferred 60%+
    const CLOSE_ENOUGH_PCT = 5;  // If success rates are within 5%, prefer OCs with more people

    // Styling for primary recommendation
    const RECOMMEND_BORDER = '4px solid #00ff00';
    const RECOMMEND_OUTLINE = '2px solid #00ffff';
    const RECOMMEND_BOX_SHADOW = '0 0 15px 5px rgba(0, 255, 0, 0.6)';

    // Styling for secondary recommendations
    const SECONDARY_BORDER = '3px solid #ffaa00';
    const SECONDARY_OUTLINE = '2px solid #ffcc44';
    const SECONDARY_BOX_SHADOW = '0 0 10px 3px rgba(255, 170, 0, 0.4)';

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

    // Count how many slots in a crime card are already filled (have people in them)
    function getFilledSlotCount(crimeCard) {
        if (!crimeCard) return 0;
        const allSlots = crimeCard.querySelectorAll('[class*="wrapper___"][class*="success"]');
        let filled = 0;
        allSlots.forEach(slot => {
            if (slot.querySelector('[class*="slotHeader___"]') && !isEmptySlot(slot)) {
                filled++;
            }
        });
        return filled;
    }

    // Get time remaining on an OC's countdown timer (DD:HH:MM:SS format)
    // Returns total seconds remaining, or Infinity if no timer found
    function getTimeRemaining(crimeCard) {
        if (!crimeCard) return Infinity;
        const text = crimeCard.textContent;
        const match = text.match(/(\d+):(\d{2}):(\d{2}):(\d{2})/);
        if (!match) return Infinity;
        const days = parseInt(match[1], 10);
        const hours = parseInt(match[2], 10);
        const minutes = parseInt(match[3], 10);
        const seconds = parseInt(match[4], 10);
        return days * 86400 + hours * 3600 + minutes * 60 + seconds;
    }

    // Format seconds back to readable time for logging
    function formatTime(totalSeconds) {
        if (totalSeconds === Infinity) return 'no timer';
        const d = Math.floor(totalSeconds / 86400);
        const h = Math.floor((totalSeconds % 86400) / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        return `${d}d ${h}h ${m}m`;
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

    // Get the current player's name from the page header
    function getCurrentPlayerName() {
        const nameLabel = document.querySelector('[class*="menu-name___"]');
        if (nameLabel && nameLabel.parentElement) {
            const honorText = nameLabel.parentElement.querySelector('.honor-text');
            if (honorText) return honorText.textContent.trim();
        }
        return null;
    }

    // Check if the current player is already in any OC
    function isPlayerInOC() {
        const playerName = getCurrentPlayerName();
        if (!playerName) return false;

        const crimeCards = document.querySelectorAll('[data-oc-id]');
        for (const card of crimeCards) {
            const slots = card.querySelectorAll('[class*="wrapper___"][class*="success"]');
            for (const slot of slots) {
                if (!slot.querySelector('[class*="slotHeader___"]')) continue;
                if (isEmptySlot(slot)) continue;
                const honorTexts = slot.querySelectorAll('.honor-text');
                for (const ht of honorTexts) {
                    if (ht.textContent.trim() === playerName) return true;
                }
            }
        }
        return false;
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

            const filledSlots = getFilledSlotCount(crimeCard);
            const timeRemaining = getTimeRemaining(crimeCard);

            joinableSlots.push({
                element: slot,
                crimeCard: crimeCard,
                level: level,
                successRate: successRate,
                crimeName: crimeName,
                roleName: roleName,
                filledSlots: filledSlots,
                timeRemaining: timeRemaining,
                meetsThreshold: meetsThreshold(level, successRate)
            });
        });

        return joinableSlots;
    }

    const MAX_RECOMMENDATIONS = 3;

    // Find recommended OCs - returns { primary, secondary[] }
    function findRecommendedOCs(slots) {
        if (slots.length === 0) return { primary: null, secondary: [] };

        let results = [];

        // Check if user qualifies for Level 7+
        // They need 50%+ in a Level 7+ slot AND 70%+ on ANY level 2-6 slot
        const level7PlusSlots = slots.filter(s => s.level >= 7 && s.successRate >= THRESHOLD_LEVEL_7_PLUS);
        const anyLevel2to6Meet70 = slots.some(s => s.level >= 2 && s.level <= 6 && s.successRate >= THRESHOLD_LEVEL_2_6);

        if (level7PlusSlots.length > 0 && anyLevel2to6Meet70) {
            // Sort: prefer 60%+ first, then level desc, then if close enough prefer urgency, then success rate
            level7PlusSlots.sort((a, b) => {
                const aPreferred = a.successRate >= PREFERRED_LEVEL_7_PLUS ? 1 : 0;
                const bPreferred = b.successRate >= PREFERRED_LEVEL_7_PLUS ? 1 : 0;
                if (bPreferred !== aPreferred) return bPreferred - aPreferred;
                if (b.level !== a.level) return b.level - a.level;
                const closeEnough = Math.abs(a.successRate - b.successRate) <= CLOSE_ENOUGH_PCT;
                if (closeEnough) {
                    if (a.timeRemaining !== b.timeRemaining) return a.timeRemaining - b.timeRemaining;
                    if (b.filledSlots !== a.filledSlots) return b.filledSlots - a.filledSlots;
                }
                return b.successRate - a.successRate;
            });
            results = level7PlusSlots;
        }

        // Fall back to qualifying Level 2-6 slots (70%+) if no level 7+ found
        if (results.length === 0) {
            const qualifyingSlots = slots.filter(s =>
                s.level >= 2 && s.level <= 6 && s.successRate >= THRESHOLD_LEVEL_2_6
            );
            if (qualifyingSlots.length > 0) {
                qualifyingSlots.sort((a, b) => {
                    if (b.level !== a.level) return b.level - a.level;
                    const closeEnough = Math.abs(a.successRate - b.successRate) <= CLOSE_ENOUGH_PCT;
                    if (closeEnough) {
                        if (a.timeRemaining !== b.timeRemaining) return a.timeRemaining - b.timeRemaining;
                        if (b.filledSlots !== a.filledSlots) return b.filledSlots - a.filledSlots;
                    }
                    return b.successRate - a.successRate;
                });
                results = qualifyingSlots;
            }
        }

        // Fallback: Level 1 slots
        if (results.length === 0) {
            const level1Slots = slots.filter(s => s.level === 1);
            if (level1Slots.length > 0) {
                level1Slots.sort((a, b) => {
                    const closeEnough = Math.abs(a.successRate - b.successRate) <= CLOSE_ENOUGH_PCT;
                    if (closeEnough) {
                        if (a.timeRemaining !== b.timeRemaining) return a.timeRemaining - b.timeRemaining;
                        if (b.filledSlots !== a.filledSlots) return b.filledSlots - a.filledSlots;
                    }
                    return b.successRate - a.successRate;
                });
                results = level1Slots;
            }
        }

        if (results.length === 0) return { primary: null, secondary: [] };

        // Only show slots at the same level as the best one, capped at MAX_RECOMMENDATIONS
        const bestLevel = results[0].level;
        results = results.filter(s => s.level === bestLevel).slice(0, MAX_RECOMMENDATIONS);

        return { primary: results[0], secondary: results.slice(1) };
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
    function applyRecommendation(slot, isPrimary) {
        const element = slot.element;

        if (isPrimary) {
            element.style.setProperty('border', RECOMMEND_BORDER, 'important');
            element.style.setProperty('outline', RECOMMEND_OUTLINE, 'important');
            element.style.setProperty('box-shadow', RECOMMEND_BOX_SHADOW, 'important');
        } else {
            element.style.setProperty('border', SECONDARY_BORDER, 'important');
            element.style.setProperty('outline', SECONDARY_OUTLINE, 'important');
            element.style.setProperty('box-shadow', SECONDARY_BOX_SHADOW, 'important');
        }
        element.dataset.ocRecommended = 'true';

        // Add a label if not already present
        if (!element.querySelector('.oc-recommend-label')) {
            const label = document.createElement('div');
            label.className = 'oc-recommend-label';
            const bgColor = isPrimary ? '#00ff00' : '#ffaa00';
            const labelText = isPrimary
                ? `★ BEST (Lv${slot.level} - ${slot.successRate}%)`
                : `Lv${slot.level} - ${slot.successRate}%`;
            label.style.cssText = `
                position: absolute;
                top: -20px;
                left: 50%;
                transform: translateX(-50%);
                background: ${bgColor};
                color: #000;
                padding: 2px 8px;
                font-size: 10px;
                font-weight: bold;
                border-radius: 3px;
                z-index: 1000;
                white-space: nowrap;
            `;
            label.textContent = labelText;

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

        if (isPlayerInOC()) {
            console.log('Torn OC Recommender: Already in an OC, skipping recommendations');
            return;
        }

        const joinableSlots = analyzeJoinableSlots();

        if (joinableSlots.length === 0) {
            console.log('Torn OC Recommender: No joinable slots found');
            return;
        }

        console.log('Torn OC Recommender: Found', joinableSlots.length, 'joinable slots');

        const { primary, secondary } = findRecommendedOCs(joinableSlots);

        if (primary) {
            console.log(`Torn OC Recommender: Best OC is Level ${primary.level} "${primary.crimeName}" - ${primary.roleName} (${primary.successRate}%, ${primary.filledSlots} filled, ${formatTime(primary.timeRemaining)} left)`);
            applyRecommendation(primary, true);

            secondary.forEach(slot => {
                console.log(`Torn OC Recommender: Also recommended: Level ${slot.level} "${slot.crimeName}" - ${slot.roleName} (${slot.successRate}%, ${slot.filledSlots} filled, ${formatTime(slot.timeRemaining)} left)`);
                applyRecommendation(slot, false);
            });
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
