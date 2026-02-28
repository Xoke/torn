// ==UserScript==
// @name         Torn Heal Advisor
// @namespace    https://xoke.org/
// @version      1.0
// @description  Recommends the most efficient healing item based on your remaining hospital time
// @author       Xoke
// @match        https://www.torn.com/item.php*
// @match        https://www.torn.com/factions.php*
// @homepageURL  https://github.com/Xoke/torn
// @updateURL    https://raw.githubusercontent.com/Xoke/torn/main/TornHealAdvisor.meta.js
// @downloadURL  https://raw.githubusercontent.com/Xoke/torn/main/TornHealAdvisor.user.js
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // ─── Item config ──────────────────────────────────────────────────────
    // Adjust cooldownMinutes to match actual Torn values if these are off.
    //
    // Strategy: find the highest-cooldown item whose cooldown still FITS within
    // your remaining hospital time. That way the cooldown expires before you leave,
    // letting you use another item — maximising total heals per hospital stay.
    // If no item fits (hospital time < smallest cooldown), use the smallest item
    // to minimise how long you're on cooldown after you're discharged.
    const ITEMS = [
        {
            name: 'Small First Aid Kit',
            cooldownMinutes: 30,
            matchNames: ['Small First Aid Kit'],
        },
        {
            name: 'First Aid Kit',
            cooldownMinutes: 60,
            matchNames: ['First Aid Kit'],
        },
        {
            name: 'Blood Bag',
            cooldownMinutes: 90,
            displayNote: 'check blood type compatibility',
            matchNames: ['Blood Bag O', 'Blood Bag A', 'Blood Bag B', 'Blood Bag AB'],
        },
        {
            name: 'Morphine',
            cooldownMinutes: 120,
            matchNames: ['Morphine'],
        },
    ];
    // Must be sorted ascending by cooldown for the recommendation logic to work.
    ITEMS.sort((a, b) => a.cooldownMinutes - b.cooldownMinutes);

    // ─── Hospital time parsing ────────────────────────────────────────────
    function parseMinutes(str) {
        let m = 0;
        const h   = str.match(/(\d+)\s*h/i);
        const min = str.match(/(\d+)\s*m(?!o)/i);   // "m" but not "mo" (month)
        const sec = str.match(/(\d+)\s*s/i);
        if (h)   m += parseInt(h[1]) * 60;
        if (min) m += parseInt(min[1]);
        if (sec) m += parseInt(sec[1]) / 60;
        return m;
    }

    function getHospitalMinutes() {
        // Torn status bar uses aria-labels on its status icon elements.
        // Drug Cooldown uses "[aria-label^='Drug Cooldown:']" — hospital likely similar.
        const ariaEl = document.querySelector('[aria-label*="Hospital"], [title*="Hospital"]');
        if (ariaEl) {
            const text = ariaEl.getAttribute('aria-label') || ariaEl.getAttribute('title') || '';
            if (/hospital/i.test(text)) {
                const mins = parseMinutes(text);
                if (mins > 0) return mins;
            }
        }

        // Fallback: scan shallow status-area elements for hospital time text.
        const candidates = document.querySelectorAll(
            '[class*="status"] li, [class*="icons"] li, ul.status-icons li, [class*="statusIcon"]'
        );
        for (const el of candidates) {
            if (el.children.length > 4) continue;
            const txt = el.textContent.trim();
            if (/hospital/i.test(txt)) {
                const m = parseMinutes(txt);
                if (m > 0) return m;
            }
        }

        return null; // not in hospital (or unable to detect)
    }

    // ─── Recommendation ───────────────────────────────────────────────────
    function recommend(hospMinutes) {
        // Items whose cooldown expires before hospital time does — stackable heals.
        const fitting = ITEMS.filter(item => item.cooldownMinutes <= hospMinutes);

        if (fitting.length > 0) {
            const best = fitting[fitting.length - 1]; // highest cooldown that fits
            return {
                item: best,
                note: `cooldown expires in hospital — stack another heal after`,
            };
        }

        // No item fits — hospital time is shorter than any item's cooldown.
        // Use smallest to minimise post-discharge cooldown waste.
        return {
            item: ITEMS[0],
            note: `short stay — use smallest to minimise post-discharge cooldown`,
        };
    }

    // ─── Banner ───────────────────────────────────────────────────────────
    function fmtMin(min) {
        const h = Math.floor(min / 60), m = Math.floor(min % 60);
        if (h > 0 && m > 0) return `${h}h ${m}m`;
        if (h > 0) return `${h}h`;
        return `${m}m`;
    }

    function showBanner(hospMin, rec) {
        if (document.querySelector('.heal-advisor-banner')) return;

        const itemLabel = rec.item.name +
            (rec.item.displayNote ? ` (${rec.item.displayNote})` : '');
        const cdText = `${rec.item.cooldownMinutes}min cd`;

        const b = document.createElement('div');
        b.className = 'heal-advisor-banner';
        b.style.cssText =
            'position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:99999;' +
            'background:#1c2833;color:#ecf0f1;padding:5px 18px;font-size:12px;' +
            'border-radius:0 0 8px 8px;box-shadow:0 2px 10px rgba(0,0,0,.6);' +
            'white-space:nowrap;font-family:sans-serif;user-select:none;pointer-events:none;';

        // Build with DOM methods (avoid innerHTML with dynamic content).
        const label = document.createElement('span');
        label.style.color = '#95a5a6';
        label.textContent = 'Heal Advisor';

        const timeStrong = document.createElement('strong');
        timeStrong.textContent = fmtMin(hospMin);

        const itemStrong = document.createElement('span');
        itemStrong.style.cssText = 'color:#2ecc71;font-weight:bold;';
        itemStrong.textContent = itemLabel;

        const note = document.createElement('span');
        note.style.color = '#7f8c8d';
        note.textContent = ` (${cdText} \u2014 ${rec.note})`;

        b.appendChild(label);
        b.appendChild(document.createTextNode(' \u2022 Hospital: '));
        b.appendChild(timeStrong);
        b.appendChild(document.createTextNode(' \u2014 Use: '));
        b.appendChild(itemStrong);
        b.appendChild(note);

        document.body.appendChild(b);
    }

    // ─── Inline highlight ─────────────────────────────────────────────────
    function highlightItems(rec) {
        const targets = new Set(rec.item.matchNames.map(n => n.toLowerCase()));

        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
        const seen = new Set();
        let node;

        while ((node = walker.nextNode())) {
            if (!targets.has(node.textContent.trim().toLowerCase())) continue;

            // Walk up to find a reasonable item container (LI, TR, or something with a button).
            let el = node.parentElement;
            for (let i = 0; i < 6; i++) {
                if (!el || el === document.body) break;
                const tag = el.tagName;
                if (tag === 'LI' || tag === 'TR') break;
                if ([...el.classList].some(c => /item/i.test(c))) break;
                if (el.querySelector('button, [class*="use"], [class*="btn"]')) break;
                el = el.parentElement;
            }

            if (!el || el === document.body || seen.has(el)) continue;
            seen.add(el);

            el.dataset.healAdvisor = '1';
            el.style.outline = '2px solid #2ecc71';
            el.style.outlineOffset = '2px';
            el.style.borderRadius = '4px';

            if (!node.parentElement.querySelector('.heal-advisor-badge')) {
                const badge = document.createElement('span');
                badge.className = 'heal-advisor-badge';
                badge.textContent = 'Use';
                badge.style.cssText =
                    'background:#2ecc71;color:#111;font-size:10px;font-weight:bold;' +
                    'padding:1px 5px;border-radius:3px;margin-left:5px;vertical-align:middle;';
                node.parentElement.appendChild(badge);
            }
        }
    }

    // ─── Cleanup ──────────────────────────────────────────────────────────
    function cleanup() {
        const b = document.querySelector('.heal-advisor-banner');
        if (b) b.remove();

        for (const el of document.querySelectorAll('[data-heal-advisor]')) {
            el.style.outline = '';
            el.style.outlineOffset = '';
            el.style.borderRadius = '';
            delete el.dataset.healAdvisor;
            const badge = el.querySelector('.heal-advisor-badge');
            if (badge) badge.remove();
        }
    }

    // ─── Run ──────────────────────────────────────────────────────────────
    function run() {
        cleanup();
        const hospMin = getHospitalMinutes();
        if (!hospMin || hospMin <= 0) return;

        const rec = recommend(hospMin);
        showBanner(hospMin, rec);
        // Delay highlight to allow item list to finish rendering.
        setTimeout(() => highlightItems(rec), 500);
    }

    // Wait for status bar to load, then run.
    setTimeout(run, 2500);

    // Re-run on SPA hash changes (e.g. navigating to faction armoury tab).
    window.addEventListener('hashchange', () => setTimeout(run, 1000));
})();
