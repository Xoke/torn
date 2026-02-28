// ==UserScript==
// @name         Torn Heal Advisor
// @namespace    https://xoke.org/
// @version      1.9
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

    // Calls callback(minutes) asynchronously. Tries sync approaches first,
    // then falls back to triggering a hover to render the tooltip.
    function detectHospitalMinutes(callback) {
        const hospLink = document.querySelector('[aria-label^="Hospital:"]');
        if (!hospLink) {
            console.log('[HealAdvisor] hospital link not found in DOM yet');
            callback(null);
            return;
        }

        // Try 1: container text (works on factions.php).
        const container = hospLink.closest('li') ||
                          hospLink.closest('[class*="status"]') ||
                          hospLink.parentElement;
        if (container) {
            const mins = parseMinutes(container.textContent);
            if (mins > 0) { callback(mins); return; }

            // Try countdown element inside the container (data-end / data-seconds).
            for (const cd of container.querySelectorAll('[data-end], [data-seconds]')) {
                const end = parseInt(cd.getAttribute('data-end') || '0', 10);
                if (end > 0) {
                    const ms = end - Date.now();
                    if (ms > 60000 && ms < 86400000) { callback(ms / 60000); return; }
                }
                const secs = parseInt(cd.getAttribute('data-seconds') || '0', 10);
                if (secs > 60 && secs < 86400) { callback(secs / 60); return; }
            }
        }

        // Try 2: i-data attribute (works on some pages).
        const iData = hospLink.getAttribute('i-data') || '';
        const iMatch = iData.match(/^i_\d+_(\d+)_/);
        if (iMatch) {
            const mins = parseInt(iMatch[1], 10);
            if (mins > 0) { console.log('[HealAdvisor] time from i-data:', mins); callback(mins); return; }
        }

        // Try 3: any already-visible tooltip mentioning hospital.
        for (const el of document.querySelectorAll('[class*="tooltip" i], [role="tooltip"]')) {
            if (!/hospital/i.test(el.textContent)) continue;
            const mins = parseMinutes(el.textContent);
            if (mins > 0) { callback(mins); return; }
        }

        // Try 4: trigger hover on the hospital icon to render its tooltip, then read it.
        console.log('[HealAdvisor] sync detection failed — trying hover tooltip. Container HTML:', container && container.outerHTML);
        hospLink.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        hospLink.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));

        setTimeout(() => {
            for (const el of document.querySelectorAll('[class*="tooltip" i], [role="tooltip"]')) {
                const text = el.textContent || '';
                if (!/hospital/i.test(text)) continue;
                const mins = parseMinutes(text);
                if (mins > 0) {
                    hospLink.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
                    console.log('[HealAdvisor] time from hover tooltip:', mins, 'min —', text.trim());
                    callback(mins);
                    return;
                }
            }
            hospLink.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
            console.log('[HealAdvisor] all detection methods failed');
            callback(null);
        }, 400);
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

        detectHospitalMinutes(function (hospMin) {
            if (!hospMin || hospMin <= 0) {
                if (!retryObserver) {
                    retryObserver = new MutationObserver(() => {
                        if (document.querySelector('[aria-label^="Hospital:"]')) {
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
            setTimeout(() => {
                highlightItems(rec);
                startHighlightObserver(rec);
            }, 500);
        });
    }

    setTimeout(run, 2000);
    window.addEventListener('hashchange', () => {
        if (retryObserver) { retryObserver.disconnect(); retryObserver = null; }
        if (highlightObserver) { highlightObserver.disconnect(); highlightObserver = null; }
        setTimeout(run, 1000);
    });
})();
