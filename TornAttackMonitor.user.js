// ==UserScript==
// @name         Torn Attack Monitor
// @namespace    https://xoke.org/
// @version      0.8
// @description  Monitor for attack initiations on Torn
// @author       Xoke
// @match        https://www.torn.com/loader.php?sid=attack*
// @homepageURL  https://github.com/Xoke/torn
// @updateURL    https://raw.githubusercontent.com/Xoke/torn/main/TornAttackMonitor.meta.js
// @downloadURL  https://raw.githubusercontent.com/Xoke/torn/main/TornAttackMonitor.user.js
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const DEBUG = false;

    const CONFIG = {
        NOTIFICATION_HEIGHT: 90,
        NOTIFICATION_MARGIN: 20,
        ATTACKER_EXPIRY_TIME: 30 * 60 * 1000,
        CLEANUP_INTERVAL: 5 * 60 * 1000,
        INIT_RETRY_DELAY: 500,
        MAX_INIT_RETRIES: 40
    };

    function debugLog(...args) {
        if (DEBUG) console.log('[Torn Attack Monitor]', ...args);
    }

    function debugError(...args) {
        if (DEBUG) console.error('[Torn Attack Monitor]', ...args);
    }

    // Store detected attackers with timestamps to avoid duplicates
    const detectedAttackers = new Map();
    const processedNodes = new WeakSet();

    // Inject styles once at startup
    function injectStyles() {
        if (document.getElementById('attack-monitor-styles')) return;

        const style = document.createElement('style');
        style.id = 'attack-monitor-styles';
        style.textContent = `
            @keyframes slideIn {
                from { transform: translateX(400px); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
    }

    // Clean up old attackers from memory (prevent unbounded growth)
    function cleanupOldAttackers() {
        const now = Date.now();
        const expiredAttackers = [];

        for (const [attacker, timestamp] of detectedAttackers.entries()) {
            if (now - timestamp > CONFIG.ATTACKER_EXPIRY_TIME) {
                expiredAttackers.push(attacker);
            }
        }

        expiredAttackers.forEach(attacker => detectedAttackers.delete(attacker));

        if (expiredAttackers.length > 0) {
            debugLog(`Cleaned up ${expiredAttackers.length} old attacker entries from memory`);
        }
    }

    // Run cleanup every 5 minutes
    setInterval(cleanupOldAttackers, CONFIG.CLEANUP_INTERVAL);

    // Function to parse attack initiation from log entries
    function checkLogEntry(logElement) {
        try {
            if (processedNodes.has(logElement)) return;
            processedNodes.add(logElement);

            // Get the message span inside col1
            const messageSpan = logElement.querySelector('.col1____LGQW .message___Z4JCk');
            if (!messageSpan) return;

            const text = messageSpan.textContent.trim();
            if (!text) return;

            let attackerName = null;
            let targetName = null;

            // Look for the pattern "[attacker] initiated an attack against [target]"
            const initiatedRegex = /^(.+?)\s+initiated an attack against\s+(.+?)$/i;
            const initiatedMatch = text.match(initiatedRegex);

            if (initiatedMatch) {
                attackerName = initiatedMatch[1].trim();
                targetName = initiatedMatch[2].trim();
            } else {
                // Look for the pattern "[attacker] joined the fight against [target]"
                const joinedRegex = /^(.+?)\s+joined the fight against\s+(.+?)$/i;
                const joinedMatch = text.match(joinedRegex);

                if (joinedMatch) {
                    attackerName = joinedMatch[1].trim();
                    targetName = joinedMatch[2].trim();
                }
            }

            // If we found an attacker, alert if we haven't seen them recently
            if (attackerName && !detectedAttackers.has(attackerName)) {
                detectedAttackers.set(attackerName, Date.now());
                showNotification(attackerName, targetName);
            }
        } catch (error) {
            debugError('Error checking log entry:', error);
        }
    }

    // Create a visual notification on the page
    function showNotification(attackerName, targetName) {
        try {
            const notification = document.createElement('div');
            notification.className = 'torn-attack-notification';

            const existingNotifications = document.querySelectorAll('.torn-attack-notification');
            const topPosition = CONFIG.NOTIFICATION_MARGIN + (existingNotifications.length * CONFIG.NOTIFICATION_HEIGHT);

            notification.style.cssText = `
                position: fixed;
                top: ${topPosition}px;
                right: ${CONFIG.NOTIFICATION_MARGIN}px;
                background: #ff4444;
                color: white;
                padding: 15px 20px;
                padding-right: 40px;
                border-radius: 5px;
                font-weight: bold;
                z-index: 10000;
                box-shadow: 0 2px 10px rgba(0,0,0,0.3);
                font-size: 16px;
                animation: slideIn 0.3s ease-out;
                min-width: 250px;
            `;

            // Create elements safely using DOM methods to prevent XSS
            const titleDiv = document.createElement('div');
            titleDiv.style.cssText = 'font-size: 18px; margin-bottom: 5px;';
            titleDiv.textContent = '⚠️ NEW ATTACKER!';

            const messageDiv = document.createElement('div');
            messageDiv.style.cssText = 'font-size: 14px;';
            messageDiv.textContent = `${attackerName} → ${targetName}`;

            const closeBtn = document.createElement('button');
            closeBtn.style.cssText = `
                position: absolute;
                top: 5px;
                right: 5px;
                background: rgba(255,255,255,0.3);
                border: none;
                color: white;
                width: 25px;
                height: 25px;
                border-radius: 3px;
                cursor: pointer;
                font-size: 18px;
                line-height: 1;
                font-weight: bold;
            `;
            closeBtn.title = 'Close';
            closeBtn.textContent = '×';

            notification.appendChild(titleDiv);
            notification.appendChild(messageDiv);
            notification.appendChild(closeBtn);

            // Close button functionality
            closeBtn.addEventListener('click', () => {
                notification.remove();
                repositionNotifications();
            });

            // Hover effect for close button
            closeBtn.addEventListener('mouseenter', () => {
                closeBtn.style.background = 'rgba(255,255,255,0.5)';
            });
            closeBtn.addEventListener('mouseleave', () => {
                closeBtn.style.background = 'rgba(255,255,255,0.3)';
            });

            document.body.appendChild(notification);
        } catch (error) {
            debugError('Error showing notification:', error);
        }
    }

    // Reposition all notifications after one is closed
    function repositionNotifications() {
        const notifications = document.querySelectorAll('.torn-attack-notification');
        notifications.forEach((notif, index) => {
            const topPosition = CONFIG.NOTIFICATION_MARGIN + (index * CONFIG.NOTIFICATION_HEIGHT);
            notif.style.top = `${topPosition}px`;
        });
    }

    // Wait for the log container to be available
    let initRetryCount = 0;

    function initializeObserver() {
        const logContainer = document.querySelector('.list___UZYhA');

        if (!logContainer) {
            initRetryCount++;
            if (initRetryCount < CONFIG.MAX_INIT_RETRIES) {
                setTimeout(initializeObserver, CONFIG.INIT_RETRY_DELAY);
            } else {
                debugError('Could not find attack log container after', CONFIG.MAX_INIT_RETRIES, 'retries');
            }
            return;
        }

        debugLog('Log container found, setting up observer');

        // Check existing entries first (in case someone already attacked)
        logContainer.querySelectorAll('.row___XdzXz').forEach(checkLogEntry);

        // Set up MutationObserver to watch for new entries
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1 && node.classList.contains('row___XdzXz')) {
                        checkLogEntry(node);
                    }
                });
            });
        });

        // Start observing the log container - only childList needed
        observer.observe(logContainer, {
            childList: true,
            subtree: false
        });
    }

    // Start when page is ready
    injectStyles();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeObserver);
    } else {
        initializeObserver();
    }

})();
