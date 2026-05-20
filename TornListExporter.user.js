// ==UserScript==
// @name         Torn List Exporter
// @namespace    https://xoke.org/
// @version      1.2
// @description  Export target/enemy names and notes to JSON for import into Target Manager
// @author       Xoke
// @match        https://www.torn.com/page.php?sid=list*
// @homepageURL  https://github.com/Xoke/torn
// @updateURL    https://raw.githubusercontent.com/Xoke/torn/main/TornListExporter.meta.js
// @downloadURL  https://raw.githubusercontent.com/Xoke/torn/main/TornListExporter.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // Note div class prefix — Torn uses CSS modules so the suffix is stable but
    // the base class is what we match on.
    const NOTE_CLASS = 'description___';
    const ROW_CLASS  = 'tableRowWrapper___';

    function extractId(href) {
        const m = href.match(/[?&]XID=(\d+)/i);
        return m ? m[1] : null;
    }

    function collectNotes() {
        const rows = document.querySelectorAll(`li[class*="${ROW_CLASS}"]`);
        const results = [];

        rows.forEach(row => {
            // Get Torn ID from profile link inside this row
            const profileLink = row.querySelector('a[href*="profiles.php?XID="], a[href*="XID="]');
            if (!profileLink) return;
            const tornId = extractId(profileLink.href);
            if (!tornId) return;

            const name = profileLink.textContent.trim();

            // Get the note text from the description div (may be empty)
            const noteDiv = row.querySelector(`div[class*="${NOTE_CLASS}"]`);
            const note = noteDiv ? noteDiv.textContent.trim() : '';

            results.push({ tornId, name, note });
        });

        return results;
    }

    function downloadJson(data) {
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `torn-notes-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function injectButton() {
        if (document.getElementById('tm-export-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'tm-export-btn';
        btn.textContent = 'Export List (Target Manager)';
        btn.style.cssText = [
            'position:fixed',
            'bottom:60px',
            'right:16px',
            'z-index:9999',
            'padding:8px 14px',
            'background:#2a6fdb',
            'color:#fff',
            'border:none',
            'border-radius:6px',
            'font-size:13px',
            'cursor:pointer',
            'box-shadow:0 2px 8px rgba(0,0,0,0.4)',
        ].join(';');

        btn.addEventListener('click', () => {
            const notes = collectNotes();
            if (notes.length === 0) {
                alert('No entries found. Make sure the list is fully loaded.');
                return;
            }
            downloadJson(notes);
            btn.textContent = `Exported ${notes.length} ✓`;
            setTimeout(() => { btn.textContent = 'Export List (Target Manager)'; }, 3000);
        });

        document.body.appendChild(btn);
    }

    // Wait for React to render the list (rows won't exist immediately)
    const observer = new MutationObserver(() => {
        if (document.querySelector(`li[class*="${ROW_CLASS}"]`)) {
            injectButton();
            observer.disconnect();
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    if (document.querySelector(`li[class*="${ROW_CLASS}"]`)) {
        injectButton();
    }
})();
