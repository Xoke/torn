// ==UserScript==
// @name         Torn Faction CSV Exporter
// @namespace    https://xoke.org/
// @version      3.0
// @description  CSV exporter with battle stats sorting (highest to lowest)
// @author       Xoke
// @match        https://www.torn.com/factions.php?*
// @homepageURL  https://github.com/Xoke/torn
// @updateURL    https://raw.githubusercontent.com/Xoke/torn/main/TornFactionCSVExporter.meta.js
// @downloadURL  https://raw.githubusercontent.com/Xoke/torn/main/TornFactionCSVExporter.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const DEBUG = false;
    const VERSION = '3.0';
    const MULTIPLIERS = { k: 1000, m: 1000000, b: 1000000000 };

    function debugLog(...args) {
        if (DEBUG) console.log('[Torn CSV Exporter]', ...args);
    }

    // Show non-blocking notification instead of alert()
    function showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = 'torn-csv-notification';
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed; top: 20px; right: 20px; z-index: 10000;
            padding: 15px 20px; border-radius: 5px;
            background: ${type === 'error' ? '#c43b3b' : '#2d6e2d'};
            color: white; font-weight: bold;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
            transition: opacity 0.3s;
        `;
        document.body.appendChild(notification);
        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    // Sanitize CSV fields: escape quotes, newlines/tabs, and prevent formula injection
    function sanitizeCSVField(str) {
        if (str == null || str === undefined) return '';
        str = String(str);
        str = str.replace(/\r\n/g, ' ').replace(/\n/g, ' ').replace(/\r/g, ' ').replace(/\t/g, ' ');
        str = str.replace(/"/g, '""');
        if (/^[=+\-@\t]/.test(str)) {
            str = "'" + str;
        }
        return str;
    }

    // Convert battle stats text to numeric value for sorting
    function parseBattleStats(statsText) {
        if (!statsText) return 0;

        const clean = statsText.replace(/"/g, '').trim().toLowerCase();
        const match = clean.match(/(\d+\.?\d*)\s*([kmb]?)/);
        if (!match) return 0;

        const number = parseFloat(match[1]);
        const suffix = match[2];

        return number * (MULTIPLIERS[suffix] || 1);
    }

    function createButton() {
        if (!window.location.href.includes('factions.php')) return;
        if (document.getElementById('csv-export-btn')) return;

        const titleArea = document.querySelector('.content-title') ||
                         document.querySelector('.title-black') ||
                         document.querySelector('.content-wrapper .title') ||
                         document.querySelector('h4');
        if (!titleArea) return;

        const btn = document.createElement('button');
        btn.id = 'csv-export-btn';
        btn.className = 'torn-btn';
        btn.textContent = '📊 Export CSV';
        btn.style.marginLeft = '15px';
        btn.style.padding = '8px 15px';

        btn.onclick = exportData;

        titleArea.appendChild(btn);
    }

    function exportData() {
        try {
            let membersTable = document.querySelector('.members-list');
            if (!membersTable) {
                const tables = document.querySelectorAll('.table-body, table');
                for (let i = 0; i < tables.length; i++) {
                    const ffColumns = tables[i].querySelectorAll('.lvl');
                    if (ffColumns.length > 1) {
                        membersTable = tables[i];
                        break;
                    }
                }
            }

            if (!membersTable) {
                showNotification('Could not find faction members table. Make sure FF Scouter has loaded.', 'error');
                return;
            }

            const memberRows = membersTable.querySelectorAll('.table-row');

            if (memberRows.length === 0) {
                showNotification('No member rows found', 'error');
                return;
            }

            const members = [];

            for (let i = 0; i < memberRows.length; i++) {
                const row = memberRows[i];

                if (row.querySelector('.fallen, .fedded')) {
                    continue;
                }

                const memberLink = row.querySelector('a[href*="profiles.php?XID="]');
                if (!memberLink) {
                    continue;
                }

                const name = memberLink.textContent.trim();
                const idMatch = memberLink.href.match(/XID=(\d+)/);
                const id = idMatch ? idMatch[1] : '';

                let level = '';
                const levelElements = row.querySelectorAll('.lvl');
                for (let j = 0; j < levelElements.length; j++) {
                    const levelText = levelElements[j].textContent.trim();
                    if (levelText.match(/^\d+$/) && !levelText.includes('FF')) {
                        level = levelText;
                        break;
                    }
                }

                let battleStats = '';
                const estVisible = row.querySelector('.ff-scouter-est-visible');
                const estHidden = row.querySelector('.ff-scouter-est-hidden');

                if (estVisible) {
                    battleStats = estVisible.textContent.trim();
                } else if (estHidden) {
                    battleStats = estHidden.textContent.trim();
                }

                let status = '';
                const statusElement = row.querySelector('.status');
                if (statusElement) {
                    status = statusElement.textContent.trim();
                }

                members.push({
                    name: name,
                    id: id,
                    level: level,
                    battleStats: battleStats,
                    status: status,
                    battleStatsNumeric: parseBattleStats(battleStats)
                });
            }

            if (members.length === 0) {
                showNotification('No valid member data extracted', 'error');
                return;
            }

            // Sort members by battle stats (highest to lowest)
            members.sort((a, b) => b.battleStatsNumeric - a.battleStatsNumeric);

            // Create CSV with sanitized fields
            let csv = 'Name,ID,Level,Battle Stats Estimate,Status\n';

            for (const member of members) {
                csv += `"${sanitizeCSVField(member.name)}",${member.id},${member.level},"${sanitizeCSVField(member.battleStats)}","${sanitizeCSVField(member.status)}"\n`;
            }

            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `faction_members_sorted_v${VERSION.replace('.', '')}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            showNotification(`Downloaded CSV with ${members.length} faction members (sorted by battle stats)`, 'success');
        } catch (error) {
            debugLog('Export error:', error);
            showNotification('Failed to export CSV: ' + error.message, 'error');
        }
    }

    function init() {
        createButton();
    }

    // Debounce helper
    function debounce(func, wait) {
        let timeout;
        return function() {
            clearTimeout(timeout);
            timeout = setTimeout(func, wait);
        };
    }

    // Add button styling to match Torn's UI
    const style = document.createElement('style');
    style.textContent = '.torn-btn { padding: 5px 10px; background: rgba(51, 51, 51, 0.8); color: #fff; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 3px; cursor: pointer; margin-right: 5px; } .torn-btn:hover { background: rgba(85, 85, 85, 0.9); }';
    document.head.appendChild(style);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Only observe for changes on faction pages
    if (window.location.href.includes('factions.php')) {
        const debouncedCreateButton = debounce(createButton, 500);
        const observer = new MutationObserver(debouncedCreateButton);
        const factionContainer = document.querySelector('#factions-page') || document.body;
        observer.observe(factionContainer, { childList: true, subtree: true });
        debugLog('MutationObserver active on faction page');
    }

})();
