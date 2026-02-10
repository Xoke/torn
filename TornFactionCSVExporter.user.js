// ==UserScript==
// @name         Torn Faction CSV Exporter
// @namespace    https://xoke.org/
// @version      2.8
// @description  CSV exporter with battle stats sorting (highest to lowest)
// @author       Xoke
// @match        https://www.torn.com/factions.php?*
// @homepageURL  https://github.com/Xoke/torn
// @updateURL    https://raw.githubusercontent.com/Xoke/torn/main/TornFactionCSVExporter.meta.js
// @downloadURL  https://raw.githubusercontent.com/Xoke/torn/main/TornFactionCSVExporter.user.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Convert battle stats text to numeric value for sorting
    function parseBattleStats(statsText) {
        if (!statsText) return 0;

        var clean = statsText.replace(/"/g, '').trim().toLowerCase();
        var match = clean.match(/(\d+\.?\d*)\s*([kmb]?)/);
        if (!match) return 0;

        var number = parseFloat(match[1]);
        var suffix = match[2];

        if (suffix === 'k') return number * 1000;
        if (suffix === 'm') return number * 1000000;
        if (suffix === 'b') return number * 1000000000;
        return number;
    }

    function createButton() {
        if (!window.location.href.includes('factions.php')) return;
        if (document.getElementById('csv-export-btn')) return;

        var titleArea = document.querySelector('.content-title');
        if (!titleArea) titleArea = document.querySelector('.title-black');
        if (!titleArea) titleArea = document.querySelector('.content-wrapper .title');
        if (!titleArea) titleArea = document.querySelector('h4');
        if (!titleArea) return;

        var btn = document.createElement('button');
        btn.id = 'csv-export-btn';
        btn.className = 'torn-btn';
        btn.innerHTML = '📊 Export CSV';
        btn.style.marginLeft = '15px';
        btn.style.padding = '8px 15px';

        btn.onclick = function() {
            exportData();
        };

        titleArea.appendChild(btn);
    }

    function exportData() {
        var membersTable = document.querySelector('.members-list');
        if (!membersTable) {
            var tables = document.querySelectorAll('.table-body, table');
            for (var i = 0; i < tables.length; i++) {
                var ffColumns = tables[i].querySelectorAll('.lvl');
                if (ffColumns.length > 1) {
                    membersTable = tables[i];
                    break;
                }
            }
        }

        if (!membersTable) {
            alert('Could not find faction members table. Make sure FF Scouter has loaded.');
            return;
        }

        var memberRows = membersTable.querySelectorAll('.table-row');

        if (memberRows.length === 0) {
            alert('No member rows found');
            return;
        }

        var members = [];

        for (var i = 0; i < memberRows.length; i++) {
            var row = memberRows[i];

            if (row.querySelector('.fallen, .fedded')) {
                continue;
            }

            var memberLink = row.querySelector('a[href*="profiles.php?XID="]');
            if (!memberLink) {
                continue;
            }

            var name = memberLink.textContent.trim();
            var idMatch = memberLink.href.match(/XID=(\d+)/);
            var id = idMatch ? idMatch[1] : '';

            var level = '';
            var levelElements = row.querySelectorAll('.lvl');
            for (var j = 0; j < levelElements.length; j++) {
                var levelText = levelElements[j].textContent.trim();
                if (levelText.match(/^\d+$/) && !levelText.includes('FF')) {
                    level = levelText;
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

            var status = '';
            var statusElement = row.querySelector('.status');
            if (statusElement) {
                status = statusElement.textContent.trim();
            }

            // Store member data for sorting
            members.push({
                name: name,
                id: id,
                level: level,
                battleStats: battleStats,
                status: status,
                battleStatsNumeric: parseBattleStats(battleStats)
            });
        }

        // Sort members by battle stats (highest to lowest)
        members.sort(function(a, b) {
            return b.battleStatsNumeric - a.battleStatsNumeric;
        });

        // Create CSV
        var csv = 'Name,ID,Level,Battle Stats Estimate,Status\n';

        // Add sorted members to CSV
        for (var k = 0; k < members.length; k++) {
            var member = members[k];
            csv += '"' + member.name + '",' + member.id + ',' + member.level + ',"' + member.battleStats + '","' + member.status + '"\n';
        }

        if (members.length === 0) {
            alert('No valid member data extracted');
            return;
        }

        var blob = new Blob([csv], { type: 'text/csv' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'faction_members_sorted_v26.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        alert('Downloaded CSV with ' + members.length + ' faction members (v2.6 - sorted by battle stats)');
    }

    function init() {
        createButton();
    }

    // Add button styling to match Torn's UI
    var style = document.createElement('style');
    style.textContent = '.torn-btn { padding: 5px 10px; background: rgba(51, 51, 51, 0.8); color: #fff; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 3px; cursor: pointer; margin-right: 5px; } .torn-btn:hover { background: rgba(85, 85, 85, 0.9); }';
    document.head.appendChild(style);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Only observe for changes on faction pages
    if (window.location.href.includes('factions.php')) {
        var observer = new MutationObserver(createButton);
        var factionContainer = document.querySelector('#factions-page') || document.body;
        observer.observe(factionContainer, { childList: true, subtree: true });
        console.log('[Torn CSV Exporter] MutationObserver active on faction page');
    }

})();