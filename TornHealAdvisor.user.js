// ==UserScript==
// @name         Torn Heal Advisor
// @namespace    https://xoke.org/
// @version      2.2
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
            matchPrefix: 'small first aid kit',
        },
        {
            name: 'First Aid Kit',
            hospReduction: 40,
            life: 10,
            cooldown: 15,
            matchPrefix: 'first aid kit',
            excludePattern: /small/i,
        },
        {
            name: 'Morphine',
            hospReduction: 70,
            life: 15,
            cooldown: 20,
            matchPrefix: 'morphine',
        },
        {
            name: 'Blood Bag',
            hospReduction: 120,
            life: 30,
            cooldown: 30,
            displayNote: 'check blood type',
            matchPrefix: 'blood bag',
            excludePattern: /irradiated/i,
        },
    ];
    ITEMS.sort((a, b) => b.hospReduction - a.hospReduction);

    // ─── Hospital time detection ──────────────────────────────────────────
    function detectHospitalMinutes(callback) {
        // Primary: window.topBannerInitData contains hospitalStamp (Unix seconds).
        const stamp = window.topBannerInitData &&
                      window.topBannerInitData.user &&
                      window.topBannerInitData.user.data &&
                      window.topBannerInitData.user.data.hospitalStamp;
        if (stamp) {
            const mins = (stamp * 1000 - Date.now()) / 60000;
            if (mins > 0) { callback(mins); return; }
        }

        // Fallback: hospital link in status bar + container text (works on factions.php).
        const hospLink = document.querySelector('[aria-label^="Hospital:"]');
        if (!hospLink) { callback(null); return; }

        const container = hospLink.closest('li') ||
                          hospLink.closest('[class*="status"]') ||
                          hospLink.parentElement;
        if (container) {
            const mins = parseMinutes(container.textContent);
            if (mins > 0) { callback(mins); return; }
        }

        // Last resort: trigger hover to render tooltip.
        hospLink.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        hospLink.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        setTimeout(() => {
            for (const el of document.querySelectorAll('[class*="tooltip" i], [role="tooltip"]')) {
                if (!/hospital/i.test(el.textContent)) continue;
                const mins = parseMinutes(el.textContent);
                if (mins > 0) {
                    hospLink.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
                    callback(mins);
                    return;
                }
            }
            hospLink.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
            callback(null);
        }, 400);
    }

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

    // ─── Recommendation ───────────────────────────────────────────────────
    function recommend(hospMinutes) {
        const best = ITEMS.find(item => hospMinutes > item.cooldown) || null;
        if (!best) return { item: null, hospAfterCooldown: 0, next: null };

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
        b.appendChild(document.createTextNode(' \u2022 Hospital: '));
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
                b.appendChild(dim(' again'));
            } else if (rec.hospAfterCooldown === 0) {
                b.appendChild(dim(' \u2192 out of hospital'));
            }
        }

        document.body.appendChild(b);
    }

    // ─── Inline highlight ─────────────────────────────────────────────────
    function itemNameMatches(name, item) {
        const t = name.trim().toLowerCase();
        if (item.excludePattern && item.excludePattern.test(t)) return false;
        return t === item.matchPrefix || t.startsWith(item.matchPrefix + ' ') ||
               t.startsWith(item.matchPrefix + ':');
    }

    function highlightItems(rec) {
        if (!rec.item) return;

        // On item.php: items are li[data-category="Medical"] with data-sort for name and data-qty for quantity.
        const medicalLis = document.querySelectorAll('li[data-category="Medical"]');
        if (medicalLis.length > 0) {
            for (const li of medicalLis) {
                const qty = parseInt(li.getAttribute('data-qty') || '0', 10);
                if (qty === 0) continue; // skip empty items

                // data-sort = "1 Blood Bag : A+" — strip leading sort key
                const sort = (li.getAttribute('data-sort') || '').replace(/^\S+\s+/, '');
                if (!itemNameMatches(sort, rec.item)) continue;
                if (li.dataset.healAdvisor) continue;

                li.dataset.healAdvisor = '1';
                li.style.outline = '2px solid #2ecc71';
                li.style.outlineOffset = '2px';
                li.style.borderRadius = '4px';

                const nameEl = li.querySelector('.name');
                if (nameEl && !nameEl.querySelector('.heal-advisor-badge')) {
                    const badge = document.createElement('span');
                    badge.className = 'heal-advisor-badge';
                    badge.textContent = 'Use';
                    badge.style.cssText =
                        'background:#2ecc71;color:#111;font-size:10px;font-weight:bold;' +
                        'padding:1px 5px;border-radius:3px;margin-left:5px;vertical-align:middle;';
                    nameEl.appendChild(badge);
                }
            }
            return;
        }

        // On item.php the Medical items simply haven't rendered yet — bail out and
        // let the MutationObserver retry once they appear.
        if (location.pathname === '/item.php') return;

        // On factions.php armoury: items are li.clearfix inside .medical-items.
        // Item name is on the img[alt] attribute; quantity in .item-amount.
        const armouryLis = document.querySelectorAll('.medical-items li');
        if (armouryLis.length > 0) {
            for (const li of armouryLis) {
                const img = li.querySelector('img[alt]');
                if (!img) continue;
                if (!itemNameMatches(img.getAttribute('alt'), rec.item)) continue;

                const qtyEl = li.querySelector('.item-amount');
                const qty = qtyEl ? parseInt(qtyEl.textContent.trim(), 10) : 0;
                if (qty === 0) continue;

                if (li.dataset.healAdvisor) continue;
                li.dataset.healAdvisor = '1';
                li.style.outline = '2px solid #2ecc71';
                li.style.outlineOffset = '2px';
                li.style.borderRadius = '4px';

                const nameEl = li.querySelector('.name-wrap');
                if (nameEl && !nameEl.querySelector('.heal-advisor-badge')) {
                    const badge = document.createElement('span');
                    badge.className = 'heal-advisor-badge';
                    badge.textContent = 'Use';
                    badge.style.cssText =
                        'background:#2ecc71;color:#111;font-size:10px;font-weight:bold;' +
                        'padding:1px 5px;border-radius:3px;margin-left:5px;vertical-align:middle;';
                    nameEl.appendChild(badge);
                }
            }
            return;
        }

        // Armoury not yet rendered — MutationObserver will retry.
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
        const root = document.querySelector('#mainContainer') || document.body;
        highlightObserver = new MutationObserver(() => highlightItems(rec));
        highlightObserver.observe(root, { childList: true, subtree: true });
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
                        const stamp = window.topBannerInitData &&
                                      window.topBannerInitData.user &&
                                      window.topBannerInitData.user.data &&
                                      window.topBannerInitData.user.data.hospitalStamp;
                        if (stamp || document.querySelector('[aria-label^="Hospital:"]')) {
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
