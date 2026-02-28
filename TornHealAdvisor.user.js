// ==UserScript==
// @name         Torn Heal Advisor
// @namespace    https://xoke.org/
// @version      1.2
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
    ITEMS.sort((a, b) => a.cooldownMinutes - b.cooldownMinutes);

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
        // The time is NOT in the aria-label — find it in the surrounding DOM.
        const hospLink = document.querySelector('[aria-label^="Hospital:"]');
        if (!hospLink) {
            return null; // not in hospital
        }

        // Search the closest list item / status container for a time text node.
        const container = hospLink.closest('li') ||
                          hospLink.closest('[class*="status"]') ||
                          hospLink.parentElement;

        if (container) {
            const mins = parseMinutes(container.textContent);
            if (mins > 0) {
                console.log('[HealAdvisor] time found in container:', container.textContent.trim(), '->', mins, 'min');
                return mins;
            }
            // Log the container HTML so we can find where the time is rendered.
            console.log('[HealAdvisor] in hospital but no time in container. Container HTML:', container.outerHTML);
        }

        // Check for any visible tooltip element that mentions hospital time.
        for (const el of document.querySelectorAll('[class*="tooltip" i], [class*="Tooltip"]')) {
            if (!/hospital/i.test(el.textContent)) continue;
            const mins = parseMinutes(el.textContent);
            if (mins > 0) {
                console.log('[HealAdvisor] time found in tooltip:', el.textContent.trim());
                return mins;
            }
        }

        // Broad fallback: scan all small text nodes for a time pattern near the icon.
        // The time might be a sibling element rendered separately from the icon.
        const statusArea = hospLink.closest('[class*="icons" i], [class*="status" i], nav, header') ||
                           document.body;
        const walker = document.createTreeWalker(statusArea, NodeFilter.SHOW_TEXT, null);
        let node;
        while ((node = walker.nextNode())) {
            const text = node.textContent.trim();
            if (!text || text.length > 40) continue;
            if (/^\d+\s*[hms]/.test(text) || /\d+\s*h\s*\d+\s*m/.test(text)) {
                const mins = parseMinutes(text);
                if (mins > 0) {
                    console.log('[HealAdvisor] time found via broad scan:', text, node.parentElement);
                    return mins;
                }
            }
        }

        console.log('[HealAdvisor] in hospital but cannot find time. Paste the hospital icon HTML from DevTools.');
        return null;
    }

    // ─── Recommendation ───────────────────────────────────────────────────
    function recommend(hospMinutes) {
        const fitting = ITEMS.filter(item => item.cooldownMinutes <= hospMinutes);
        if (fitting.length > 0) {
            return {
                item: fitting[fitting.length - 1],
                note: 'cooldown expires in hospital \u2014 stack another heal after',
            };
        }
        return {
            item: ITEMS[0],
            note: 'short stay \u2014 use smallest to minimise post-discharge cooldown',
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

        const b = document.createElement('div');
        b.className = 'heal-advisor-banner';
        b.style.cssText =
            'position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:99999;' +
            'background:#1c2833;color:#ecf0f1;padding:5px 18px;font-size:12px;' +
            'border-radius:0 0 8px 8px;box-shadow:0 2px 10px rgba(0,0,0,.6);' +
            'white-space:nowrap;font-family:sans-serif;user-select:none;pointer-events:none;';

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
        note.textContent = ` (${rec.item.cooldownMinutes}min cd \u2014 ${rec.note})`;

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

        // Search within the items container; fall back to full body.
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
            // Retry via MutationObserver in case the status bar hasn't rendered yet.
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
                    if (retryObserver) {
                        retryObserver.disconnect();
                        retryObserver = null;
                    }
                }, 20000);
            }
            return;
        }

        if (retryObserver) {
            retryObserver.disconnect();
            retryObserver = null;
        }

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
