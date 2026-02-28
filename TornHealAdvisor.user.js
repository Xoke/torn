// ==UserScript==
// @name         Torn Heal Advisor
// @namespace    https://xoke.org/
// @version      1.3
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
            matchNames: ['Blood Bag O', 'Blood Bag A', 'Blood Bag B', 'Blood Bag AB'],
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
        if (!hospLink) return null;

        // Time is not in the aria-label — search the surrounding container.
        const container = hospLink.closest('li') ||
                          hospLink.closest('[class*="status"]') ||
                          hospLink.parentElement;

        if (container) {
            const mins = parseMinutes(container.textContent);
            if (mins > 0) return mins;
        }

        // Fallback: any visible tooltip mentioning hospital.
        for (const el of document.querySelectorAll('[class*="tooltip" i]')) {
            if (!/hospital/i.test(el.textContent)) continue;
            const mins = parseMinutes(el.textContent);
            if (mins > 0) return mins;
        }

        // Broad fallback: scan status area for standalone time strings.
        const statusArea = hospLink.closest('[class*="icons" i], [class*="status" i], nav, header') ||
                           document.body;
        const walker = document.createTreeWalker(statusArea, NodeFilter.SHOW_TEXT, null);
        let node;
        while ((node = walker.nextNode())) {
            const text = node.textContent.trim();
            if (!text || text.length > 40) continue;
            if (/^\d+\s*[hms]/.test(text) || /\d+\s*h\s*\d+\s*m/.test(text)) {
                const mins = parseMinutes(text);
                if (mins > 0) return mins;
            }
        }

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
    function highlightItems(rec) {
        if (!rec.item) return;
        const targets = new Set(rec.item.matchNames.map(n => n.toLowerCase()));

        const root = document.querySelector('#mainContainer [class*="items-cont-wrap"]') ||
                     document.querySelector('#mainContainer') ||
                     document.body;

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
        const seen = new Set();
        let node;

        while ((node = walker.nextNode())) {
            if (!targets.has(node.textContent.trim().toLowerCase())) continue;

            let el = node.parentElement;
            for (let i = 0; i < 6; i++) {
                if (!el || el === document.body) break;
                if (el.tagName === 'LI' || el.tagName === 'TR') break;
                if ([...el.classList].some(c => /\bitem\b/i.test(c))) break;
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
    let retryObserver = null;

    function run() {
        cleanup();
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
        setTimeout(() => highlightItems(rec), 500);
    }

    setTimeout(run, 2000);
    window.addEventListener('hashchange', () => {
        if (retryObserver) { retryObserver.disconnect(); retryObserver = null; }
        setTimeout(run, 1000);
    });
})();
