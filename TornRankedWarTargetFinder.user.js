// ==UserScript==
// @name         Torn Ranked War Target Finder
// @namespace    https://xoke.org/
// @version      8.2
// @description  Find optimal targets for ranked wars with FF integration and chain monitoring
// @author       Xoke
// @match        https://www.torn.com/*
// @homepageURL  https://github.com/Xoke/torn
// @updateURL    https://raw.githubusercontent.com/Xoke/torn/main/TornRankedWarTargetFinder.meta.js
// @downloadURL  https://raw.githubusercontent.com/Xoke/torn/main/TornRankedWarTargetFinder.user.js
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function() {
    'use strict';

    // Configuration Constants
    var API_DELAY = 5000; // 5 seconds - very conservative (Torn allows 100 calls/min)
    var FETCH_TIMEOUT = 15000; // 15 second timeout for API requests
    var FILTER_DEBOUNCE_MS = 250;
    var BUTTON_DEBOUNCE_MS = 500;
    var IDLE_THRESHOLD_MINS = 5;
    var OFFLINE_THRESHOLD_MINS = 10;
    var HOSP_SOON_SECONDS = 300; // 5 minutes
    var MAX_API_RETRIES = 3;

    // Storage Keys
    var STORAGE_KEY = 'tornWarTargets';

    // State Variables
    var refreshInterval = null;
    var refreshInProgress = false;
    var targetsCache = null;
    var filterDebounceTimer = null;
    var buttonDebounceTimer = null; // Debounce timer for MutationObserver button
    var targetsLoaded = false; // Track if targets are currently loaded
    var chainData = null; // Cache for chain data
    var mutationObserver = null; // MutationObserver reference for cleanup
    var filterCache = null; // Cache DOM element references
    var retryCount = 0; // API retry counter

    console.log('[Torn War Targets] Script initialized');

    // Helper function for debouncing
    function debounce(func, wait) {
        var timeout;
        return function() {
            var context = this, args = arguments;
            clearTimeout(timeout);
            timeout = setTimeout(function() {
                func.apply(context, args);
            }, wait);
        };
    }

    // Helper function to escape HTML and prevent XSS
    function escapeHtml(unsafe) {
        if (typeof unsafe !== 'string') return String(unsafe);
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // Validate API key (16-character alphanumeric)
    function validateApiKey(key) {
        if (!key) return false;
        var cleaned = String(key).trim();
        return /^[a-zA-Z0-9]{16}$/.test(cleaned);
    }

    // Validate faction ID (numeric only)
    function validateFactionId(id) {
        if (!id) return false;
        var cleaned = String(id).trim();
        return /^\d+$/.test(cleaned) && parseInt(cleaned) > 0;
    }

    // Helper function to update status message
    function updateStatus(message, type) {
        var statusEl = document.getElementById('loading-status');
        if (!statusEl) return;
        statusEl.textContent = message;
        statusEl.style.color = type === 'error' ? '#ff4444' :
                               type === 'warning' ? '#ffaa00' : '#44ff44';
    }

    // Helper function to determine status state (used in multiple places)
    function determineStatusState(status, lastActionTimestamp) {
        var now = Math.floor(Date.now() / 1000);
        var state = (status && status.state) || 'unknown';
        var description = (status && status.description) || 'Unknown';

        // Detect foreign hospital (treat as traveling)
        if (state === 'hospital' && description.match(/in an? .+ hospital/i)) {
            return 'traveling';
        }

        // Online/Idle/Offline detection based on last action
        if (state === 'online' && description.toLowerCase() === 'okay') {
            var minsSince = Math.floor((now - (lastActionTimestamp || 0)) / 60);
            if (minsSince <= IDLE_THRESHOLD_MINS) return 'online';
            if (minsSince <= OFFLINE_THRESHOLD_MINS) return 'idle';
            return 'offline';
        }

        return state;
    }

    // Helper function for safe fetch with error handling and timeout
    function safeFetch(url) {
        var controller = new AbortController();
        var timeoutId = setTimeout(function() {
            controller.abort();
        }, FETCH_TIMEOUT);

        return fetch(url, { signal: controller.signal })
            .then(function(response) {
                if (!response.ok) {
                    throw new Error('HTTP ' + response.status + ': ' + response.statusText);
                }
                return response.json();
            })
            .catch(function(error) {
                if (error.name === 'AbortError') {
                    console.error('[Torn War Targets] Request timeout after', FETCH_TIMEOUT / 1000, 'seconds');
                    updateStatus('❌ Request timeout', 'error');
                    throw new Error('Request timeout');
                }
                console.error('[Torn War Targets] Fetch error:', error);
                updateStatus('❌ Error: ' + error.message, 'error');
                throw error;
            })
            .finally(function() {
                clearTimeout(timeoutId); // Always clear timeout
            });
    }

    // Helper function to get cached targets
    function getCachedTargets() {
        if (!targetsCache) {
            try {
                var stored = GM_getValue(STORAGE_KEY, '[]');
                targetsCache = JSON.parse(stored);
            } catch (e) {
                console.error('[Torn War Targets] Parse error:', e);
                targetsCache = [];
            }
        }
        return targetsCache;
    }

    // Helper function to save targets with caching
    function saveTargets(targets) {
        targetsCache = targets;
        GM_setValue(STORAGE_KEY, JSON.stringify(targets));
    }

    // Display or update chain status
    function displayChainStatus(chain) {
        var container = document.getElementById('chain-status-container');
        if (!container) return;

        chainData = chain; // Cache chain data

        if (!chain) {
            container.innerHTML = '<div class="chain-status chain-unknown">' +
                '<div class="chain-count">Chain: Unknown</div>' +
                '<div class="chain-detail">Enable auto-refresh with API key to monitor chain</div>' +
                '</div>';
            return;
        }

        var current = chain.current || 0;
        var timeout = chain.timeout || 0;
        var cooldown = chain.cooldown || 0;
        var max = chain.max || 0;

        // Determine chain state
        var state = 'inactive';
        var stateClass = 'chain-inactive';
        var timerText = '';

        if (current > 0 && timeout > 0) {
            state = 'active';
            stateClass = 'chain-active';
            timerText = 'Timeout: ' + formatTimeRemaining(timeout);
        } else if (current > 0 && cooldown > 0) {
            state = 'cooling';
            stateClass = 'chain-cooling';
            timerText = 'Cooldown: ' + formatTimeRemaining(cooldown);
        } else if (current === 0) {
            state = 'inactive';
            stateClass = 'chain-inactive';
            timerText = 'No active chain';
        } else {
            state = 'broken';
            stateClass = 'chain-broken';
            timerText = 'Chain broken';
        }

        container.innerHTML = '<div class="chain-status ' + stateClass + '">' +
            '<div class="chain-count">Chain: ' + current + (max > 0 ? ' / ' + max : '') + '</div>' +
            '<div class="chain-timer">' + timerText + '</div>' +
            '<div class="chain-state-indicator">' + state.toUpperCase() + '</div>' +
            '</div>';
    }

    // Format seconds into readable time (e.g., "2m 15s", "1h 30m")
    function formatTimeRemaining(seconds) {
        if (seconds <= 0) return '0s';

        var hours = Math.floor(seconds / 3600);
        var minutes = Math.floor((seconds % 3600) / 60);
        var secs = seconds % 60;

        var parts = [];
        if (hours > 0) parts.push(hours + 'h');
        if (minutes > 0) parts.push(minutes + 'm');
        if (secs > 0 && hours === 0) parts.push(secs + 's'); // Only show seconds if less than 1 hour

        return parts.join(' ') || '0s';
    }

    function addFactionButton() {
        if (!window.location.href.includes('factions.php')) return;
        if (document.querySelector('#war-targets-btn')) return;
        if (targetsLoaded) return; // Don't add button if targets are already loaded

        var titleArea = document.querySelector('.content-title');
        if (!titleArea) titleArea = document.querySelector('.title-black');
        if (!titleArea) titleArea = document.querySelector('.content-wrapper .title');
        if (!titleArea) titleArea = document.querySelector('h4');
        if (!titleArea) return;

        var urlParams = new URLSearchParams(window.location.search);
        var factionId = urlParams.get('ID') || urlParams.get('step');
        if (!factionId) return;

        var button = document.createElement('button');
        button.id = 'war-targets-btn';
        button.className = 'torn-btn';
        button.textContent = '⚔️ Load War Targets';
        button.style.marginLeft = '15px';
        button.style.padding = '8px 15px';

        button.addEventListener('click', function() {
            scrapeFactionPageData(factionId);
        });

        titleArea.appendChild(button);
    }

    function scrapeFactionPageData(factionId) {
        var button = document.getElementById('war-targets-btn');
        if (button) {
            button.disabled = true;
            button.textContent = 'Loading...';
        }

        var targets = [];
        var membersTable = document.querySelector('.members-list');

        if (!membersTable) {
            alert('Could not find faction members table.');
            if (button) {
                button.disabled = false;
                button.textContent = '⚔️ Load War Targets';
            }
            return;
        }

        var memberRows = membersTable.querySelectorAll('.table-row');

        for (var i = 0; i < memberRows.length; i++) {
            var row = memberRows[i];
            if (row.querySelector('.fallen, .fedded')) continue;

            var memberLink = row.querySelector('a[href*="profiles.php?XID="]');
            if (!memberLink) continue;

            var name = memberLink.textContent.trim();
            var idMatch = memberLink.href.match(/XID=(\d+)/);
            var userId = idMatch ? idMatch[1] : null;
            if (!userId) continue;

            var level = 0;
            var levelElements = row.querySelectorAll('.lvl');
            for (var j = 0; j < levelElements.length; j++) {
                var levelText = levelElements[j].textContent.trim();
                if (levelText.match(/^\d+$/) && !levelText.includes('FF')) {
                    level = parseInt(levelText);
                    break;
                }
            }

            var battleStats = '';
            var estVisible = row.querySelector('.ff-scouter-est-visible');
            var estHidden = row.querySelector('.ff-scouter-est-hidden');
            if (estVisible) {
                battleStats = estVisible.textContent.trim();
            } else if (estHidden) {
                battleStats = estHidden.textContent.trim();
            }

            var fairFight = null;
            var ffElements = row.querySelectorAll('.ff, [class*="ff-scouter"]');
            for (var k = 0; k < ffElements.length; k++) {
                var ffText = ffElements[k].textContent.trim();
                var ffMatch = ffText.match(/(\d+\.\d{1,3})/);
                if (ffMatch) {
                    var value = parseFloat(ffMatch[1]);
                    if (value >= 1.0 && value <= 5.0) {
                        fairFight = value;
                        break;
                    }
                }
            }

            var status = { state: 'unknown', description: 'Unknown' };
            var statusElement = row.querySelector('.status');
            if (statusElement) {
                var statusText = statusElement.textContent.trim();
                var statusLower = statusText.toLowerCase();
                var statusState = 'unknown';

                if (statusLower.includes('okay') || statusLower.includes('online')) {
                    statusState = 'online';
                } else if (statusLower.includes('hospital')) {
                    statusState = 'hospital';
                } else if (statusLower.includes('traveling') || statusLower.includes('abroad')) {
                    statusState = 'traveling';
                } else if (statusLower.includes('offline')) {
                    statusState = 'offline';
                } else if (statusLower.includes('jail')) {
                    statusState = 'jail';
                }

                status = { state: statusState, description: statusText };
            }

            var lastActionText = '';
            var timeElements = row.querySelectorAll('[class*="time"], .last-action');
            for (var m = 0; m < timeElements.length; m++) {
                var text = timeElements[m].textContent.trim();
                if (text.match(/^\d+[smhd]$/)) {
                    lastActionText = text;
                    break;
                }
            }

            targets.push({
                id: parseInt(userId),
                name: name,
                level: level,
                status: status,
                last_action: { timestamp: Date.now() / 1000, relative: lastActionText },
                fairFight: fairFight,
                estimate: battleStats
            });
        }

        if (targets.length === 0) {
            alert('Could not find member data.');
            return;
        }

        console.log('[Torn War Targets] Scraped', targets.length, 'targets from faction page');
        saveTargets(targets);
        GM_setValue('scrapedFactionId', factionId);

        // Mark targets as loaded to prevent button from reappearing
        targetsLoaded = true;

        showTargetsPage(factionId, targets);
    }

    function showTargetsPage(factionId, scrapedTargets) {
        // Disconnect MutationObserver when showing targets page to prevent memory leak
        disconnectFactionObserver();

        var content = document.querySelector('.content-wrapper[role="main"]');
        if (!content) content = document.querySelector('#mainContainer');
        if (!content) content = document.querySelector('.content'); // PDA fallback
        if (!content) content = document.body; // Last resort
        if (!content) return;

        // Don't pre-populate API key for security (only show placeholder if exists)
        var hasApiKey = GM_getValue('apiKey', '') !== '';
        var apiKeyPlaceholder = hasApiKey ? '16 chars (saved)' : 'Optional';
        var factionIdValue = factionId || '';
        var disabledAttr = factionId ? 'disabled' : '';

        var html = '<div class="war-targets-container">' +
            '<div class="content-title"><h4>Ranked War Targets</h4></div>' +
            '<div class="war-controls">' +
                '<div class="control-group">' +
                    '<label><input type="checkbox" id="filter-online" ' + (GM_getValue('filterOnline', false) ? 'checked' : '') + '> Online Only</label>' +
                    '<label><input type="checkbox" id="filter-offline" ' + (GM_getValue('filterOffline', false) ? 'checked' : '') + '> Offline Only</label>' +
                    '<label><input type="checkbox" id="hide-hospital" ' + (GM_getValue('hideHospital', false) ? 'checked' : '') + '> Hide Hospitalized</label>' +
                    '<label><input type="checkbox" id="hide-travelling" ' + (GM_getValue('hideTravelling', false) ? 'checked' : '') + '> Hide Travelling</label>' +
                    '<label><input type="checkbox" id="filter-hosp-soon" ' + (GM_getValue('filterHospSoon', false) ? 'checked' : '') + '> Hospital/OK < 5 min</label>' +
                '</div>' +
                '<div class="control-group">' +
                    '<label><input type="checkbox" id="enable-ff-filter" ' + (GM_getValue('enableFFFilter', false) ? 'checked' : '') + '> Filter Fair Fight:</label>' +
                    '<label>Min <input type="number" id="min-ff" value="' + (GM_getValue('minFF', '1.0')) + '" step="0.1" style="width: 60px;"></label>' +
                    '<label>Max <input type="number" id="max-ff" value="' + (GM_getValue('maxFF', '3.0')) + '" step="0.1" style="width: 60px;"></label>' +
                '</div>' +
                '<div class="control-group">' +
                    '<label><input type="checkbox" id="enable-stats-filter" ' + (GM_getValue('enableStatsFilter', false) ? 'checked' : '') + '> Filter Battle Stats:</label>' +
                    '<label>Min <input type="text" id="min-stats" placeholder="e.g. 1m" value="' + (GM_getValue('minStats', '')) + '" style="width: 70px;"></label>' +
                    '<label>Max <input type="text" id="max-stats" placeholder="e.g. 10m" value="' + (GM_getValue('maxStats', '')) + '" style="width: 70px;"></label>' +
                    '<label style="margin-left: 20px;"><input type="checkbox" id="auto-refresh" checked> Auto-refresh (5s)</label>' +
                    '<button id="toggle-advanced" class="torn-btn" style="margin-left: 20px;">⚙️ Advanced Settings</button>' +
                '</div>' +
                '<div id="advanced-settings" style="display: none; margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(128,128,128,0.3);">' +
                    '<div class="control-group">' +
                        '<label>API Key: <input type="password" id="api-key" placeholder="' + escapeHtml(apiKeyPlaceholder) + '"></label>' +
                        '<button id="save-api" class="torn-btn">Save</button>' +
                    '</div>' +
                    '<div class="control-group">' +
                        '<label>Faction ID: <input type="number" id="faction-id" placeholder="ID" value="' + escapeHtml(String(factionIdValue)) + '" ' + disabledAttr + '></label>' +
                        '<button id="load-faction" class="torn-btn">Refresh from API</button>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div id="chain-status-container"></div>' +
            '<div id="loading-status" style="margin: 10px 0; font-weight: bold;"></div>' +
            '<div id="targets-list"></div>' +
        '</div>';

        content.innerHTML = html;

        // Reset filter cache since we just rebuilt the entire control panel
        filterCache = null;

        // Initialize chain status display
        displayChainStatus(null);

        // Use event delegation for better performance and to prevent memory leaks
        var controls = document.querySelector('.war-controls');
        if (controls) {
            // Handle change events for checkboxes
            controls.addEventListener('change', function(e) {
                var target = e.target;
                var id = target.id;

                // Checkbox filters - apply immediately (no debounce)
                if (id === 'filter-online') {
                    GM_setValue('filterOnline', target.checked);
                    doFilterTargets();
                } else if (id === 'filter-offline') {
                    GM_setValue('filterOffline', target.checked);
                    doFilterTargets();
                } else if (id === 'hide-hospital') {
                    GM_setValue('hideHospital', target.checked);
                    doFilterTargets();
                } else if (id === 'hide-travelling') {
                    GM_setValue('hideTravelling', target.checked);
                    doFilterTargets();
                } else if (id === 'filter-hosp-soon') {
                    GM_setValue('filterHospSoon', target.checked);
                    doFilterTargets();
                } else if (id === 'enable-ff-filter') {
                    GM_setValue('enableFFFilter', target.checked);
                    doFilterTargets();
                } else if (id === 'enable-stats-filter') {
                    GM_setValue('enableStatsFilter', target.checked);
                    doFilterTargets();
                } else if (id === 'auto-refresh') {
                    if (target.checked) startAutoRefresh();
                    else stopAutoRefresh();
                }
            });

            // Handle input events for text/number inputs (debounced)
            controls.addEventListener('input', function(e) {
                var target = e.target;
                var id = target.id;

                if (id === 'min-ff') {
                    GM_setValue('minFF', target.value);
                    filterTargets(); // Debounced
                } else if (id === 'max-ff') {
                    GM_setValue('maxFF', target.value);
                    filterTargets(); // Debounced
                } else if (id === 'min-stats') {
                    GM_setValue('minStats', target.value);
                    filterTargets(); // Debounced
                } else if (id === 'max-stats') {
                    GM_setValue('maxStats', target.value);
                    filterTargets(); // Debounced
                }
            });

            // Handle button clicks
            controls.addEventListener('click', function(e) {
                var target = e.target;
                var id = target.id;

                if (id === 'save-api') {
                    saveApiKey();
                } else if (id === 'load-faction') {
                    loadFactionTargets();
                } else if (id === 'toggle-advanced') {
                    var adv = document.getElementById('advanced-settings');
                    adv.style.display = adv.style.display === 'none' ? 'block' : 'none';
                }
            });

            // Handle Enter key for API key and faction ID inputs
            controls.addEventListener('keypress', function(e) {
                if (e.key === 'Enter' || e.keyCode === 13) {
                    var target = e.target;
                    var id = target.id;

                    if (id === 'api-key') {
                        e.preventDefault();
                        saveApiKey();
                    } else if (id === 'faction-id') {
                        e.preventDefault();
                        loadFactionTargets();
                    }
                }
            });
        }

        if (scrapedTargets && scrapedTargets.length > 0) {
            document.getElementById('loading-status').textContent = 'Loaded ' + scrapedTargets.length + ' targets';
            displayTargets(scrapedTargets);

            if (document.getElementById('auto-refresh').checked) {
                setTimeout(startAutoRefresh, 2000);
            }
            return;
        }

        var targets = getCachedTargets();
        if (targets && targets.length > 0) {
            console.log('[Torn War Targets] Loaded', targets.length, 'cached targets');
            document.getElementById('loading-status').textContent = 'Loaded ' + targets.length + ' cached targets';
            displayTargets(targets);

            if (document.getElementById('auto-refresh').checked) {
                setTimeout(startAutoRefresh, 5000);
            }
        }
    }

    function saveApiKey() {
        var apiKey = document.getElementById('api-key').value.trim();
        if (!apiKey) {
            alert('Please enter an API key');
            return;
        }

        // Validate format before making API call
        if (!validateApiKey(apiKey)) {
            alert('Invalid API key format. Must be 16 alphanumeric characters.');
            return;
        }

        var statusEl = document.getElementById('loading-status');
        if (statusEl) {
            statusEl.textContent = 'Validating API key...';
            statusEl.style.color = '#ffaa00';
        }

        safeFetch('https://api.torn.com/user/?selections=basic&key=' + encodeURIComponent(apiKey))
            .then(function(data) {
                if (data.error) {
                    alert('Invalid API key: ' + data.error.error);
                    if (statusEl) {
                        statusEl.textContent = '❌ Invalid API key';
                        statusEl.style.color = '#ff4444';
                    }
                    return;
                }
                GM_setValue('apiKey', apiKey);
                alert('API key validated and saved successfully!');
                if (statusEl) {
                    statusEl.textContent = '✅ API key validated for ' + escapeHtml(data.name);
                    statusEl.style.color = '#44ff44';
                }
            })
            .catch(function(error) {
                console.error('[Torn War Targets] API key validation failed');
                // Error message already shown by safeFetch
            });
    }

    function loadFactionTargets() {
        var apiKey = GM_getValue('apiKey', '');
        var factionId = document.getElementById('faction-id').value.trim();

        if (!apiKey || !factionId) {
            alert('Need API key and faction ID');
            return;
        }

        // Validate faction ID
        if (!validateFactionId(factionId)) {
            alert('Invalid faction ID. Must be numeric.');
            return;
        }

        document.getElementById('loading-status').textContent = 'Loading...';

        safeFetch('https://api.torn.com/faction/' + encodeURIComponent(factionId) + '?selections=basic&key=' + encodeURIComponent(apiKey))
            .then(function(data) {
                if (data.error) {
                    alert('Error: ' + data.error.error);
                    document.getElementById('loading-status').textContent = '❌ API Error: ' + data.error.error;
                    document.getElementById('loading-status').style.color = '#ff4444';
                    return;
                }
                var members = Object.values(data.members);
                if (members.length === 0) {
                    console.log('[Torn War Targets] Warning: Faction has no members');
                    alert('Warning: This faction has no members');
                    document.getElementById('loading-status').textContent = '⚠️ Faction has no members';
                    document.getElementById('loading-status').style.color = '#ffaa00';
                    return;
                }
                var targets = members.map(function(m) {
                    return {
                        id: m.id, name: m.name, level: m.level,
                        status: { state: 'unknown', description: 'Unknown' },
                        last_action: { timestamp: 0 }, fairFight: null, estimate: null
                    };
                });
                console.log('[Torn War Targets] Loaded', targets.length, 'targets from API');
                saveTargets(targets);
                document.getElementById('loading-status').textContent = 'Loaded ' + targets.length + ' targets from API';
                document.getElementById('loading-status').style.color = '#44ff44';
                displayTargets(targets);
            })
            .catch(function(error) {
                // Error already handled by safeFetch
                console.error('[Torn War Targets] Failed to load faction targets:', error);
            });
    }

    function parseBattleStats(text) {
        if (!text) return 0;
        var clean = text.toLowerCase().replace(/[",\s]/g, '');
        var match = clean.match(/(\d+\.?\d*)([kmb]?)/);
        if (!match) return 0;
        var num = parseFloat(match[1]);
        var suf = match[2];
        if (suf === 'k') return num * 1000;
        if (suf === 'm') return num * 1000000;
        if (suf === 'b') return num * 1000000000;
        return num;
    }

    function getHospitalSeconds(statusDesc) {
        if (!statusDesc) return 999999; // Unknown hospital time goes to end
        var hospMatch = statusDesc.match(/(\d+)\s*(second|sec|minute|min|hour|hr)/i);
        if (!hospMatch) return 999999;
        var hospVal = parseInt(hospMatch[1]);
        var hospUnit = hospMatch[2].toLowerCase();
        if (hospUnit.startsWith('sec')) return hospVal;
        if (hospUnit.startsWith('min')) return hospVal * 60;
        if (hospUnit.startsWith('hour') || hospUnit.startsWith('hr')) return hospVal * 3600;
        return 999999;
    }

    function displayTargets(targets) {
        var container = document.getElementById('targets-list');

        if (!targets || targets.length === 0) {
            container.innerHTML = '<p>No targets loaded</p>';
            return;
        }

        var filtered = targets;

        // Check if Hospital/OK < 5 min filter is active
        var filterHospSoon = document.getElementById('filter-hosp-soon') ? document.getElementById('filter-hosp-soon').checked : false;

        if (filterHospSoon) {
            // Custom sort for Hospital/OK filter: OK targets by FF (best first), then hospital by time remaining (soonest first)
            filtered.sort(function(a, b) {
                var aState = (a.status && a.status.state) || 'unknown';
                var bState = (b.status && b.status.state) || 'unknown';
                var aIsOkay = (aState === 'online' || aState === 'idle' || aState === 'offline');
                var bIsOkay = (bState === 'online' || bState === 'idle' || bState === 'offline');

                // OK targets come first
                if (aIsOkay && !bIsOkay) return -1;
                if (!aIsOkay && bIsOkay) return 1;

                // Both are OK - sort by fair fight (higher FF = better target)
                if (aIsOkay && bIsOkay) {
                    var aFF = a.fairFight || 0;
                    var bFF = b.fairFight || 0;
                    if (bFF !== aFF) return bFF - aFF;
                    // If FF is same, sort by battle stats (lower stats = easier target)
                    return parseBattleStats(a.estimate || '0') - parseBattleStats(b.estimate || '0');
                }

                // Both are hospital - sort by time remaining (soonest first)
                var aHospTime = getHospitalSeconds(a.status ? a.status.description : '');
                var bHospTime = getHospitalSeconds(b.status ? b.status.description : '');
                return aHospTime - bHospTime;
            });
        } else {
            // Default sort by battle stats (highest first)
            filtered.sort(function(a, b) {
                return parseBattleStats(b.estimate || '0') - parseBattleStats(a.estimate || '0');
            });
        }

        var now = Math.floor(Date.now() / 1000);

        // Check if table exists - if so, update it instead of rebuilding
        var existingTable = container.querySelector('.targets-table tbody');

        if (existingTable) {
            // Check if sort order has changed by comparing current order to new sorted order
            var currentOrder = [];
            var existingRows = existingTable.querySelectorAll('tr');
            for (var k = 0; k < existingRows.length; k++) {
                var userId = existingRows[k].getAttribute('data-user-id');
                if (userId) currentOrder.push(userId);
            }

            var newOrder = filtered.map(function(t) { return String(t.id); });
            var orderChanged = currentOrder.length !== newOrder.length ||
                               currentOrder.some(function(id, idx) { return id !== newOrder[idx]; });

            if (orderChanged) {
                console.log('[Torn War Targets] Sort order changed, rebuilding table');
                buildNewTable(container, filtered, now);
                // Apply filters immediately after rebuild to prevent flicker
                doFilterTargets();
                return; // Don't call doFilterTargets again at the end
            } else {
                // Update existing rows instead of rebuilding the entire table
                console.log('[Torn War Targets] Updating existing table rows');
                updateExistingTable(existingTable, filtered, now);
                // Use debounced filter for smooth updates
                filterTargets();
                return;
            }
        } else {
            // First render - build the table from scratch
            console.log('[Torn War Targets] Building initial table');
            buildNewTable(container, filtered, now);
        }

        // Apply filters immediately (no debounce) after display to prevent flicker
        doFilterTargets();
    }

    function buildNewTable(container, targets, now) {
        var tableRows = '';

        for (var i = 0; i < targets.length; i++) {
            var target = targets[i];
            var rowData = prepareRowData(target, now);
            var statsNum = parseBattleStats(rowData.estimate);

            // Escape all user-controlled data to prevent XSS
            tableRows += '<tr data-user-id="' + escapeHtml(String(target.id)) + '" data-hosp-seconds="' + escapeHtml(String(rowData.hospUntil)) + '" data-stats-num="' + statsNum + '">' +
                '<td>' + escapeHtml(rowData.name) + ' [' + escapeHtml(String(target.id)) + ']</td>' +
                '<td>' + escapeHtml(String(rowData.level)) + '</td>' +
                '<td class="status-' + escapeHtml(rowData.statusState) + '" data-status-state="' + escapeHtml(rowData.statusState) + '">' + escapeHtml(rowData.statusDesc) + '</td>' +
                '<td>' + escapeHtml(rowData.lastAction) + '</td>' +
                '<td class="ff-score">' + escapeHtml(String(rowData.ff)) + '</td>' +
                '<td data-stats="' + escapeHtml(String(rowData.estimate)) + '">' + escapeHtml(String(rowData.estimate)) + '</td>' +
                '<td><a href="/loader.php?sid=attack&user2ID=' + escapeHtml(String(target.id)) + '" target="_blank" class="torn-btn">Attack</a></td>' +
            '</tr>';
        }

        container.innerHTML = '<table class="targets-table"><thead><tr>' +
            '<th>Name</th><th>Level</th><th>Status</th><th>Last Action</th><th>Fair Fight</th><th>Battle Stats</th><th>Actions</th>' +
            '</tr></thead><tbody>' + tableRows + '</tbody></table>';
    }

    function updateExistingTable(tbody, targets, now) {
        var rows = tbody.querySelectorAll('tr');
        var rowMap = {};

        // Map existing rows by user ID
        for (var i = 0; i < rows.length; i++) {
            var userId = rows[i].getAttribute('data-user-id');
            if (userId) rowMap[userId] = rows[i];
        }

        // Update each target's row
        for (var j = 0; j < targets.length; j++) {
            var target = targets[j];
            var row = rowMap[target.id];

            if (row) {
                var rowData = prepareRowData(target, now);

                // Only update cells that might have changed (status, last action)
                row.setAttribute('data-hosp-seconds', rowData.hospUntil);

                var statusCell = row.querySelector('td:nth-child(3)');
                var oldStatus = statusCell.textContent;
                statusCell.className = 'status-' + rowData.statusState;
                statusCell.setAttribute('data-status-state', rowData.statusState);
                statusCell.textContent = rowData.statusDesc;

                // Debug: log ALL hospital status updates that changed
                if (rowData.statusState === 'hospital' && oldStatus !== rowData.statusDesc) {
                    console.log('[Torn War Targets] Hospital status CHANGED:',
                                target.name,
                                'Old:', oldStatus,
                                '→ New:', rowData.statusDesc);
                }

                var lastActionCell = row.querySelector('td:nth-child(4)');
                lastActionCell.textContent = rowData.lastAction;
            }
        }
    }

    function prepareRowData(target, now) {
        var name = target.name || 'Unknown';
        var level = target.level || '?';
        var statusDesc = (target.status && target.status.description) ? target.status.description : 'Unknown';

        // Use shared status detection function for consistency
        var statusState = determineStatusState(
            target.status,
            target.last_action ? target.last_action.timestamp : 0
        );

        var lastAction = (target.last_action && target.last_action.relative) ? target.last_action.relative : '-';
        var ff = target.fairFight || '-';
        var estimate = target.estimate || '-';

        var hospUntil = 0;
        if (statusState === 'hospital' && statusDesc) {
            var hospMatch = statusDesc.match(/(\d+)\s*(second|sec|minute|min|hour|hr)/i);
            if (hospMatch) {
                var hospVal = parseInt(hospMatch[1]);
                var hospUnit = hospMatch[2].toLowerCase();
                if (hospUnit.startsWith('sec')) hospUntil = hospVal;
                else if (hospUnit.startsWith('min')) hospUntil = hospVal * 60;
                else if (hospUnit.startsWith('hour') || hospUnit.startsWith('hr')) hospUntil = hospVal * 3600;
            }
        }

        return {
            name: name,
            level: level,
            statusState: statusState,
            statusDesc: statusDesc,
            lastAction: lastAction,
            ff: ff,
            estimate: estimate,
            hospUntil: hospUntil
        };
    }

    // Helper function to get filter element references (cached for performance)
    function getFilterElements() {
        if (!filterCache) {
            filterCache = {
                online: document.getElementById('filter-online'),
                offline: document.getElementById('filter-offline'),
                hideHospital: document.getElementById('hide-hospital'),
                hideTravelling: document.getElementById('hide-travelling'),
                hospSoon: document.getElementById('filter-hosp-soon'),
                enableFF: document.getElementById('enable-ff-filter'),
                minFF: document.getElementById('min-ff'),
                maxFF: document.getElementById('max-ff'),
                enableStats: document.getElementById('enable-stats-filter'),
                minStats: document.getElementById('min-stats'),
                maxStats: document.getElementById('max-stats')
            };
        }
        return filterCache;
    }

    // Debounced filter function (for text inputs)
    function filterTargets() {
        clearTimeout(filterDebounceTimer);
        filterDebounceTimer = setTimeout(doFilterTargets, FILTER_DEBOUNCE_MS);
    }

    function doFilterTargets() {
        var rows = document.querySelectorAll('.targets-table tbody tr');
        if (rows.length === 0) return;

        // Get cached filter element references
        var filters = getFilterElements();
        if (!filters.online) return; // Elements not ready yet

        // Read all filter values once (instead of in loop)
        var filterOnline = filters.online.checked;
        var filterOffline = filters.offline.checked;
        var hideHospital = filters.hideHospital.checked;
        var hideTravelling = filters.hideTravelling.checked;
        var filterHospSoon = filters.hospSoon.checked;
        var enableFFFilter = filters.enableFF.checked;
        var minFF = parseFloat(filters.minFF.value || 0);
        var maxFF = parseFloat(filters.maxFF.value || 999);
        var enableStatsFilter = filters.enableStats.checked;
        var minStats = filters.minStats.value.trim();
        var maxStats = filters.maxStats.value.trim();

        // Pre-parse stats thresholds if filter is enabled
        var minStatsNum = enableStatsFilter && minStats ? parseBattleStats(minStats) : 0;
        var maxStatsNum = enableStatsFilter && maxStats ? parseBattleStats(maxStats) : Infinity;

        // Batch visibility changes using requestAnimationFrame for better performance
        requestAnimationFrame(function() {
            for (var i = 0; i < rows.length; i++) {
                var row = rows[i];
                var statusState = row.querySelector('td:nth-child(3)').getAttribute('data-status-state') || '';
                var ffValue = parseFloat(row.querySelector('.ff-score').textContent) || 0;
                var hospSeconds = parseInt(row.getAttribute('data-hosp-seconds')) || 0;
                var statsNum = parseInt(row.getAttribute('data-stats-num')) || 0;

                var show = true;

                // Hospital/OK < 5 min filter - shows hospital < 5 min OR status "Okay" (online/idle/offline)
                if (filterHospSoon) {
                    var isHospSoon = (statusState === 'hospital' && hospSeconds > 0 && hospSeconds <= HOSP_SOON_SECONDS);
                    var isOkayStatus = (statusState === 'online' || statusState === 'idle' || statusState === 'offline');
                    if (!isHospSoon && !isOkayStatus) {
                        show = false;
                    }
                }

                // Regular status filters (always apply)
                if (filterOnline && statusState !== 'online' && statusState !== 'idle') show = false;
                if (filterOffline && statusState !== 'offline') show = false;
                if (hideHospital && statusState === 'hospital') show = false;
                if (hideTravelling && statusState === 'traveling') show = false;

                // Fair Fight filter (only apply if checkbox is enabled)
                if (enableFFFilter && ffValue > 0 && (ffValue < minFF || ffValue > maxFF)) show = false;

                // Battle Stats filter (only apply if checkbox is enabled, use pre-parsed values)
                if (enableStatsFilter) {
                    if (statsNum > 0) {
                        if (statsNum < minStatsNum || statsNum > maxStatsNum) show = false;
                    } else if (minStats || maxStats) {
                        show = false;
                    }
                }

                row.style.display = show ? '' : 'none';
            }
        });
    }

    function startAutoRefresh() {
        stopAutoRefresh();
        retryCount = 0; // Reset retry counter when starting auto-refresh
        var apiKey = GM_getValue('apiKey', '');
        var factionId = GM_getValue('scrapedFactionId', '');
        if (!apiKey || !factionId) {
            document.getElementById('auto-refresh').checked = false;
            console.log('[Torn War Targets] Auto-refresh disabled: missing API key or faction ID');
            return;
        }

        console.log('[Torn War Targets] Auto-refresh started (every', API_DELAY / 1000, 'seconds)');

        function doRefresh() {
            if (refreshInProgress) {
                console.log('[Torn War Targets] Skipping refresh - previous refresh still in progress');
                return;
            }
            refreshInProgress = true;
            refreshFactionStatus(factionId, apiKey)
                .finally(function() {
                    refreshInProgress = false;
                });
        }

        doRefresh(); // Immediate first refresh
        refreshInterval = setInterval(doRefresh, API_DELAY);
    }

    function stopAutoRefresh() {
        if (refreshInterval) {
            clearInterval(refreshInterval);
            refreshInterval = null;
            console.log('[Torn War Targets] Auto-refresh stopped');
        }
    }

    function refreshFactionStatus(factionId, apiKey) {
        return safeFetch('https://api.torn.com/faction/' + encodeURIComponent(factionId) + '?selections=basic,chain&key=' + encodeURIComponent(apiKey))
            .then(function(data) {
                if (data.error) {
                    var errorCode = data.error.code;
                    console.error('[Torn War Targets] API error during refresh:', data.error.error, '(code:', errorCode + ')');

                    // Check if this is a permanent error (invalid key or access denied)
                    if (errorCode === 2 || errorCode === 10) {
                        // Permanent error - stop auto-refresh
                        stopAutoRefresh();
                        document.getElementById('auto-refresh').checked = false;
                        updateStatus('Auto-refresh stopped: ' + data.error.error, 'error');
                        alert('Auto-refresh stopped due to permanent API error: ' + data.error.error);
                        return Promise.reject(new Error('Permanent API error'));
                    }

                    // Transient error - increment retry counter
                    retryCount++;
                    if (retryCount <= MAX_API_RETRIES) {
                        console.log('[Torn War Targets] Transient API error, will retry on next interval (attempt', retryCount, 'of', MAX_API_RETRIES + ')');
                        updateStatus('API error, will retry... (' + retryCount + '/' + MAX_API_RETRIES + ')', 'warning');
                        return Promise.reject(new Error('Transient API error - will retry on next interval'));
                    }

                    // Max retries exceeded - stop auto-refresh
                    stopAutoRefresh();
                    document.getElementById('auto-refresh').checked = false;
                    updateStatus('Auto-refresh stopped after ' + MAX_API_RETRIES + ' failed retries', 'error');
                    alert('Auto-refresh stopped after ' + MAX_API_RETRIES + ' failed retries');
                    return Promise.reject(new Error('Max retries exceeded'));
                }

                // Success - reset retry count
                retryCount = 0;
                var targets = getCachedTargets();
                var members = data.members;
                var updateCount = 0;
                var hospitalCount = 0;

                for (var i = 0; i < targets.length; i++) {
                    var t = targets[i];
                    var m = members[t.id];
                    if (!m) continue;

                    var preservedFF = t.fairFight;
                    var preservedEst = t.estimate;

                    var statusText = (m.status && m.status.description) || 'Unknown';
                    var statusColor = (m.status && m.status.color) || '';
                    var baseState = 'unknown';

                    if (statusColor === 'green') baseState = 'online';
                    else if (statusColor === 'red') {
                        baseState = 'hospital';
                        hospitalCount++;
                    }
                    else if (statusColor === 'blue') baseState = 'traveling';
                    else if (statusColor === 'orange') baseState = 'jail';

                    // Use shared status detection function for consistency
                    var statusState = determineStatusState(
                        { state: baseState, description: statusText },
                        m.last_action ? m.last_action.timestamp : 0
                    );

                    t.status = { state: statusState, description: statusText };
                    if (m.last_action) {
                        t.last_action = {
                            timestamp: m.last_action.timestamp || 0,
                            relative: m.last_action.relative || ''
                        };
                    }
                    t.fairFight = preservedFF;
                    t.estimate = preservedEst;
                    updateCount++;
                }

                console.log('[Torn War Targets] Refreshed status for', updateCount, 'targets (' + hospitalCount + ' in hospital)');
                saveTargets(targets);
                displayTargets(targets);

                // Update chain status if available
                if (data.chain) {
                    console.log('[Torn War Targets] Chain status:', data.chain);
                    displayChainStatus(data.chain);
                }

                var statusEl = document.getElementById('loading-status');
                if (statusEl) {
                    statusEl.textContent = 'Last updated: ' + new Date().toLocaleTimeString();
                    statusEl.style.color = '#44ff44';
                }
            })
            .catch(function(error) {
                console.error('[Torn War Targets] Refresh failed:', error);
                // Don't stop auto-refresh on network errors, just skip this cycle
            });
    }

    var css = '.war-targets-container { padding: 20px; color: inherit; }';
    css += '.war-controls { background: rgba(128, 128, 128, 0.1); padding: 15px; margin: 15px 0; border-radius: 5px; border: 1px solid rgba(128, 128, 128, 0.2); }';
    css += '.control-group { margin: 10px 0; }';
    css += '.control-group label { margin-right: 15px; }';
    css += '.control-group input[type="password"], .control-group input[type="number"] { background: rgba(255, 255, 255, 0.05); color: inherit; padding: 5px; border: 1px solid rgba(128, 128, 128, 0.3); border-radius: 3px; width: 80px; }';
    css += '.control-group input[type="text"] { background: rgba(255, 255, 255, 0.05); color: inherit; padding: 5px; border: 1px solid rgba(128, 128, 128, 0.3); border-radius: 3px; width: 80px; }';
    css += '.control-group input[type="checkbox"] { padding: 5px; border: 1px solid rgba(128, 128, 128, 0.3); border-radius: 3px; }';

    // Chain status styling
    css += '#chain-status-container { margin: 20px 0; }';
    css += '.chain-status { padding: 20px; border-radius: 8px; border: 2px solid; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px; }';
    css += '.chain-status .chain-count { font-size: 28px; font-weight: bold; flex: 1; min-width: 150px; }';
    css += '.chain-status .chain-timer { font-size: 20px; font-weight: bold; flex: 1; min-width: 150px; text-align: center; }';
    css += '.chain-status .chain-state-indicator { font-size: 16px; font-weight: bold; padding: 8px 16px; border-radius: 5px; background: rgba(0, 0, 0, 0.3); flex-shrink: 0; }';
    css += '.chain-status .chain-detail { font-size: 14px; opacity: 0.8; flex-basis: 100%; }';

    // Chain state colors
    css += '.chain-active { background: rgba(68, 255, 68, 0.15); border-color: #44ff44; color: #44ff44 !important; }';
    css += '.chain-active .chain-count, .chain-active .chain-timer, .chain-active .chain-state-indicator { color: #44ff44 !important; }';
    css += '.chain-cooling { background: rgba(255, 170, 0, 0.15); border-color: #ffaa00; color: #ffaa00 !important; }';
    css += '.chain-cooling .chain-count, .chain-cooling .chain-timer, .chain-cooling .chain-state-indicator { color: #ffaa00 !important; }';
    css += '.chain-inactive { background: rgba(255, 68, 68, 0.15); border-color: #ff4444; color: #ff4444 !important; }';
    css += '.chain-inactive .chain-count, .chain-inactive .chain-timer, .chain-inactive .chain-state-indicator { color: #ff4444 !important; }';
    css += '.chain-broken { background: rgba(255, 68, 68, 0.15); border-color: #ff4444; color: #ff4444 !important; }';
    css += '.chain-broken .chain-count, .chain-broken .chain-timer, .chain-broken .chain-state-indicator { color: #ff4444 !important; }';
    css += '.chain-unknown { background: rgba(128, 128, 128, 0.15); border-color: #888; color: #888 !important; }';
    css += '.chain-unknown .chain-count, .chain-unknown .chain-detail { color: #888 !important; }';

    css += '.targets-table { width: 100%; border-collapse: collapse; margin-top: 20px; }';
    css += '.targets-table th, .targets-table td { padding: 10px; border: 1px solid rgba(128, 128, 128, 0.3); text-align: left; color: inherit !important; }';
    css += '.targets-table th { background: rgba(0, 0, 0, 0.3); font-weight: bold; }';
    css += '.targets-table tr:nth-child(even) { background: rgba(128, 128, 128, 0.05); }';
    css += '.targets-table tr:hover { background: rgba(128, 128, 128, 0.15); }';
    css += '.targets-table a { color: #4a9eff !important; text-decoration: none; }';
    css += '.targets-table .status-hospital { color: #ff4444 !important; font-weight: bold; }';
    css += '.targets-table .status-online { color: #44ff44 !important; font-weight: bold; }';
    css += '.targets-table .status-idle { color: #ffaa00 !important; font-weight: bold; }';
    css += '.targets-table .status-traveling { color: #4da6ff !important; font-weight: bold; }';
    css += '.targets-table .status-jail { color: #ff9933 !important; font-weight: bold; }';
    css += '.targets-table .status-offline { color: #888 !important; font-weight: bold; }';
    css += '.torn-btn { padding: 5px 10px; background: rgba(51, 51, 51, 0.8); color: #fff; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 3px; cursor: pointer; margin-right: 5px; }';
    css += '.torn-btn:hover { background: rgba(85, 85, 85, 0.9); }';
    GM_addStyle(css);

    // Function to disconnect MutationObserver when targets are loaded
    function disconnectFactionObserver() {
        if (mutationObserver) {
            mutationObserver.disconnect();
            mutationObserver = null;
            clearTimeout(buttonDebounceTimer); // Clear pending debounce
            buttonDebounceTimer = null;
            console.log('[Torn War Targets] MutationObserver disconnected');
        }
    }

    // Function to initialize MutationObserver with debouncing
    function initFactionObserver() {
        if (!window.location.href.includes('factions.php')) return;
        if (mutationObserver) return; // Already observing

        mutationObserver = new MutationObserver(function() {
            clearTimeout(buttonDebounceTimer);
            buttonDebounceTimer = setTimeout(addFactionButton, BUTTON_DEBOUNCE_MS);
        });
        var factionContainer = document.querySelector('#factions-page') || document.body;
        mutationObserver.observe(factionContainer, {
            childList: true,
            subtree: true
        });
        console.log('[Torn War Targets] MutationObserver active on faction page');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            addFactionButton();
            initFactionObserver();
        });
    } else {
        addFactionButton();
        initFactionObserver();
    }

})();