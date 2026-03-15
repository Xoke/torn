// ==UserScript==
// @name         Torn Ranked War Retal Monitor
// @namespace    https://xoke.org/
// @version      1.5
// @description  Monitors faction attacks to identify retaliation opportunities during ranked wars
// @author       Xoke
// @match        https://www.torn.com/*
// @match        https://www.tornpda.com/*
// @run-at       document-end
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      api.torn.com
// @homepageURL  https://github.com/Xoke/torn
// @downloadURL  https://raw.githubusercontent.com/Xoke/torn/main/TornRetalMonitor.user.js
// @updateURL    https://raw.githubusercontent.com/Xoke/torn/main/TornRetalMonitor.meta.js
// ==/UserScript==

(function() {
    'use strict';

    var DEBUG = false;

    function debugLog() {
        if (DEBUG) console.log.apply(console, ['[Torn Retal Monitor]'].concat(Array.prototype.slice.call(arguments)));
    }

    function debugError() {
        if (DEBUG) console.error.apply(console, ['[Torn Retal Monitor]'].concat(Array.prototype.slice.call(arguments)));
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
        return /^[a-zA-Z0-9]{16}$/.test(String(key).trim());
    }

    debugLog('Script initialized');

    // Configuration. If using with Ranked War Target Finder or Target Manager, combined API usage counts toward Torn's 100 calls/min limit.
    var API_DELAY = 10000; // Check every 10 seconds
    var RETAL_WINDOW = 300; // 5 minutes in seconds
    var apiKey = GM_getValue('tornRetalApiKey', '');
    var factionId = GM_getValue('tornRetalFactionId', '');
    var isMonitoring = GM_getValue('tornRetalMonitoring', false);
    var monitorInterval = null;
    var lastCheckedTimestamp = Math.floor(Date.now() / 1000);

    // Store active retal opportunities (attackerId -> retal object)
    var activeRetals = new Map(GM_getValue('tornActiveRetals', []));

    // Styles
    GM_addStyle(`
        #retal-monitor-container {
            position: fixed;
            top: 60px;
            right: 10px;
            z-index: 99999;
            font-family: Arial, sans-serif;
            width: 280px;
        }

        #retal-monitor-panel {
            background: linear-gradient(to bottom, #2a2a2a 0%, #1a1a1a 100%);
            border: 2px solid #444;
            border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5);
        }

        #retal-monitor-header {
            background: linear-gradient(to bottom, #c33 0%, #a22 100%);
            color: white;
            padding: 8px 10px;
            font-weight: bold;
            font-size: 13px;
            border-radius: 4px 4px 0 0;
            cursor: move;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        #retal-monitor-minimize {
            background: rgba(255,255,255,0.2);
            border: none;
            color: white;
            cursor: pointer;
            font-size: 16px;
            width: 24px;
            height: 24px;
            border-radius: 4px;
            line-height: 20px;
        }

        #retal-monitor-minimize:hover {
            background: rgba(255,255,255,0.3);
        }

        #retal-monitor-body {
            padding: 8px;
            max-height: 400px;
            overflow-y: auto;
        }

        #retal-monitor-body.minimized {
            display: none;
        }

        .retal-config {
            margin-bottom: 10px;
        }

        #retal-config-container.hidden {
            display: none;
        }

        .retal-config label {
            display: block;
            color: #ccc;
            margin-bottom: 3px;
            font-size: 11px;
        }

        .retal-config input {
            width: 100%;
            padding: 5px;
            background: #333;
            border: 1px solid #555;
            color: #fff;
            border-radius: 3px;
            box-sizing: border-box;
            font-size: 11px;
        }

        .retal-settings-toggle {
            width: 100%;
            padding: 4px;
            margin-bottom: 8px;
            background: rgba(255,255,255,0.05);
            color: #999;
            border: 1px solid #444;
            border-radius: 3px;
            cursor: pointer;
            font-size: 10px;
            text-align: center;
        }

        .retal-settings-toggle:hover {
            background: rgba(255,255,255,0.1);
            color: #ccc;
        }

        .retal-button {
            width: 100%;
            padding: 6px;
            margin-top: 8px;
            background: linear-gradient(to bottom, #4a4 0%, #383 100%);
            color: white;
            border: 1px solid #2a2;
            border-radius: 3px;
            cursor: pointer;
            font-weight: bold;
            font-size: 12px;
        }

        .retal-button:hover {
            background: linear-gradient(to bottom, #5b5 0%, #494 100%);
        }

        .retal-button:disabled {
            background: #555;
            border-color: #444;
            cursor: not-allowed;
            opacity: 0.6;
        }

        .retal-stop-button {
            background: linear-gradient(to bottom, #c33 0%, #a22 100%);
            border-color: #c33;
        }

        .retal-stop-button:hover {
            background: linear-gradient(to bottom, #d44 0%, #b33 100%);
        }

        .retal-status {
            padding: 6px;
            background: #252525;
            border: 1px solid #444;
            border-radius: 3px;
            margin-top: 8px;
            font-size: 10px;
            color: #aaa;
        }

        .retal-list {
            margin-top: 10px;
        }

        .retal-item {
            background: #252525;
            border: 1px solid #c33;
            border-radius: 3px;
            padding: 8px;
            margin-bottom: 8px;
            position: relative;
            animation: slideIn 0.3s ease-out;
        }

        @keyframes slideIn {
            from {
                transform: translateX(100%);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }

        .retal-item-new {
            border-color: #ff4444;
            box-shadow: 0 0 10px rgba(255,68,68,0.5);
        }

        .retal-victim {
            color: #4a4;
            font-weight: bold;
            font-size: 12px;
        }

        .retal-attacker {
            color: #c33;
            font-weight: bold;
            font-size: 12px;
        }

        .retal-time {
            color: #888;
            font-size: 9px;
            margin-top: 3px;
        }

        .retal-link {
            display: inline-block;
            margin-top: 5px;
            padding: 3px 6px;
            background: #c33;
            color: white;
            text-decoration: none;
            border-radius: 3px;
            font-size: 10px;
        }

        .retal-link:hover {
            background: #d44;
        }

        .retal-dismiss {
            position: absolute;
            top: 8px;
            right: 8px;
            background: rgba(255,255,255,0.1);
            border: none;
            color: #888;
            cursor: pointer;
            font-size: 16px;
            width: 20px;
            height: 20px;
            border-radius: 3px;
            line-height: 16px;
        }

        .retal-dismiss:hover {
            background: rgba(255,255,255,0.2);
            color: #fff;
        }

        .retal-count {
            background: #c33;
            color: white;
            padding: 1px 5px;
            border-radius: 8px;
            font-size: 10px;
            margin-left: 6px;
        }
    `);

    // Create UI
    function createUI() {
        if (document.getElementById('retal-monitor-container')) return;

        var container = document.createElement('div');
        container.id = 'retal-monitor-container';
        container.innerHTML =
            '<div id="retal-monitor-panel">' +
                '<div id="retal-monitor-header">' +
                    '<span>⚔️ Retal Monitor<span id="retal-count-badge" class="retal-count" style="display:none;">0</span></span>' +
                    '<button id="retal-monitor-minimize">−</button>' +
                '</div>' +
                '<div id="retal-monitor-body">' +
                    '<button id="retal-settings-toggle" class="retal-settings-toggle" style="display:none;">⚙️ Settings</button>' +
                    '<div id="retal-config-container">' +
                        '<div class="retal-config">' +
                            '<label>Torn API Key:</label>' +
                            '<input type="password" id="retal-api-key" placeholder="Enter your API key">' +
                        '</div>' +
                        '<div class="retal-config" id="retal-faction-config">' +
                            '<label>Faction ID:</label>' +
                            '<input type="text" id="retal-faction-id" placeholder="Auto-detecting..." readonly>' +
                        '</div>' +
                    '</div>' +
                    '<button id="retal-start-button" class="retal-button">Start Monitoring</button>' +
                    '<div id="retal-status" class="retal-status">Not monitoring</div>' +
                    '<div id="retal-list" class="retal-list"></div>' +
                '</div>' +
            '</div>';

        document.body.appendChild(container);

        // Set API key and faction ID values via DOM (not innerHTML) to prevent XSS
        if (apiKey) {
            document.getElementById('retal-api-key').value = apiKey;
        }
        if (factionId) {
            document.getElementById('retal-faction-id').value = factionId;
        }

        debugLog('UI created');

        // Make draggable
        makeDraggable(container.querySelector('#retal-monitor-header'), container);

        // Event delegation for dismiss buttons on retal list
        document.getElementById('retal-list').addEventListener('click', function(e) {
            if (e.target.classList.contains('retal-dismiss')) {
                var attackerId = parseInt(e.target.dataset.attackerId, 10);
                dismissRetal(attackerId);
            }
        });

        // Event listeners
        document.getElementById('retal-api-key').addEventListener('change', function(e) {
            var key = e.target.value.trim();

            if (key && !validateApiKey(key)) {
                updateStatus('⚠️ Invalid API key format (must be 16 alphanumeric characters)');
                return;
            }

            apiKey = key;
            GM_setValue('tornRetalApiKey', apiKey);
            debugLog('API key saved');

            // Try to auto-detect faction ID when API key is entered
            if (apiKey && !factionId) {
                autoDetectFactionId();
            }

            updateSettingsVisibility();
        });

        document.getElementById('retal-faction-id').addEventListener('change', function(e) {
            factionId = e.target.value.trim();
            GM_setValue('tornRetalFactionId', factionId);
            debugLog('Faction ID saved');
            updateSettingsVisibility();
        });

        document.getElementById('retal-start-button').addEventListener('click', toggleMonitoring);

        document.getElementById('retal-settings-toggle').addEventListener('click', function() {
            var configContainer = document.getElementById('retal-config-container');
            configContainer.classList.toggle('hidden');
        });

        document.getElementById('retal-monitor-minimize').addEventListener('click', function() {
            var body = document.getElementById('retal-monitor-body');
            var button = document.getElementById('retal-monitor-minimize');
            body.classList.toggle('minimized');
            button.textContent = body.classList.contains('minimized') ? '+' : '−';
        });

        // Auto-detect faction ID if we have API key but no faction ID
        if (apiKey && !factionId) {
            autoDetectFactionId();
        }

        // Update settings visibility
        updateSettingsVisibility();

        // Update UI to reflect saved monitoring state
        if (isMonitoring) {
            var button = document.getElementById('retal-start-button');
            button.textContent = 'Stop Monitoring';
            button.classList.add('retal-stop-button');
        }

        // Load existing retals from storage
        if (activeRetals.size > 0) {
            displayAllRetals(Array.from(activeRetals.values()));
        }
        updateBadgeCount();
    }

    // Auto-detect faction ID from user API
    function autoDetectFactionId() {
        if (!apiKey) return;

        updateStatus('🔍 Auto-detecting faction ID...');

        GM_xmlhttpRequest({
            method: 'GET',
            url: 'https://api.torn.com/user/?selections=basic&key=' + encodeURIComponent(apiKey),
            onload: function(response) {
                try {
                    var data = JSON.parse(response.responseText);

                    if (data.error) {
                        debugError('API error:', data.error);
                        updateStatus('❌ API Error - check your API key');
                        return;
                    }

                    if (data.faction && data.faction.faction_id) {
                        factionId = data.faction.faction_id.toString();
                        GM_setValue('tornRetalFactionId', factionId);

                        var factionInput = document.getElementById('retal-faction-id');
                        if (factionInput) {
                            factionInput.value = factionId;
                        }

                        debugLog('Auto-detected faction ID:', factionId);
                        updateStatus('✅ Faction ID detected! Ready to start monitoring.');
                        updateSettingsVisibility();
                    } else {
                        updateStatus('⚠️ You are not in a faction');
                    }

                } catch (error) {
                    debugError('Parse error:', error);
                    updateStatus('❌ Error detecting faction ID');
                }
            },
            onerror: function(error) {
                debugError('Request error:', error);
                updateStatus('❌ Network error');
            }
        });
    }

    // Update settings visibility based on whether they're configured
    function updateSettingsVisibility() {
        var configContainer = document.getElementById('retal-config-container');
        var settingsToggle = document.getElementById('retal-settings-toggle');

        if (apiKey && factionId) {
            // Hide config, show toggle button
            configContainer.classList.add('hidden');
            settingsToggle.style.display = 'block';
        } else {
            // Show config, hide toggle button
            configContainer.classList.remove('hidden');
            settingsToggle.style.display = 'none';
        }
    }

    // Make element draggable
    function makeDraggable(handle, element) {
        var pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        handle.onmousedown = dragMouseDown;

        function dragMouseDown(e) {
            e.preventDefault();
            pos3 = e.clientX;
            pos4 = e.clientY;
            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
        }

        function elementDrag(e) {
            e.preventDefault();
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            element.style.top = (element.offsetTop - pos2) + "px";
            element.style.left = (element.offsetLeft - pos1) + "px";
            element.style.right = "auto";
        }

        function closeDragElement() {
            document.onmouseup = null;
            document.onmousemove = null;
        }
    }

    // Toggle monitoring
    function toggleMonitoring() {
        if (!apiKey || !factionId) {
            updateStatus('⚠️ Please enter API key and Faction ID');
            return;
        }

        if (isMonitoring) {
            stopMonitoring();
        } else {
            startMonitoring();
        }
    }

    // Start monitoring
    function startMonitoring() {
        isMonitoring = true;
        GM_setValue('tornRetalMonitoring', true);
        lastCheckedTimestamp = Math.floor(Date.now() / 1000);

        var button = document.getElementById('retal-start-button');
        button.textContent = 'Stop Monitoring';
        button.classList.add('retal-stop-button');

        updateStatus('✅ Monitoring active - Checking every 10 seconds');
        debugLog('Started monitoring');

        checkForRetals(); // Initial check
        monitorInterval = setInterval(checkForRetals, API_DELAY);
    }

    // Stop monitoring
    function stopMonitoring() {
        isMonitoring = false;
        GM_setValue('tornRetalMonitoring', false);

        if (monitorInterval) {
            clearInterval(monitorInterval);
            monitorInterval = null;
        }

        var button = document.getElementById('retal-start-button');
        button.textContent = 'Start Monitoring';
        button.classList.remove('retal-stop-button');

        updateStatus('⏸️ Monitoring stopped');
        debugLog('Stopped monitoring');
    }

    // Update status message
    function updateStatus(message) {
        var statusEl = document.getElementById('retal-status');
        if (statusEl) {
            statusEl.textContent = message;
        }
    }

    // Check for retals via API
    function checkForRetals() {
        var now = Math.floor(Date.now() / 1000);

        updateStatus('🔍 Checking for attacks... (Last: ' + new Date().toLocaleTimeString() + ')');

        // Get faction attacks from API
        var url = 'https://api.torn.com/faction/' + encodeURIComponent(factionId) + '?selections=attacks&key=' + encodeURIComponent(apiKey);

        GM_xmlhttpRequest({
            method: 'GET',
            url: url,
            onload: function(response) {
                try {
                    var data = JSON.parse(response.responseText);

                    if (data.error) {
                        debugError('API error:', data.error);
                        updateStatus('❌ API Error: ' + data.error.error);
                        return;
                    }

                    if (!data.attacks) {
                        updateStatus('⚠️ No attack data received');
                        return;
                    }

                    processAttacks(data.attacks, now);
                    updateStatus('✅ Monitoring active - Last check: ' + new Date().toLocaleTimeString());

                } catch (error) {
                    debugError('Parse error:', error);
                    updateStatus('❌ Error parsing API response');
                }
            },
            onerror: function(error) {
                debugError('Request error:', error);
                updateStatus('❌ Network error');
            }
        });
    }

    // Process attacks to find retals
    function processAttacks(attacks, currentTime) {
        var newRetals = [];
        var retriedEnemies = new Set(); // Track enemies who have been retaliated against
        var currentEnemyAttacks = new Map(); // Track current enemies who hit us

        // Convert attacks object to array and sort by timestamp (newest first)
        var attackArray = Object.entries(attacks).map(function(entry) {
            var attack = entry[1];
            attack.id = entry[0];
            return attack;
        }).sort(function(a, b) { return b.timestamp_ended - a.timestamp_ended; });

        var factionIdNum = parseInt(factionId, 10);

        // First pass: identify all attacks on our faction members by enemies
        for (var i = 0; i < attackArray.length; i++) {
            var attack = attackArray[i];
            var timeDiff = currentTime - attack.timestamp_ended;

            // Only process recent attacks
            if (timeDiff > RETAL_WINDOW || timeDiff < 0) continue;

            var isDefenderInFaction = attack.defender_faction === factionIdNum;
            var isAttackerInFaction = attack.attacker_faction === factionIdNum;
            var isExternalAttacker = !isAttackerInFaction;

            // Case 1: Enemy attacked our faction member - potential retal target
            if (isDefenderInFaction && isExternalAttacker) {
                if (!currentEnemyAttacks.has(attack.attacker_id)) {
                    currentEnemyAttacks.set(attack.attacker_id, {
                        id: attack.id,
                        attackerId: attack.attacker_id,
                        attackerName: attack.attacker_name,
                        attackerFaction: attack.attacker_factionname || 'Unknown',
                        victimId: attack.defender_id,
                        victimName: attack.defender_name,
                        timestamp: attack.timestamp_ended,
                        result: attack.result,
                        respect: attack.respect_gain || 0
                    });
                }
            }

            // Case 2: Our faction member attacked someone - check if it's a retal
            if (isAttackerInFaction && !isDefenderInFaction) {
                // Mark this defender as retaliated
                retriedEnemies.add(attack.defender_id);
            }
        }

        // Second pass: remove enemies who have been retaliated against
        for (var enemyId of retriedEnemies) {
            currentEnemyAttacks.delete(enemyId);
        }

        // Determine which retals are NEW (not previously displayed)
        for (var entry of currentEnemyAttacks) {
            var attackerId = entry[0];
            var retal = entry[1];
            if (!activeRetals.has(attackerId)) {
                newRetals.push(retal);
                debugLog('New retal opportunity:', retal);
            }
        }

        // Update active retals map (clear and repopulate to avoid stale references)
        activeRetals.clear();
        for (var mapEntry of currentEnemyAttacks) {
            activeRetals.set(mapEntry[0], mapEntry[1]);
        }

        // Save to storage
        GM_setValue('tornActiveRetals', Array.from(activeRetals.entries()));

        // Update display differentially
        updateRetalList();

        // Only play sound and flash for new retals
        if (newRetals.length > 0) {
            playNotificationSound();
            flashRetalPanel();
        }

        // Update badge count
        updateBadgeCount();
    }

    // Update retal list differentially (add new, remove stale)
    function updateRetalList() {
        var listEl = document.getElementById('retal-list');
        if (!listEl) return;

        // Get currently displayed attacker IDs
        var displayedItems = listEl.querySelectorAll('.retal-item');
        var displayedIds = new Set();
        for (var i = 0; i < displayedItems.length; i++) {
            displayedIds.add(parseInt(displayedItems[i].dataset.attackerId, 10));
        }

        // Remove items no longer in activeRetals
        for (var j = 0; j < displayedItems.length; j++) {
            var id = parseInt(displayedItems[j].dataset.attackerId, 10);
            if (!activeRetals.has(id)) {
                displayedItems[j].remove();
            }
        }

        // Add new items not yet displayed
        for (var entry of activeRetals) {
            if (!displayedIds.has(entry[0])) {
                var item = createRetalItem(entry[1]);
                listEl.appendChild(item);
            }
        }
    }

    // Create a single retal item element using safe DOM methods
    function createRetalItem(retal) {
        var item = document.createElement('div');
        item.className = 'retal-item';
        item.dataset.attackerId = retal.attackerId;

        var timeAgo = formatTimeAgo(retal.timestamp);
        var resultText = retal.result === 'Lost' ? '❌ Lost' : retal.result === 'Won' ? '✅ Won' : retal.result;

        var dismissBtn = document.createElement('button');
        dismissBtn.className = 'retal-dismiss';
        dismissBtn.dataset.attackerId = retal.attackerId;
        dismissBtn.textContent = '×';

        var victimDiv = document.createElement('div');
        var victimSpan = document.createElement('span');
        victimSpan.className = 'retal-victim';
        victimSpan.textContent = retal.victimName;
        victimDiv.appendChild(victimSpan);
        victimDiv.appendChild(document.createTextNode(' was hit by'));

        var attackerDiv = document.createElement('div');
        var attackerSpan = document.createElement('span');
        attackerSpan.className = 'retal-attacker';
        attackerSpan.textContent = retal.attackerName;
        attackerDiv.appendChild(attackerSpan);
        attackerDiv.appendChild(document.createTextNode(' [' + retal.attackerFaction + ']'));

        var timeDiv = document.createElement('div');
        timeDiv.className = 'retal-time';
        timeDiv.textContent = timeAgo + ' • ' + resultText + ' • ' + retal.respect.toFixed(2) + ' respect';

        var link = document.createElement('a');
        link.href = 'https://www.torn.com/loader.php?sid=attack&user2ID=' + encodeURIComponent(retal.attackerId);
        link.className = 'retal-link';
        link.target = '_blank';
        link.textContent = '⚔️ RETALIATE NOW';

        item.appendChild(dismissBtn);
        item.appendChild(victimDiv);
        item.appendChild(attackerDiv);
        item.appendChild(timeDiv);
        item.appendChild(link);

        return item;
    }

    // Display all retals (used for initial load from storage)
    function displayAllRetals(retals) {
        var listEl = document.getElementById('retal-list');
        if (!listEl) return;

        for (var i = 0; i < retals.length; i++) {
            var item = createRetalItem(retals[i]);
            listEl.appendChild(item);
        }
    }

    // Dismiss a retal opportunity
    function dismissRetal(attackerId) {
        activeRetals.delete(attackerId);
        GM_setValue('tornActiveRetals', Array.from(activeRetals.entries()));

        // Remove from UI
        var items = document.querySelectorAll('.retal-item[data-attacker-id="' + attackerId + '"]');
        for (var i = 0; i < items.length; i++) {
            items[i].remove();
        }

        updateBadgeCount();
        debugLog('Dismissed retal for attacker:', attackerId);
    }

    // Update badge count
    function updateBadgeCount() {
        var listEl = document.getElementById('retal-list');
        var badge = document.getElementById('retal-count-badge');

        if (!listEl || !badge) return;

        var count = listEl.querySelectorAll('.retal-item').length;

        if (count > 0) {
            badge.textContent = count;
            badge.style.display = 'inline-block';
        } else {
            badge.style.display = 'none';
        }
    }

    // Format time ago
    function formatTimeAgo(timestamp) {
        var now = Math.floor(Date.now() / 1000);
        var diff = now - timestamp;

        if (diff < 60) return diff + 's ago';
        if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
        if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
        return Math.floor(diff / 86400) + 'd ago';
    }

    // Play notification sound
    function playNotificationSound() {
        try {
            var audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIHGq97OafTQ8HUKXh8LZmHQw2jdb02m8+AhJkwO/fmU8NEFym4/K5aB4JNI3V89p0QQoQX7Tn66dOFQ1NoeHxtWQcCTKQ1/HWdywEJ3/L8diKOQoXabvt5qBOEAxNpOHwuGcxBjWP1vPbeywGKH3J8NmQOwoXZ7ns551NEAxTp+PwuGorBzOR1/LYdywGJ4HN8tiIOQkXa7zt6KFOEQxPpOPxt2MdCDOP1vPac0UJEX/F89mMPgoXZLrr56JPEwxOo+Xxu2YdCTOP1fLZdC0GJX7K8NuOPAoYZbrw551NEApQp+TwtmQdCTOP1vPadC0GJYHLMdyOOwkYZLnw5p5OEgxPpePyu2UeCTSP1fPbdywFKH7M8NqMOwsVaLnt5qBMEw1Ooyf0uWcdCTKQ1vLYdS4FJn/J8NmNPQ8Xabrv5p5NFAtPoeLwuGgeCC+N1fPbdysGJ4DK8NmNPQ8VZ7nu5qFNEw1Poubwt2QdCTOP1fLYdS4EJn7K8NqNOwsVaLnt5qBNEgtPo+TwuGYdCTSP1vPZdC4EJ3/K8NmMOwsXZ7nx5p9OEQxNoeTwuGYdCDKQ1/LZdSwGJ4HL8NiNOwsXZrrw5p5NEgxNoeTwuGYdCDOP1vLYdSwGJ4HL8NmMOwsWZ7nx5p5OEgxOoubwt2QeCTSQ1fLYdSwGJoDK8dmNOwsXaLrw5p5NEgtOo+TwuGYdCDOP1/LYdSwFKH/K8NmNPAsWaLnt5p5NEgxOo+XvuGcdCDOP1/LXdCwGKIDL8dmNPAsWZ7nx5p5OEgxOo+XwuGYdBzOP1/LYdSwGJ4DL8NmNPAsWZrrx5p5OEgxNo+XwuGYdCDOP1/LYdSwGJ4HL8NiNOwsWZ7rx5p5OEgtOo+XwuGYdCTOP1/LYdCwGJ4DK8dmMOwsWaLrw5p5OEgxNo+TwuGYdBzOQ1/LYdCwGJ4DL8dmMOwsWZ7rx5p5OEgxNo+XwuGYdCDOP1/LYdCwGJ4HL8dmNOwsWZ7rx5p5OEgxNo+XwuGYdCDOP1/LYdCwGJ4DL8NmNOwsWZ7nx5p5OEgxOo+Xwt2YdCDOP1/LYdCwGJ4HL8NmNOwsWZ7nx5p5OEgxOo+Xwt2YdCDOP1/LYdCwGJ4HL8NmNOwsWZ7nx5p5OEgxOo+Xwt2YdCDOP1/LYdCwGJ4HL8NmNOwsWZ7nx5p5OEgxOo+Xwt2YdCDOP');
            audio.play().catch(function() {
                // Silently fail if browser blocks audio
            });
        } catch (e) {
            // Audio not supported or blocked
        }
    }

    // Visual fallback when audio is blocked: brief flash on the panel
    function flashRetalPanel() {
        var panel = document.getElementById('retal-monitor-panel');
        if (!panel) return;
        panel.style.boxShadow = '0 0 20px 5px rgba(255, 68, 68, 0.8)';
        setTimeout(function() {
            panel.style.boxShadow = '';
        }, 400);
    }

    // Initialize
    function init() {
        debugLog('Initializing...');
        createUI();

        // Auto-start monitoring if it was running before
        if (isMonitoring && apiKey && factionId) {
            debugLog('Resuming monitoring from previous session');
            startMonitoring();
        }
    }

    // Wait for page load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
