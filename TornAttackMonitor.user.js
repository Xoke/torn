// ==UserScript==
// @name         Torn Attack Monitor
// @namespace    https://xoke.org/
// @version      0.7
// @description  Monitor for attack initiations on Torn
// @author       Xoke
// @match        https://www.torn.com/loader.php?sid=attack*
// @homepageURL  https://github.com/Xoke/torn
// @updateURL    https://raw.githubusercontent.com/Xoke/torn/main/TornAttackMonitor.meta.js
// @downloadURL  https://raw.githubusercontent.com/Xoke/torn/main/TornAttackMonitor.user.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Store detected attackers with timestamps to avoid duplicates
    // Map format: { attackerName: timestamp }
    const detectedAttackers = new Map();
    let notificationCount = 0;
    const ATTACKER_EXPIRY_TIME = 30 * 60 * 1000; // 30 minutes

    // Clean up old attackers from memory (prevent unbounded growth)
    function cleanupOldAttackers() {
        const now = Date.now();
        const expiredAttackers = [];

        for (const [attacker, timestamp] of detectedAttackers.entries()) {
            if (now - timestamp > ATTACKER_EXPIRY_TIME) {
                expiredAttackers.push(attacker);
            }
        }

        expiredAttackers.forEach(attacker => detectedAttackers.delete(attacker));

        if (expiredAttackers.length > 0) {
            console.log(`Cleaned up ${expiredAttackers.length} old attacker entries from memory`);
        }
    }

    // Run cleanup every 5 minutes
    setInterval(cleanupOldAttackers, 5 * 60 * 1000);

    // Function to parse attack initiation from log entries
    function checkLogEntry(logElement) {
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
    }

    // Create a visual notification on the page
    function showNotification(attackerName, targetName) {
        const notification = document.createElement('div');
        const topPosition = 20 + (notificationCount * 90); // Stack notifications
        notificationCount++;

        notification.style.cssText = `
            position: fixed;
            top: ${topPosition}px;
            right: 20px;
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

        // Add animation
        if (!document.getElementById('attack-monitor-styles')) {
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

        // Close button functionality
        closeBtn.addEventListener('click', () => {
            notification.remove();
            notificationCount--;
            // Reposition remaining notifications
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
    }

    // Reposition all notifications after one is closed
    function repositionNotifications() {
        const notifications = document.querySelectorAll('div[style*="position: fixed"][style*="right: 20px"]');
        notifications.forEach((notif, index) => {
            const topPosition = 20 + (index * 90);
            notif.style.top = `${topPosition}px`;
        });
    }

    // Wait for the log container to be available
    let initRetryCount = 0;
    const MAX_INIT_RETRIES = 40; // 40 retries * 500ms = 20 seconds max

    function initializeObserver() {
        const logContainer = document.querySelector('.list___UZYhA');

        if (!logContainer) {
            initRetryCount++;
            if (initRetryCount < MAX_INIT_RETRIES) {
                setTimeout(initializeObserver, 500);
            } else {
                console.error('Torn Attack Monitor: Could not find attack log container after', MAX_INIT_RETRIES, 'retries');
            }
            return;
        }

        console.log('Torn Attack Monitor: Log container found, setting up observer');

        // Check existing entries first (in case someone already attacked)
        logContainer.querySelectorAll('.row___XdzXz').forEach(checkLogEntry);

        // Set up MutationObserver to watch for new entries
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                // Check for added list items
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1 && node.classList.contains('row___XdzXz')) {
                        checkLogEntry(node);
                    }
                });

                // Check for text changes in existing entries
                if (mutation.type === 'characterData' || mutation.type === 'childList') {
                    const listItem = mutation.target.closest('.row___XdzXz');
                    if (listItem) {
                        checkLogEntry(listItem);
                    }
                }
            });
        });

        // Start observing the log container
        observer.observe(logContainer, {
            childList: true,
            characterData: true,
            subtree: true
        });
    }

    // Start when page is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeObserver);
    } else {
        initializeObserver();
    }

})();