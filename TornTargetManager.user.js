// ==UserScript==
// @name         Torn Target Manager
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  Manages a priority queue of elimination targets with live status updates, smart sorting, and bulk import from enemies/targets lists
// @author       Xoke
// @match        https://www.torn.com/*
// @exclude      https://www.torn.com/loader.php*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    console.log('Torn Target Manager: Initializing...');

    // Configuration
    const API_DELAY = 3000; // 3 seconds between API calls
    const IDLE_THRESHOLD = 5 * 60; // 5 minutes in seconds
    const OFFLINE_THRESHOLD = 10 * 60; // 10 minutes in seconds
    const COOLDOWN_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds

    // Storage keys
    const STORAGE_KEY = 'tornTargetQueue';
    const API_KEY_STORAGE = 'tornApiKey';

    // State
    let targetList = [];
    let apiKey = '';
    let isRefreshing = false;
    let autoRefreshInterval = null;
    let targetsPageActive = false;

    // Helper function to escape HTML
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Validate user ID (must be numeric)
    function validateUserId(userId) {
        if (!userId) return false;
        const cleaned = String(userId).trim();
        return /^\d+$/.test(cleaned) && parseInt(cleaned) > 0;
    }

    // Validate API key (basic format check)
    function validateApiKey(key) {
        if (!key) return false;
        const cleaned = String(key).trim();
        // Torn API keys are 16-character alphanumeric strings
        return /^[a-zA-Z0-9]{16}$/.test(cleaned);
    }

    // Helper function to update status message
    function updateStatus(message, type) {
        const statusEl = document.getElementById('loading-status');
        if (!statusEl) return;
        statusEl.textContent = message;
        statusEl.style.color = type === 'error' ? '#ff4444' :
                               type === 'warning' ? '#ffaa00' : '#44ff44';
    }

    // Helper function for safe fetch with timeout
    function safeFetch(url, timeout = 15000) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        return fetch(url, { signal: controller.signal })
            .then(response => {
                clearTimeout(timeoutId);
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                return response.json();
            })
            .catch(error => {
                clearTimeout(timeoutId);
                if (error.name === 'AbortError') {
                    throw new Error('Request timeout');
                }
                throw error;
            });
    }

    // Helper function to determine status state
    function determineStatusState(status, lastActionTimestamp) {
        const now = Math.floor(Date.now() / 1000);
        const state = (status && status.state) || 'unknown';
        const description = (status && status.description) || 'Unknown';

        // Online/Idle/Offline detection
        if (state === 'online' || state === 'Okay') {
            const minsSince = Math.floor((now - (lastActionTimestamp || 0)) / 60);
            if (minsSince <= IDLE_THRESHOLD / 60) return 'online';
            if (minsSince <= OFFLINE_THRESHOLD / 60) return 'idle';
            return 'offline';
        }

        return state;
    }

    // Parse battle stats like "1.5m" to numeric value
    function parseBattleStats(text) {
        if (!text) return 0;
        const clean = text.toLowerCase().replace(/[",\s]/g, '');
        const match = clean.match(/(\d+\.?\d*)([kmb]?)/);
        if (!match) return 0;
        const num = parseFloat(match[1]);
        const suffix = match[2];
        if (suffix === 'k') return num * 1000;
        if (suffix === 'm') return num * 1000000;
        if (suffix === 'b') return num * 1000000000;
        return num;
    }

    // Load settings from storage
    function loadSettings() {
        apiKey = GM_getValue(API_KEY_STORAGE, '');
        try {
            const stored = GM_getValue(STORAGE_KEY, '[]');
            targetList = JSON.parse(stored);
        } catch (e) {
            console.error('Parse error:', e);
            targetList = [];
        }
        console.log(`Loaded ${targetList.length} targets from storage`);
    }

    // Save targets to storage
    function saveTargets() {
        GM_setValue(STORAGE_KEY, JSON.stringify(targetList));
        // Trigger storage event for other tabs
        GM_setValue(STORAGE_KEY + '_timestamp', Date.now().toString());
    }

    // Listen for storage changes from other tabs
    function setupStorageListener() {
        let lastTimestamp = GM_getValue(STORAGE_KEY + '_timestamp', '0');

        // Check for changes every 2 seconds
        setInterval(() => {
            const currentTimestamp = GM_getValue(STORAGE_KEY + '_timestamp', '0');
            if (currentTimestamp !== lastTimestamp) {
                lastTimestamp = currentTimestamp;
                console.log('Targets updated in another tab, reloading data...');
                loadSettings();

                // Update sidebar button text if on profile page
                const urlParams = new URLSearchParams(window.location.search);
                const userId = urlParams.get('XID');
                if (userId) {
                    const sidebarBtn = document.getElementById('tm-add-profile-sidebar-btn');
                    if (sidebarBtn) {
                        const existingTarget = targetList.find(t => t.id === userId);
                        sidebarBtn.textContent = existingTarget ? '🔄 Update Target' : '➕ Add to Targets';
                    }
                }

                // Refresh targets table if it's visible
                if (targetsPageActive) {
                    displayTargetsTable();
                }
            }
        }, 2000);
    }

    // Add "View Targets" button to sidebar
    function addViewTargetsButton() {
        // Check if container already exists (don't duplicate)
        if (document.getElementById('tm-sidebar-container')) return;

        // Try multiple possible locations for the button
        const sidebar = document.querySelector('#sidebarroot') ||
                       document.querySelector('.sidebar') ||
                       document.querySelector('#sidebar') ||
                       document.querySelector('[class*="sidebar"]');

        if (sidebar) {
            const container = document.createElement('div');
            container.id = 'tm-sidebar-container';
            container.style.cssText = 'padding: 10px; margin: 10px 0;';

            const viewButton = document.createElement('button');
            viewButton.id = 'view-targets-btn';
            viewButton.textContent = targetsPageActive ? '← Back to Torn' : '🎯 Target Manager';
            viewButton.className = 'torn-btn tm-sidebar-btn';
            viewButton.style.cssText = 'width: 100%; padding: 10px; font-size: 14px; background: #27ae60; color: white; border: none; border-radius: 4px; cursor: pointer; margin-bottom: 5px; text-align: center; display: flex; align-items: center; justify-content: center;';

            viewButton.addEventListener('click', targetsPageActive ? backToTorn : showTargetsPage);
            viewButton.addEventListener('mouseover', () => viewButton.style.background = '#229954');
            viewButton.addEventListener('mouseout', () => viewButton.style.background = '#27ae60');

            container.appendChild(viewButton);

            // Add profile quick-add button to sidebar as well
            addProfileButtonToSidebar(container);

            sidebar.insertBefore(container, sidebar.firstChild);
            console.log('Target Manager buttons added to sidebar');
        }
    }

    // Add profile quick-add button to sidebar (next to Target Manager button)
    function addProfileButtonToSidebar(container) {
        // Only show on profile pages
        if (!window.location.href.includes('profiles.php')) return;
        if (document.getElementById('tm-add-profile-sidebar-btn')) return;

        const urlParams = new URLSearchParams(window.location.search);
        const userId = urlParams.get('XID');
        if (!userId) return;

        // Check if target already exists to determine button text
        const existingTarget = targetList.find(t => t.id === userId);
        const buttonText = existingTarget ? '🔄 Update Target' : '➕ Add to Targets';

        const profileBtn = document.createElement('button');
        profileBtn.id = 'tm-add-profile-sidebar-btn';
        profileBtn.textContent = buttonText;
        profileBtn.className = 'torn-btn tm-sidebar-btn';
        profileBtn.style.cssText = 'width: 100%; padding: 10px; font-size: 14px; background: #3498db; color: white; border: none; border-radius: 4px; cursor: pointer; margin-bottom: 5px; text-align: center; display: flex; align-items: center; justify-content: center;';

        profileBtn.addEventListener('click', () => addProfileTarget(userId));
        profileBtn.addEventListener('mouseover', () => profileBtn.style.background = '#2980b9');
        profileBtn.addEventListener('mouseout', () => profileBtn.style.background = '#3498db');

        container.appendChild(profileBtn);
    }

    // Use MutationObserver to add button when sidebar appears
    function waitForSidebar() {
        addViewTargetsButton();

        // If container wasn't added, watch for sidebar to appear
        if (!document.getElementById('tm-sidebar-container')) {
            // Watch for specific sidebar containers instead of entire document.body
            const targetNodes = [
                document.getElementById('sidebarroot'),
                document.querySelector('.sidebar'),
                document.querySelector('#sidebar'),
                document.body // Fallback only
            ].filter(Boolean);

            const observer = new MutationObserver(() => {
                addViewTargetsButton();
                if (document.getElementById('tm-sidebar-container')) {
                    observer.disconnect();
                }
            });

            // Observe the most specific container available
            const observeTarget = targetNodes[0] || document.body;
            observer.observe(observeTarget, {
                childList: true,
                subtree: observeTarget === document.body // Only use subtree for body fallback
            });

            // Stop observing after 10 seconds
            setTimeout(() => observer.disconnect(), 10000);
        }
    }


    // Add target from profile page with FF Scouter data
    async function addProfileTarget(userId) {
        const btn = document.getElementById('tm-add-profile-btn');
        const sidebarBtn = document.getElementById('tm-add-profile-sidebar-btn');

        // Validate user ID
        if (!validateUserId(userId)) {
            console.error('Invalid user ID:', userId);
            if (btn) {
                btn.textContent = '❌ Invalid ID';
                setTimeout(() => {
                    btn.textContent = '🎯 Add to Target Manager';
                }, 2000);
            }
            if (sidebarBtn) {
                sidebarBtn.textContent = '❌ Invalid ID';
                setTimeout(() => {
                    sidebarBtn.textContent = '➕ Add to Targets';
                }, 2000);
            }
            return;
        }

        // Check if target already exists
        const existingTarget = targetList.find(t => t.id === userId);
        const isUpdate = !!existingTarget;

        if (btn) {
            btn.textContent = isUpdate ? '⏳ Updating...' : '⏳ Adding...';
            btn.disabled = true;
        }
        if (sidebarBtn) {
            sidebarBtn.textContent = isUpdate ? '⏳ Updating...' : '⏳ Adding...';
            sidebarBtn.disabled = true;
        }

        // Scrape FF Scouter data from profile page
        let fairFight = '?';
        let battleStats = '?';

        // FF Scouter displays data in #ff-scouter-run-once div on profile pages
        // Format: "FairFight:1.26 (Easy) Est. Stats: 29.2m"
        const ffScouterDiv = document.getElementById('ff-scouter-run-once');
        if (ffScouterDiv) {
            const ffText = ffScouterDiv.textContent || ffScouterDiv.innerHTML;

            // Extract Fair Fight value
            const ffMatch = ffText.match(/FairFight:\s*(\d+\.\d+)/i);
            if (ffMatch) {
                fairFight = parseFloat(ffMatch[1]);
            }

            // Extract Battle Stats estimate
            const statsMatch = ffText.match(/Est\.?\s*Stats?:?\s*([0-9.]+[kmb]?)/i);
            if (statsMatch) {
                battleStats = statsMatch[1];
            }
        }

        // Fallback to old method if #ff-scouter-run-once not found
        if (fairFight === '?' || battleStats === '?') {
            const estVisible = document.querySelector('.ff-scouter-est-visible');
            const estHidden = document.querySelector('.ff-scouter-est-hidden');
            if (estVisible) {
                battleStats = estVisible.textContent.trim();
            } else if (estHidden) {
                battleStats = estHidden.textContent.trim();
            }
        }

        // Get user name and level from profile page
        let userName = `User ${userId}`;
        let userLevel = '?';

        const profileName = document.querySelector('.profile-container .name, .user-name, h4');
        if (profileName) {
            userName = profileName.textContent.trim().replace(/\[\d+\]/, '').trim();
        }

        const levelElement = document.querySelector('.level, [class*="level"]');
        if (levelElement) {
            const levelMatch = levelElement.textContent.match(/(\d+)/);
            if (levelMatch) userLevel = parseInt(levelMatch[1]);
        }

        // Update existing target or add new one
        if (isUpdate) {
            // Update existing target with scraped data
            existingTarget.fairFight = fairFight;
            existingTarget.battleStats = battleStats;
            if (userName !== `User ${userId}`) existingTarget.name = userName;
            if (userLevel !== '?') existingTarget.level = userLevel;

            console.log(`Updated target ${userId} with FF: ${fairFight}, Stats: ${battleStats}`);

            if (btn) {
                btn.textContent = '✓ Updated!';
                btn.style.background = '#3498db';
                setTimeout(() => {
                    btn.textContent = '🎯 Update Target';
                    btn.style.background = '#27ae60';
                    btn.disabled = false;
                }, 2000);
            }
            if (sidebarBtn) {
                sidebarBtn.textContent = '✓ Updated!';
                sidebarBtn.style.background = '#2ecc71';
                setTimeout(() => {
                    sidebarBtn.textContent = '🔄 Update Target';
                    sidebarBtn.style.background = '#3498db';
                    sidebarBtn.disabled = false;
                }, 2000);
            }
        } else {
            // Add new target
            targetList.push({
                id: userId,
                name: userName,
                level: userLevel,
                status: { state: 'unknown', description: 'Unknown' },
                lastAction: 0,
                fairFight: fairFight,
                battleStats: battleStats,
                cooldownUntil: 0,
                addedAt: Date.now()
            });

            console.log(`Added target ${userId} with FF: ${fairFight}, Stats: ${battleStats}`);

            if (btn) {
                btn.textContent = '✓ Added!';
                btn.style.background = '#229954';
                setTimeout(() => {
                    btn.textContent = '🎯 Add to Target Manager';
                    btn.style.background = '#27ae60';
                    btn.disabled = false;
                }, 2000);
            }
            if (sidebarBtn) {
                sidebarBtn.textContent = '✓ Added!';
                sidebarBtn.style.background = '#2ecc71';
                setTimeout(() => {
                    sidebarBtn.textContent = '🔄 Update Target';
                    sidebarBtn.style.background = '#3498db';
                    sidebarBtn.disabled = false;
                }, 2000);
            }
        }

        saveTargets();

        // Fetch details if API key available
        if (apiKey) {
            fetchSingleTargetDetails(userId);
        }
    }

    // Add buttons to enemies/targets list pages
    function addListPageButtons() {
        const url = window.location.href;

        // Check for enemies/targets pages: https://www.torn.com/page.php?sid=list&type=enemies
        const isEnemiesPage = url.includes('sid=list&type=enemies') || url.includes('sid=list') && url.includes('type=enemies');
        const isTargetsPage = url.includes('sid=list&type=targets') || url.includes('sid=list') && url.includes('type=targets');

        if (!isEnemiesPage && !isTargetsPage) {
            return;
        }

        const listType = isEnemiesPage ? 'enemies' : 'targets';
        const btnId = `tm-scrape-${listType}-btn`;

        console.log(`Detected ${listType} page, adding button...`);

        if (document.getElementById(btnId)) return;

        // Try multiple times with delays
        let attempts = 0;
        const maxAttempts = 20;

        function tryAddButton() {
            if (document.getElementById(btnId)) return;

            const container = document.getElementById('tm-sidebar-container');

            if (container) {
                const button = document.createElement('button');
                button.id = btnId;
                button.textContent = `🎯 Import ${listType.charAt(0).toUpperCase() + listType.slice(1)}`;
                button.className = 'torn-btn tm-list-btn';
                button.style.cssText = 'width: 100%; padding: 10px; font-size: 14px; background: #9b59b6; color: white !important; border: 1px solid #8e44ad; border-radius: 4px; cursor: pointer; margin-bottom: 5px;';

                button.addEventListener('click', () => scrapeListPage(listType));
                button.addEventListener('mouseover', () => button.style.background = '#8e44ad');
                button.addEventListener('mouseout', () => button.style.background = '#9b59b6');

                container.appendChild(button);
                console.log(`Import ${listType} button added successfully to sidebar`);
            } else {
                attempts++;
                if (attempts < maxAttempts) {
                    setTimeout(tryAddButton, 500);
                } else {
                    console.log('Could not find sidebar container after', maxAttempts, 'attempts');
                }
            }
        }

        // Start trying immediately
        tryAddButton();

        // Also use MutationObserver as backup - watch sidebar area only
        const observer = new MutationObserver(() => {
            tryAddButton();
            if (document.getElementById(btnId)) {
                observer.disconnect();
            }
        });

        // Watch sidebar area instead of entire body
        const sidebarArea = document.getElementById('sidebarroot') ||
                           document.querySelector('.sidebar') ||
                           document.body;
        observer.observe(sidebarArea, {
            childList: true,
            subtree: sidebarArea === document.body // Only use subtree for body fallback
        });
        setTimeout(() => observer.disconnect(), 15000);
    }

    // Scrape enemies/targets list page with FF Scouter data
    function scrapeListPage(listType) {
        const btnId = `tm-scrape-${listType}-btn`;
        const btn = document.getElementById(btnId);

        if (btn) {
            btn.textContent = '⏳ Scraping...';
            btn.disabled = true;
        }

        // Find the user list in the table
        const tableWrapper = document.querySelector('.tableWrapper');

        if (!tableWrapper) {
            alert(`Could not find ${listType} list on this page`);
            if (btn) {
                btn.textContent = `🎯 Import ${listType.charAt(0).toUpperCase() + listType.slice(1)}`;
                btn.disabled = false;
            }
            return;
        }

        // Try multiple selectors for user rows
        let userRows = tableWrapper.querySelectorAll('li');

        // If no <li> elements, try other common row containers
        if (userRows.length === 0) {
            userRows = tableWrapper.querySelectorAll('[class*="user"], [class*="row"]');
        }

        if (userRows.length === 0) {
            alert(`Could not find any users in the ${listType} list`);
            if (btn) {
                btn.textContent = `🎯 Import ${listType.charAt(0).toUpperCase() + listType.slice(1)}`;
                btn.disabled = false;
            }
            console.log('No user rows found. TableWrapper HTML:', tableWrapper.innerHTML.substring(0, 500));
            return;
        }

        console.log(`Found ${userRows.length} potential user rows`);

        let addedCount = 0;

        userRows.forEach(row => {
            // Get user ID from link
            const userLink = row.querySelector('a[href*="XID="]');
            if (!userLink) return;

            const idMatch = userLink.href.match(/XID=(\d+)/);
            if (!idMatch) return;

            const userId = idMatch[1];

            // Skip if already in list
            if (targetList.find(t => t.id === userId)) return;

            // Get user name
            const name = userLink.textContent.trim();

            // Get level - look for .lvl class (same as faction scraper)
            let level = '?';
            const levelElements = row.querySelectorAll('.lvl');
            for (let j = 0; j < levelElements.length; j++) {
                const levelText = levelElements[j].textContent.trim();
                if (levelText.match(/^\d+$/) && !levelText.includes('FF')) {
                    level = parseInt(levelText);
                    break;
                }
            }

            // Get FF Scouter data from the DOM elements FF Scouter adds
            let battleStats = '?';
            let fairFight = '?';

            // FF Scouter adds a .ff-scouter-indicator element with --band-percent CSS variable
            const ffIndicator = row.querySelector('.ff-scouter-indicator');
            if (ffIndicator) {
                // Get the band percent from inline style
                const bandPercent = ffIndicator.style.getPropertyValue('--band-percent');
                if (bandPercent) {
                    // Reverse calculate FF from band percent (default ranges: low=2, high=4, max=8)
                    const percent = parseFloat(bandPercent);
                    let ff;
                    if (percent < 33) {
                        ff = 1 + (percent / 33) * (2 - 1);
                    } else if (percent < 66) {
                        ff = 2 + ((percent - 33) / 33) * (4 - 2);
                    } else {
                        ff = 4 + ((percent - 66) / 34) * (8 - 4);
                    }
                    fairFight = parseFloat(ff.toFixed(2));
                }

                // Try to find battle stats in tooltip or data attributes
                // FF Scouter might store this in the element's title or data attributes
                const honorWrap = row.querySelector('.honorWrap___BHau4');
                if (honorWrap) {
                    const link = honorWrap.querySelector('a');
                    if (link && link.title) {
                        // Parse title for battle stats
                        const statsMatch = link.title.match(/Est\.?\s*Stats?:?\s*([0-9.]+[kmb]?)/i);
                        if (statsMatch) {
                            battleStats = statsMatch[1];
                        }
                    }
                }
            }

            console.log(`Scraped user ${name} [${userId}]: Level=${level}, FF=${fairFight}, Stats=${battleStats}`);

            // Add target
            targetList.push({
                id: userId,
                name: name,
                level: level,
                status: { state: 'unknown', description: 'Unknown' },
                lastAction: 0,
                fairFight: fairFight,
                battleStats: battleStats,
                cooldownUntil: 0,
                addedAt: Date.now()
            });

            addedCount++;
        });

        saveTargets();

        if (btn) {
            btn.textContent = `✓ Added ${addedCount} targets!`;
            btn.style.background = '#27ae60';
            setTimeout(() => {
                btn.textContent = `🎯 Import ${listType.charAt(0).toUpperCase() + listType.slice(1)}`;
                btn.style.background = '#9b59b6';
                btn.disabled = false;
            }, 3000);
        }

        alert(`Added ${addedCount} targets from ${listType} list!\n\nFF Scouter data has been captured.\n\nClick "Target Manager" to view and manage them.`);
        console.log(`Scraped ${addedCount} targets from ${listType} page`);
    }

    // Back to Torn function
    function backToTorn() {
        targetsPageActive = false;
        stopAutoRefresh();
        window.location.reload();
    }

    // Show full targets page
    function showTargetsPage() {
        targetsPageActive = true;

        // Update sidebar button text
        const viewBtn = document.getElementById('view-targets-btn');
        if (viewBtn) {
            viewBtn.textContent = '← Back to Torn';
            // Update click handler
            const oldHandler = viewBtn.onclick;
            viewBtn.onclick = null;
            viewBtn.addEventListener('click', backToTorn);
        }

        const content = document.querySelector('.content-wrapper[role="main"]') ||
                       document.querySelector('#mainContainer') ||
                       document.querySelector('.content') ||
                       document.body;

        if (!content) return;

        const html = `
            <div class="target-manager-container">
                <div class="content-title">
                    <h4>🎯 Target Manager</h4>
                    <button id="back-to-torn" class="torn-btn" style="float: right;">← Back to Torn</button>
                </div>

                <div class="tm-controls">
                    <div class="control-group">
                        <label>API Key: <input type="password" id="tm-api-key" placeholder="Required for imports" value="${escapeHtml(apiKey)}" style="width: 200px;"></label>
                        <button id="tm-save-api" class="torn-btn">Save API Key</button>
                    </div>

                    <div class="control-group">
                        <button id="tm-import-enemies" class="torn-btn import-btn">📥 Import Enemies</button>
                        <button id="tm-import-targets" class="torn-btn import-btn">📥 Import Targets</button>
                        <button id="tm-clear-all" class="torn-btn danger-btn">🗑️ Clear All</button>
                    </div>

                    <div class="control-group">
                        <label><input type="text" id="tm-add-id" placeholder="User ID" style="width: 120px;"></label>
                        <button id="tm-add-single" class="torn-btn">Add Target</button>
                    </div>
                </div>

                <div class="tm-filters">
                    <div class="filter-group">
                        <label><input type="checkbox" id="auto-refresh"> Auto-refresh (${API_DELAY/1000}s)</label>
                        <button id="manual-refresh" class="torn-btn">🔄 Refresh Now</button>
                    </div>
                    <p style="margin: 10px 0; color: #888; font-size: 13px;">
                        💡 Targets are automatically sorted: Best available targets (attackable, same country) appear at the top, sorted by Fair Fight value.
                    </p>
                </div>

                <div id="loading-status" style="margin: 10px 0; font-weight: bold;"></div>
                <div id="targets-display"></div>
            </div>
        `;

        content.innerHTML = html;

        // Event listeners
        document.getElementById('back-to-torn').addEventListener('click', () => {
            targetsPageActive = false;
            stopAutoRefresh();
            window.location.reload();
        });

        document.getElementById('tm-save-api').addEventListener('click', saveApiKeyFromInput);
        document.getElementById('tm-import-enemies').addEventListener('click', () => importBulk('enemies'));
        document.getElementById('tm-import-targets').addEventListener('click', () => importBulk('targets'));
        document.getElementById('tm-clear-all').addEventListener('click', clearAllTargets);
        document.getElementById('tm-add-single').addEventListener('click', addSingleTarget);
        document.getElementById('tm-add-id').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') addSingleTarget();
        });

        document.getElementById('manual-refresh').addEventListener('click', refreshAllTargets);
        document.getElementById('auto-refresh').addEventListener('change', (e) => {
            if (e.target.checked) startAutoRefresh();
            else stopAutoRefresh();
        });

        // Display existing targets
        displayTargetsTable();
        updateStatus(`Loaded ${targetList.length} targets`, 'success');
    }

    // Save API key
    function saveApiKeyFromInput() {
        const input = document.getElementById('tm-api-key');
        if (!input) return;

        const key = input.value.trim();
        if (!key) {
            updateStatus('Please enter an API key', 'error');
            return;
        }

        if (!validateApiKey(key)) {
            updateStatus('Invalid API key format (must be 16 alphanumeric characters)', 'error');
            return;
        }

        apiKey = key;
        updateStatus('Validating API key...', 'warning');

        safeFetch(`https://api.torn.com/user/?selections=basic&key=${encodeURIComponent(apiKey)}`)
            .then(data => {
                if (data.error) {
                    updateStatus(`Invalid API key: ${data.error.error}`, 'error');
                    return;
                }
                GM_setValue(API_KEY_STORAGE, apiKey);
                updateStatus(`✅ API key validated for ${escapeHtml(data.name)}`, 'success');
            })
            .catch(error => {
                updateStatus(`❌ Validation failed: ${error.message}`, 'error');
            });
    }

    // Import bulk targets
    async function importBulk(listType) {
        if (!apiKey) {
            updateStatus('Please save your API key first', 'error');
            return;
        }

        const btnId = listType === 'enemies' ? 'tm-import-enemies' : 'tm-import-targets';
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.disabled = true;
            btn.textContent = '⏳ Loading...';
        }

        updateStatus(`Fetching ${listType} list...`, 'warning');

        try {
            // First get our own player ID
            const basicData = await safeFetch(`https://api.torn.com/user/?selections=basic&key=${encodeURIComponent(apiKey)}`);

            if (basicData.error) {
                updateStatus(`API Error: ${basicData.error.error}`, 'error');
                return;
            }

            const myPlayerId = basicData.player_id.toString();

            // Then get attacks
            const attacksData = await safeFetch(`https://api.torn.com/user/?selections=attacks&key=${encodeURIComponent(apiKey)}`);

            if (attacksData.error) {
                updateStatus(`API Error: ${attacksData.error.error}`, 'error');
                return;
            }

            // Extract unique user IDs from attacks based on list type
            const attacks = attacksData.attacks || {};
            const userIds = new Set();

            for (const attackId in attacks) {
                const attack = attacks[attackId];
                if (listType === 'enemies') {
                    // For enemies, we want people who attacked us (we were defender)
                    if (attack.defender_id && attack.defender_id.toString() === myPlayerId) {
                        userIds.add(attack.attacker_id.toString());
                    }
                } else {
                    // For targets, we want people we attacked (we were attacker)
                    if (attack.attacker_id && attack.attacker_id.toString() === myPlayerId) {
                        userIds.add(attack.defender_id.toString());
                    }
                }
            }

            if (userIds.size === 0) {
                updateStatus(`No recent ${listType} found in attack history`, 'warning');
                return;
            }

            let addedCount = 0;
            for (const userId of userIds) {
                if (!targetList.find(t => t.id === userId)) {
                    targetList.push({
                        id: userId,
                        name: `User ${userId}`,
                        level: '?',
                        status: { state: 'unknown', description: 'Unknown' },
                        lastAction: 0,
                        fairFight: '?',
                        battleStats: '?',
                        cooldownUntil: 0,
                        addedAt: Date.now()
                    });
                    addedCount++;
                }
            }

            saveTargets();
            displayTargetsTable();
            updateStatus(`✅ Added ${addedCount} new targets from ${listType} list`, 'success');

            // Auto-refresh to get details
            if (addedCount > 0) {
                setTimeout(() => refreshAllTargets(), 1000);
            }

        } catch (error) {
            updateStatus(`❌ Import failed: ${error.message}`, 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = listType === 'enemies' ? '📥 Import Enemies' : '📥 Import Targets';
            }
        }
    }

    // Add single target
    function addSingleTarget() {
        const input = document.getElementById('tm-add-id');
        if (!input) return;

        const userId = input.value.trim();
        if (!validateUserId(userId)) {
            updateStatus('Please enter a valid user ID (numbers only)', 'error');
            return;
        }

        if (targetList.find(t => t.id === userId)) {
            updateStatus('Target already in list', 'warning');
            return;
        }

        targetList.push({
            id: userId,
            name: `User ${userId}`,
            level: '?',
            status: { state: 'unknown', description: 'Unknown' },
            lastAction: 0,
            fairFight: '?',
            battleStats: '?',
            cooldownUntil: 0,
            addedAt: Date.now()
        });

        saveTargets();
        displayTargetsTable();
        input.value = '';
        updateStatus(`✅ Added target ${userId}`, 'success');

        // Fetch details if API key available
        if (apiKey) {
            fetchSingleTargetDetails(userId);
        }
    }

    // Fetch details for a single target (updates display immediately when data arrives)
    async function fetchSingleTargetDetails(userId) {
        if (!validateUserId(userId)) return;

        try {
            const data = await safeFetch(`https://api.torn.com/user/${encodeURIComponent(userId)}?selections=profile&key=${encodeURIComponent(apiKey)}`);

            if (data.error) {
                console.error(`API error for user ${userId}:`, data.error);
                return;
            }

            const target = targetList.find(t => t.id === userId);
            if (target) {
                target.name = data.name || target.name;
                target.level = data.level || target.level;
                target.status = {
                    state: data.status?.state || 'unknown',
                    description: data.status?.description || 'Unknown'
                };
                target.lastAction = data.last_action?.timestamp || 0;

                // Immediately save and update display
                saveTargets();
                displayTargetsTable();
                console.log(`Updated target ${userId}: ${target.name} - ${target.status.description}`);
            }
        } catch (error) {
            console.error(`Error fetching target ${userId}:`, error);
        }
    }

    // Clear all targets
    function clearAllTargets() {
        if (!confirm('Are you sure you want to remove all targets?')) return;

        targetList = [];
        saveTargets();
        displayTargetsTable();
        updateStatus('All targets cleared', 'success');
    }

    // Refresh all targets
    async function refreshAllTargets() {
        if (!apiKey) {
            updateStatus('Please save your API key first', 'error');
            return;
        }

        if (isRefreshing) {
            console.log('Refresh already in progress');
            return;
        }

        if (targetList.length === 0) {
            updateStatus('No targets to refresh', 'warning');
            return;
        }

        isRefreshing = true;
        const btn = document.getElementById('manual-refresh');
        if (btn) {
            btn.disabled = true;
            btn.textContent = '⏳ Refreshing...';
        }

        updateStatus('Refreshing target data...', 'warning');

        try {
            // Fetch targets one by one and update display immediately
            for (let i = 0; i < targetList.length; i++) {
                const target = targetList[i];

                try {
                    const data = await safeFetch(`https://api.torn.com/user/${encodeURIComponent(target.id)}?selections=profile&key=${encodeURIComponent(apiKey)}`);

                    if (data.error) {
                        if (data.error.code === 2 || data.error.code === 10) {
                            updateStatus(`❌ API Error: ${data.error.error}`, 'error');
                            break;
                        }
                        continue;
                    }

                    target.name = data.name || target.name;
                    target.level = data.level || target.level;
                    target.status = {
                        state: data.status?.state || 'unknown',
                        description: data.status?.description || 'Unknown'
                    };
                    target.lastAction = data.last_action?.timestamp || 0;

                    // Update display immediately after each target is fetched
                    saveTargets();
                    displayTargetsTable();
                    updateStatus(`Refreshing... ${i + 1}/${targetList.length}`, 'warning');

                    // Delay between requests
                    if (i < targetList.length - 1) {
                        await sleep(API_DELAY);
                    }

                } catch (error) {
                    console.error(`Error fetching ${target.id}:`, error);
                }
            }

            updateStatus(`✅ Refreshed ${targetList.length} targets at ${new Date().toLocaleTimeString()}`, 'success');

        } catch (error) {
            updateStatus(`❌ Refresh failed: ${error.message}`, 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = '🔄 Refresh Now';
            }
            isRefreshing = false;
        }
    }

    // Auto-refresh
    function startAutoRefresh() {
        stopAutoRefresh();
        console.log('Auto-refresh started');
        autoRefreshInterval = setInterval(refreshAllTargets, API_DELAY * 10); // Every 30 seconds
        refreshAllTargets(); // Immediate first refresh
    }

    function stopAutoRefresh() {
        if (autoRefreshInterval) {
            clearInterval(autoRefreshInterval);
            autoRefreshInterval = null;
            console.log('Auto-refresh stopped');
        }
    }

    // Display targets table
    function displayTargetsTable() {
        const container = document.getElementById('targets-display');
        if (!container) return;

        if (targetList.length === 0) {
            container.innerHTML = '<p style="text-align: center; padding: 40px; color: #888;">No targets loaded. Import from your enemies/targets list or add manually.</p>';
            return;
        }

        // Smart sorting: Best available targets first
        const sorted = [...targetList].sort((a, b) => {
            const aCooldown = a.cooldownUntil > Date.now();
            const bCooldown = b.cooldownUntil > Date.now();
            const aState = determineStatusState(a.status, a.lastAction);
            const bState = determineStatusState(b.status, b.lastAction);

            // Define attackability: not on cooldown, not in hospital/traveling/jail
            const unattackableStates = ['hospital', 'traveling', 'jail'];
            const aAttackable = !aCooldown && !unattackableStates.includes(aState);
            const bAttackable = !bCooldown && !unattackableStates.includes(bState);

            // Attackable targets always go first
            if (aAttackable && !bAttackable) return -1;
            if (!aAttackable && bAttackable) return 1;

            // Among attackable targets, sort by Fair Fight (lower FF = easier = better)
            if (aAttackable && bAttackable) {
                const aFF = parseFloat(a.fairFight) || 999;
                const bFF = parseFloat(b.fairFight) || 999;
                if (aFF !== bFF) return aFF - bFF;

                // If FF is the same, prefer online/idle over offline
                const onlineOrder = { online: 0, idle: 1, offline: 2 };
                const aOnline = onlineOrder[aState] !== undefined ? onlineOrder[aState] : 3;
                const bOnline = onlineOrder[bState] !== undefined ? onlineOrder[bState] : 3;
                return aOnline - bOnline;
            }

            // Among unattackable targets, sort by status (cooldown first, then hospital, traveling, jail)
            if (aCooldown && !bCooldown) return -1;
            if (!aCooldown && bCooldown) return 1;

            const stateOrder = { hospital: 0, traveling: 1, jail: 2, unknown: 3 };
            return (stateOrder[aState] || 99) - (stateOrder[bState] || 99);
        });

        const now = Math.floor(Date.now() / 1000);

        let rows = '';
        sorted.forEach(target => {
            const statusState = determineStatusState(target.status, target.lastAction);
            const statusDesc = target.status?.description || 'Unknown';
            const lastActionRel = target.lastAction ? formatTimeSince(now - target.lastAction) : '-';
            const ff = target.fairFight || '-';
            const stats = target.battleStats || '-';

            const onCooldown = target.cooldownUntil > Date.now();
            const cooldownTime = onCooldown ? formatCooldown(target.cooldownUntil - Date.now()) : '';

            rows += `<tr data-status="${statusState}" data-cooldown="${onCooldown ? '1' : '0'}" data-ff="${ff}" data-user-id="${target.id}">
                <td class="delete-col">
                    <button class="remove-btn" data-action="remove" data-target-id="${escapeHtml(target.id)}" title="Remove target">✕</button>
                </td>
                <td><a href="/profiles.php?XID=${escapeHtml(target.id)}" target="_blank" class="target-name-link">${escapeHtml(target.name)}</a> [${target.id}]</td>
                <td>${escapeHtml(String(target.level))}</td>
                <td class="status-${statusState}">${escapeHtml(statusDesc)}</td>
                <td>${lastActionRel}</td>
                <td class="ff-score">${escapeHtml(String(ff))}</td>
                <td>${escapeHtml(String(stats))}</td>
                <td class="action-col">
                    ${onCooldown ?
                        `<span class="cooldown-badge">⏱️ ${cooldownTime}</span>` :
                        `<a href="/loader.php?sid=attack&user2ID=${escapeHtml(target.id)}" target="_blank" class="attack-btn" data-action="attack" data-target-id="${escapeHtml(target.id)}">⚔️ Attack</a>`
                    }
                </td>
            </tr>`;
        });

        container.innerHTML = `
            <table class="targets-table">
                <thead>
                    <tr>
                        <th class="delete-col">✕</th>
                        <th>Name</th>
                        <th>Level</th>
                        <th>Status</th>
                        <th>Last Action</th>
                        <th>Fair Fight</th>
                        <th>Battle Stats</th>
                        <th>Attack</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        `;

        // Set up event delegation for action buttons
        setupTableEventDelegation(container);
    }

    // Set up event delegation for table actions (prevents XSS)
    function setupTableEventDelegation(container) {
        // Remove old listener if exists
        const oldTable = container.querySelector('.targets-table');
        if (oldTable && oldTable._tmClickHandler) {
            oldTable.removeEventListener('click', oldTable._tmClickHandler);
        }

        const table = container.querySelector('.targets-table');
        if (!table) return;

        const clickHandler = function(event) {
            const target = event.target.closest('[data-action]');
            if (!target) return;

            const action = target.getAttribute('data-action');
            const userId = target.getAttribute('data-target-id');

            if (!userId) return;

            if (action === 'attack') {
                event.preventDefault();
                markCooldown(userId);
                // Open attack page in new tab
                window.open(`/loader.php?sid=attack&user2ID=${encodeURIComponent(userId)}`, '_blank');
            } else if (action === 'remove') {
                removeTarget(userId);
            }
        };

        table.addEventListener('click', clickHandler);
        table._tmClickHandler = clickHandler; // Store reference for cleanup
    }

    // Mark target as on cooldown
    function markCooldown(userId) {
        const target = targetList.find(t => t.id === userId);
        if (target) {
            target.cooldownUntil = Date.now() + COOLDOWN_DURATION;
            saveTargets();
            displayTargetsTable();
        }
    }

    // Remove target from list
    function removeTarget(userId) {
        targetList = targetList.filter(t => t.id !== userId);
        saveTargets();
        displayTargetsTable();
        updateStatus('Target removed', 'success');
    }


    // Format time since
    function formatTimeSince(seconds) {
        if (seconds < 60) return `${seconds}s`;
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;

        const days = Math.floor(seconds / 86400);
        // 90 days = 3 months
        if (days > 90) return '>3m';
        return `${days}d`;
    }

    // Format cooldown
    function formatCooldown(ms) {
        const seconds = Math.ceil(ms / 1000);
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    // Sleep utility
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Add CSS styles
    GM_addStyle(`
        .target-manager-container {
            padding: 20px;
            color: inherit;
        }

        .tm-controls, .tm-filters {
            background: rgba(128, 128, 128, 0.1);
            padding: 15px;
            margin: 15px 0;
            border-radius: 5px;
            border: 1px solid rgba(128, 128, 128, 0.2);
        }

        .control-group, .filter-group {
            margin: 10px 0;
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
            align-items: center;
        }

        .control-group label, .filter-group label {
            display: flex;
            align-items: center;
            gap: 5px;
        }

        .torn-btn {
            padding: 8px 15px;
            background: rgba(51, 51, 51, 0.8);
            color: #fff;
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 4px;
            cursor: pointer;
        }

        .torn-btn:hover {
            background: rgba(85, 85, 85, 0.9);
        }

        .torn-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .import-btn {
            background: #9b59b6;
        }

        .import-btn:hover {
            background: #8e44ad;
        }

        .danger-btn {
            background: #e74c3c;
        }

        .danger-btn:hover {
            background: #c0392b;
        }

        input[type="password"], input[type="text"], input[type="number"] {
            background: rgba(255, 255, 255, 0.05);
            color: inherit;
            padding: 6px;
            border: 1px solid rgba(128, 128, 128, 0.3);
            border-radius: 3px;
        }

        .targets-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
        }

        .targets-table th, .targets-table td {
            padding: 10px;
            border: 1px solid rgba(128, 128, 128, 0.3);
            text-align: left;
        }

        .delete-col {
            width: 50px;
            text-align: center !important;
            padding: 5px !important;
        }

        .action-col {
            width: 120px;
            text-align: center !important;
            white-space: nowrap;
        }

        .target-name-link {
            color: #3498db !important;
            text-decoration: none;
            font-weight: bold;
        }

        .target-name-link:hover {
            color: #2980b9 !important;
            text-decoration: underline;
        }

        .targets-table th {
            background: rgba(0, 0, 0, 0.3);
            font-weight: bold;
        }

        .targets-table tr:nth-child(even) {
            background: rgba(128, 128, 128, 0.05);
        }

        .targets-table tr:hover {
            background: rgba(128, 128, 128, 0.15);
        }

        .status-online { color: #44ff44 !important; font-weight: bold; }
        .status-idle { color: #ffaa00 !important; font-weight: bold; }
        .status-offline { color: #888 !important; }
        .status-hospital { color: #ff4444 !important; font-weight: bold; }
        .status-traveling { color: #4da6ff !important; font-weight: bold; }
        .status-jail { color: #ff9933 !important; font-weight: bold; }

        .attack-btn, .attack-btn:link, .attack-btn:visited, .attack-btn:active {
            padding: 5px 10px;
            background: #e74c3c !important;
            color: #ffffff !important;
            text-decoration: none !important;
            border-radius: 3px;
            border: 1px solid #c0392b !important;
            cursor: pointer;
            display: inline-block;
            white-space: nowrap;
            font-weight: 600;
            text-shadow: 0 1px 2px rgba(0,0,0,0.5);
            box-shadow: 0 2px 4px rgba(0,0,0,0.3) !important;
        }

        .attack-btn:hover {
            background: #c0392b !important;
            color: #ffffff !important;
            box-shadow: 0 3px 6px rgba(0,0,0,0.4) !important;
        }

        .remove-btn {
            padding: 4px 8px;
            background: #e74c3c;
            color: white;
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 16px;
            font-weight: bold;
            line-height: 1;
        }

        .remove-btn:hover {
            background: #c0392b;
        }

        .cooldown-badge {
            padding: 5px 10px;
            background: #555;
            color: #f39c12;
            border-radius: 3px;
            display: inline-block;
            font-weight: bold;
            white-space: nowrap;
        }

        .ff-score {
            color: #3498db !important;
            font-weight: bold;
        }

        /* Button visibility for dark and light modes */
        .tm-sidebar-btn, .tm-profile-btn, .tm-list-btn {
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        }

        .tm-profile-btn, .tm-list-btn {
            text-shadow: 0 1px 2px rgba(0,0,0,0.3);
        }
    `);

    // Initialize
    function init() {
        loadSettings();
        setupStorageListener();
        waitForSidebar();
        addListPageButtons();
        console.log('Torn Target Manager: Initialized successfully');
    }

    // Start on page load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
