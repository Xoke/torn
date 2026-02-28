// ==UserScript==
// @name         Torn Heal Advisor
// @namespace    https://xoke.org/
// @version      1.8
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

    console.log('[HealAdvisor] script running on', window.location.pathname);

    // ─── Item config ──────────────────────────────────────────────────────
    // hospReduction: minutes removed from hospital timer on use
    // life:          % of max life restored
    // cooldown:      medical cooldown imposed (minutes)
    //
    // An item is worth using only when hospRemaining > cooldown
    // (otherwise the cooldown costs more time than the item saves).
    // Among usable items, highest hospReduction wins.
    const ITEMS = [
        {
            name: 'Small First Aid Kit',
            hospReduction: 20,
            life: 5,
            cooldown: 10,
            matchNames: ['Small First Aid Kit'],
        },
        {
            name: 'First Aid Kit',
            hospReduction: 40,
            life: 10,
            cooldown: 15,
            matchNames: ['First Aid Kit'],
        },
        {
            name: 'Morphine',
            hospReduction: 70,
            life: 15,
            cooldown: 20,
            matchNames: ['Morphine'],
        },
        {
            name: 'Blood Bag',
            hospReduction: 120,
            life: 30,
            cooldown: 30,
            displayNote: 'check blood type',
            matchNames: ['Blood Bag'],
            excludePattern: /irradiated/i,  // never recommend Irradiated Blood Bags
        },
    ];
    // Sorted descending by reduction so recommend() can just grab the first usable item.
    ITEMS.sort((a, b) => b.hospReduction - a.hospReduction);

    // ─── Hospital time parsing ────────────────────────────────────────────
    function parseMinutes(str) {
        if (!str) return 0;
        let m = 0;
        const h   = str.match(/(\d+)\s*h/i);
        const min = str.match(/(\d+)\s*m(?!o)/i);
        const sec = str.match(/(\d+)\s*s/i);
        if (h)   m += parseInt(h[1]) * 60;
        if (min) m += parseInt(min[1]);
        if (sec) m += parseInt(sec[1]) / 60;
        return m;
    }

    function getHospitalMinutes() {
        // Confirmed format: aria-label="Hospital: Hospitalized by PlayerName"
        const hospLink = document.querySelector('[aria-label^="Hospital:"]');
        if (!hospLink) {
            console.log('[HealAdvisor] hospital link not found in DOM yet');
            return null;
        }

        // Try 1: surrounding container text.
        const container = hospLink.closest('li') ||
                          hospLink.closest('[class*="status"]') ||
                          hospLink.parentElement;
        if (container) {
            const mins = parseMinutes(container.textContent);
            if (mins > 0) return mins;
        }

        // Try 2: i-data attribute — observed format "i_X_MINUTES_W_H" e.g. "i_10_175_17_17".
        const iData = hospLink.getAttribute('i-data') || '';
        console.log('[HealAdvisor] i-data value:', iData);
        const iMatch = iData.match(/^i_\d+_(\d+)_/);
        if (iMatch) {
            const mins = parseInt(iMatch[1], 10);
            if (mins > 0) {
                console.log('[HealAdvisor] time from i-data:', mins, 'min');
                return mins;
            }
        }

        // Try 3: any tooltip element.
        for (const el of document.querySelectorAll('[class*="tooltip" i]')) {
            if (!/hospital/i.test(el.textContent)) continue;
            const mins = parseMinutes(el.textContent);
            if (mins > 0) return mins;
        }

        // Try 4: scan for STANDALONE time strings only (e.g. "2h 15m", "45m").
        // Reject anything embedded in a sentence to avoid false matches.
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
        let node;
        while ((node = walker.nextNode())) {
            const text = node.textContent.trim();
            if (!text) continue;
            // Must be a pure time string — digits, h, m, s and spaces only.
            if (!/^[\dhmsd\s]+$/.test(text)) continue;
            if (!/\d+\s*h|\d+\s*m/i.test(text)) continue;
            const mins = parseMinutes(text);
            if (mins >= 1 && mins < 1440) {
                console.log('[HealAdvisor] time from page scan:', text, '->', mins, 'min', node.parentElement);
                return mins;
            }
        }

        console.log('[HealAdvisor] in hospital but cannot find time. Link:', hospLink.outerHTML, '/ Container:', container && container.outerHTML);
        return null;
    }

    // ─── Recommendation ───────────────────────────────────────────────────
    // Returns the best item to use now, and (if applicable) what to use next
    // after the cooldown expires.
    function recommend(hospMinutes) {
        // An item is worth using if hospMinutes > item.cooldown (net positive).
        const best = ITEMS.find(item => hospMinutes > item.cooldown) || null;
        if (!best) return { item: null, next: null };

        // After using best: hospital time reduced, then cooldown ticks down.
        const hospAfterReduction = Math.max(0, hospMinutes - best.hospReduction);
        const hospAfterCooldown  = Math.max(0, hospAfterReduction - best.cooldown);

        const next = hospAfterCooldown > 0
            ? (ITEMS.find(item => hospAfterCooldown > item.cooldown) || null)
            : null;

        return { item: best, hospAfterCooldown, next };
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

        const b = document.createElement('div');
        b.className = 'heal-advisor-banner';
        b.style.cssText =
            'position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:99999;' +
            'background:#1c2833;color:#ecf0f1;padding:5px 18px;font-size:12px;' +
            'border-radius:0 0 8px 8px;box-shadow:0 2px 10px rgba(0,0,0,.6);' +
            'white-space:nowrap;font-family:sans-serif;user-select:none;pointer-events:none;';

        const grey  = s => Object.assign(document.createElement('span'), { textContent: s, style: 'color:#7f8c8d' });
        const green = s => Object.assign(document.createElement('span'), { textContent: s, style: 'color:#2ecc71;font-weight:bold' });
        const dim   = s => Object.assign(document.createElement('span'), { textContent: s, style: 'color:#95a5a6' });

        b.appendChild(grey('Heal Advisor'));
        b.appendChild(document.createTextNode(` \u2022 Hospital: `));
        b.appendChild(Object.assign(document.createElement('strong'), { textContent: fmtMin(hospMin) }));
        b.appendChild(document.createTextNode(' \u2014 '));

        if (!rec.item) {
            b.appendChild(dim('Wait it out (too short for any item to help)'));
        } else {
            const label = rec.item.name + (rec.item.displayNote ? ` (${rec.item.displayNote})` : '');
            b.appendChild(document.createTextNode('Use: '));
            b.appendChild(green(label));
            b.appendChild(dim(` (\u2212${rec.item.hospReduction}min hosp, +${rec.item.cooldown}min cd)`));

            if (rec.next) {
                const nextLabel = rec.next.name + (rec.next.displayNote ? ` (${rec.next.displayNote})` : '');
                b.appendChild(document.createTextNode(' \u2192 '));
                b.appendChild(dim(`${fmtMin(rec.hospAfterCooldown)} left \u2192 `));
                b.appendChild(green(nextLabel));
                b.appendChild(dim(` again`));
            } else if (rec.hospAfterCooldown === 0) {
                b.appendChild(dim(' \u2192 out of hospital'));
            }
        }

        document.body.appendChild(b);
    }

    // ─── Inline highlight ─────────────────────────────────────────────────
    function textMatchesItem(text, item) {
        const t = text.trim().toLowerCase();
        if (item.excludePattern && item.excludePattern.test(t)) return false;
        return item.matchNames.some(name => t === name.toLowerCase() || t.includes(name.toLowerCase()));
    }

    function highlightItems(rec) {
        if (!rec.item) return;

        const root = document.querySelector('#mainContainer [class*="items-cont-wrap"]') ||
                     document.querySelector('#mainContainer') ||
                     document.body;

        // Search leaf-ish elements whose text content matches the item name.
        const seen = new Set();
        for (const el of root.querySelectorAll('*')) {
            // Skip elements that contain many children — they're containers, not name labels.
            if (el.children.length > 3) continue;
            if (!textMatchesItem(el.textContent, rec.item)) continue;

            // Walk up to find a sensible item card container.
            let card = el;
            for (let i = 0; i < 6; i++) {
                if (!card.parentElement || card.parentElement === document.body) break;
                const p = card.parentElement;
                if (p.tagName === 'LI' || p.tagName === 'TR') { card = p; break; }
                if ([...p.classList].some(c => /\bitem\b/i.test(c))) { card = p; break; }
                if (p.querySelector('button, [class*="use"], [class*="btn"]')) { card = p; break; }
                card = p;
            }

            if (seen.has(card)) continue;
            seen.add(card);

            card.dataset.healAdvisor = '1';
            card.style.outline = '2px solid #2ecc71';
            card.style.outlineOffset = '2px';
            card.style.borderRadius = '4px';

            if (!el.querySelector('.heal-advisor-badge')) {
                const badge = document.createElement('span');
                badge.className = 'heal-advisor-badge';
                badge.textContent = 'Use';
                badge.style.cssText =
                    'background:#2ecc71;color:#111;font-size:10px;font-weight:bold;' +
                    'padding:1px 5px;border-radius:3px;margin-left:5px;vertical-align:middle;';
                el.appendChild(badge);
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
    let retryObserver = null;
    let highlightObserver = null;

    function startHighlightObserver(rec) {
        if (highlightObserver) { highlightObserver.disconnect(); highlightObserver = null; }

        // Watch the items container for DOM changes (lazy-loaded items on item.php).
        const root = document.querySelector('#mainContainer [class*="items-cont-wrap"]') ||
                     document.querySelector('#mainContainer') ||
                     document.body;

        highlightObserver = new MutationObserver(() => highlightItems(rec));
        highlightObserver.observe(root, { childList: true, subtree: true });

        // Stop watching after 30s — items should all be loaded by then.
        setTimeout(() => {
            if (highlightObserver) { highlightObserver.disconnect(); highlightObserver = null; }
        }, 30000);
    }

    function run() {
        cleanup();
        if (highlightObserver) { highlightObserver.disconnect(); highlightObserver = null; }

        const hospMin = getHospitalMinutes();

        if (!hospMin || hospMin <= 0) {
            if (!retryObserver) {
                retryObserver = new MutationObserver(() => {
                    const mins = getHospitalMinutes();
                    if (mins > 0) {
                        retryObserver.disconnect();
                        retryObserver = null;
                        run();
                    }
                });
                retryObserver.observe(document.body, { childList: true, subtree: true });
                setTimeout(() => {
                    if (retryObserver) { retryObserver.disconnect(); retryObserver = null; }
                }, 20000);
            }
            return;
        }

        if (retryObserver) { retryObserver.disconnect(); retryObserver = null; }

        const rec = recommend(hospMin);
        showBanner(hospMin, rec);
        // Initial highlight pass + keep watching for lazily rendered items.
        setTimeout(() => {
            highlightItems(rec);
            startHighlightObserver(rec);
        }, 500);
    }

    setTimeout(run, 2000);
    window.addEventListener('hashchange', () => {
        if (retryObserver) { retryObserver.disconnect(); retryObserver = null; }
        if (highlightObserver) { highlightObserver.disconnect(); highlightObserver = null; }
        setTimeout(run, 1000);
    });
})();
