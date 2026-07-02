// ==UserScript==
// @name         Torn OC Recommender
// @namespace    https://xoke.org/
// @version      2.4
// @run-at       document-end
// @description  Recommends the best OC to join based on your success rates
// @author       Xoke
// @match        https://www.torn.com/factions.php*
// @homepageURL  https://github.com/Xoke/torn
// @updateURL    https://raw.githubusercontent.com/Xoke/torn/main/TornOCRecommender.meta.js
// @downloadURL  https://raw.githubusercontent.com/Xoke/torn/main/TornOCRecommender.user.js
// @grant        GM_getValue
// ==/UserScript==

(function() {
    'use strict';

    const DEBUG = false;

    function debugLog(...args) {
        if (DEBUG) console.log('[OC Recommender]', ...args);
    }

    // Shared threshold config, written by TornOCSuccessHighlighter. GM_* storage is
    // namespaced per script, so the Highlighter mirrors its config to localStorage
    // (shared across all scripts on torn.com) and we read it from there.
    const DEFAULT_THRESHOLDS = { 1: 0, 2: 70, 3: 70, 4: 70, 5: 70, 6: 70, 7: 60, 8: 60, 9: 60, 10: 60 };
    let thresholds = Object.assign({}, DEFAULT_THRESHOLDS);
    let remoteConfig = {};
    let useRemoteConfig = true;

    function readSharedValue(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    }

    function loadThresholds() {
        const saved = readSharedValue('oc_thresholds');
        if (!saved) return;
        try {
            const parsed = JSON.parse(saved);
            for (let lvl = 1; lvl <= 10; lvl++) {
                if (typeof parsed[lvl] === 'number') thresholds[lvl] = parsed[lvl];
            }
        } catch (e) {}
    }

    function loadCachedRemoteConfig() {
        const cached = readSharedValue('oc_remote_config');
        if (!cached) return;
        try { remoteConfig = JSON.parse(cached); } catch (e) {}
    }

    function loadUseRemoteConfig() {
        const saved = readSharedValue('oc_use_remote_config');
        if (saved === null) return;
        try { useRemoteConfig = JSON.parse(saved) === true; } catch (e) {}
    }

    loadThresholds();
    loadCachedRemoteConfig();
    loadUseRemoteConfig();

    const CLOSE_ENOUGH_PCT = 5;

    // Styling for primary recommendation
    const RECOMMEND_BORDER = '4px solid #00ff00';
    const RECOMMEND_OUTLINE = '2px solid #00ffff';
    const RECOMMEND_BOX_SHADOW = '0 0 15px 5px rgba(0, 255, 0, 0.6)';

    // Styling for secondary recommendations
    const SECONDARY_BORDER = '3px solid #ffaa00';
    const SECONDARY_OUTLINE = '2px solid #ffcc44';
    const SECONDARY_BOX_SHADOW = '0 0 10px 3px rgba(255, 170, 0, 0.4)';

    // Traverse up from el to find the OC crime card (data-oc-id ancestor)
    function getOCCard(el) {
        let parent = el.parentElement;
        while (parent && !parent.hasAttribute('data-oc-id')) {
            parent = parent.parentElement;
            if (!parent || parent === document.body) return null;
        }
        return parent;
    }

    // Get crime level from a slot element
    function getCrimeLevel(slotElement) {
        const card = getOCCard(slotElement);
        if (!card) return null;
        const levelEl = card.querySelector('[class*="levelValue___"]');
        if (!levelEl) return null;
        const level = parseInt(levelEl.textContent.trim(), 10);
        return isNaN(level) ? null : level;
    }

    // Get crime name from a crime card
    function getCrimeName(crimeCard) {
        if (!crimeCard) return null;
        const nameEl = crimeCard.querySelector('[class*="panelTitle___"]') ||
                       crimeCard.querySelector('[class*="title___"]') ||
                       crimeCard.querySelector('[class*="name___"]') ||
                       crimeCard.querySelector('[class*="crimeName___"]');
        return nameEl ? nameEl.textContent.trim() : null;
    }

    // Get position name from a slot, normalized to match remote config format (strip #)
    function getPositionName(slotElement) {
        const nameEl = slotElement.querySelector('[class*="roleName___"]') ||
                       slotElement.querySelector('[class*="positionName___"]') ||
                       slotElement.querySelector('[class*="slotName___"]');
        let name = null;
        if (nameEl) {
            name = nameEl.textContent.trim();
        } else {
            const header = slotElement.querySelector('[class*="slotHeader___"]');
            if (header) {
                const walker = document.createTreeWalker(header, NodeFilter.SHOW_TEXT);
                const node = walker.nextNode();
                name = node ? node.textContent.trim() : null;
            }
        }
        if (!name) return null;
        return name.replace(/#/g, '').replace(/\s+/g, ' ').trim();
    }

    // Resolve threshold using same fallback chain as TornOCSuccessHighlighter:
    // 1. remoteConfig[crimeName][positionName]  2. thresholds[level]
    function getThreshold(level, crimeCard, slotElement) {
        if (useRemoteConfig) {
            const crimeName = getCrimeName(crimeCard);
            const positionName = getPositionName(slotElement);
            if (crimeName && positionName && remoteConfig[crimeName]) {
                const posThreshold = remoteConfig[crimeName][positionName];
                if (typeof posThreshold === 'number') return posThreshold;
            }
        }
        return thresholds[level] ?? 0;
    }

    // Get crime card element from a slot
    function getCrimeCard(slotElement) {
        return getOCCard(slotElement);
    }

    // Check if slot is empty (waiting for someone to join)
    function isEmptySlot(slotElement) {
        return (slotElement.getAttribute('class') || '').includes('waitingJoin');
    }

    // Count how many slots in a crime card are already filled
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

    // Get time remaining on an OC's countdown timer — returns total seconds, or Infinity
    function getTimeRemaining(crimeCard) {
        if (!crimeCard) return Infinity;
        const text = crimeCard.textContent;
        const match = text.match(/(\d+):(\d{2}):(\d{2}):(\d{2})/);
        if (!match) return Infinity;
        const days = parseInt(match[1], 10) || 0;
        const hours = parseInt(match[2], 10) || 0;
        const minutes = parseInt(match[3], 10) || 0;
        const seconds = parseInt(match[4], 10) || 0;
        return days * 86400 + hours * 3600 + minutes * 60 + seconds;
    }

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

    // Get role name from slot (for display in label)
    function getRoleName(slotElement) {
        const titleEl = slotElement.querySelector('[class*="title___"]');
        return titleEl ? titleEl.textContent.trim() : 'Unknown Role';
    }

    // Check if the current player is already in an active OC
    function isPlayerInOC() {
        const ocLink = document.querySelector('[class*="icon89___"] a');
        if (!ocLink) return false;
        const label = ocLink.getAttribute('aria-label') || '';
        return label.startsWith('Organized Crime:') && label.includes(' in ');
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
            if (level === null || successRate === null) return;

            const crimeCard = getCrimeCard(slot);
            const threshold = getThreshold(level, crimeCard, slot);

            joinableSlots.push({
                element: slot,
                crimeCard,
                level,
                successRate,
                threshold,
                crimeName: getCrimeName(crimeCard) || 'Unknown',
                roleName: getRoleName(slot),
                filledSlots: getFilledSlotCount(crimeCard),
                timeRemaining: getTimeRemaining(crimeCard),
                meetsThreshold: threshold === 0 || successRate >= threshold,
            });
        });

        return joinableSlots;
    }

    const MAX_RECOMMENDATIONS = 3;

    // Find recommended OCs — returns { primary, secondary[] }
    function findRecommendedOCs(slots) {
        if (slots.length === 0) return { primary: null, secondary: [] };

        // Qualifying slots are those meeting their configured threshold
        let qualifying = slots.filter(s => s.meetsThreshold);

        // Fallback: level 1 slots (threshold 0 means always OK, but be explicit)
        if (qualifying.length === 0) {
            qualifying = slots.filter(s => s.level === 1);
        }

        if (qualifying.length === 0) return { primary: null, secondary: [] };

        // Sort: level desc, then if rates are close prefer urgency + filled slots, then success rate
        qualifying.sort((a, b) => {
            if (b.level !== a.level) return b.level - a.level;
            const closeEnough = Math.abs(a.successRate - b.successRate) <= CLOSE_ENOUGH_PCT;
            if (closeEnough) {
                if (a.timeRemaining !== b.timeRemaining) return a.timeRemaining - b.timeRemaining;
                if (b.filledSlots !== a.filledSlots) return b.filledSlots - a.filledSlots;
            }
            return b.successRate - a.successRate;
        });

        // Only show slots at the same level as the best one, capped at MAX_RECOMMENDATIONS
        const bestLevel = qualifying[0].level;
        const results = qualifying.filter(s => s.level === bestLevel).slice(0, MAX_RECOMMENDATIONS);

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
            if (getComputedStyle(element).position === 'static') {
                element.style.position = 'relative';
            }
            element.appendChild(label);
        }
    }

    // Main function
    function updateRecommendations() {
        try {
            clearRecommendations();

            if (isPlayerInOC()) {
                debugLog('Player is already in an OC, skipping recommendations');
                return;
            }

            const joinableSlots = analyzeJoinableSlots();

            if (joinableSlots.length === 0) {
                debugLog('No joinable slots found');
                return;
            }

            debugLog('Found', joinableSlots.length, 'joinable slots');

            const { primary, secondary } = findRecommendedOCs(joinableSlots);

            if (primary) {
                debugLog('Best OC: Level', primary.level, primary.crimeName, '-', primary.roleName, '(' + primary.successRate + '%, threshold ' + primary.threshold + '%, ' + primary.filledSlots + ' filled, ' + formatTime(primary.timeRemaining) + ' left)');
                applyRecommendation(primary, true);

                secondary.forEach(slot => {
                    debugLog('Also recommended: Level', slot.level, slot.crimeName, '-', slot.roleName, '(' + slot.successRate + '%, threshold ' + slot.threshold + '%, ' + slot.filledSlots + ' filled, ' + formatTime(slot.timeRemaining) + ' left)');
                    applyRecommendation(slot, false);
                });
            } else {
                debugLog('No suitable OC found');
            }
        } catch (error) {
            debugLog('Error in updateRecommendations:', error);
            clearRecommendations();
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
                debugLog('OC elements not found after', MAX_INIT_RETRIES, 'retries');
            }
            return;
        }

        debugLog('Initialized');

        updateRecommendations();

        let debounceTimeout = null;
        const observer = new MutationObserver(() => {
            clearTimeout(debounceTimeout);
            debounceTimeout = setTimeout(updateRecommendations, 200);
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

        if (!container) {
            const fallback = document.querySelector('#factions-page');
            observer.observe(fallback || document.body, {
                childList: true,
                subtree: !!fallback
            });
        }

        window.addEventListener('beforeunload', () => {
            clearTimeout(debounceTimeout);
            observer.disconnect();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

})();
