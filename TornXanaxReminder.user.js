// ==UserScript==
// @name         Torn Xanax Reminder
// @namespace    https://xoke.org/
// @version      1.4
// @description  Reminds you to take your Xanax when you have no drug cooldown
// @author       Xoke (based on "Don't forget your Xanax" by Shade)
// @match        https://www.torn.com/*
// @exclude      https://www.torn.com/loader.php?sid=attack*
// @exclude      https://www.torn.com/pc.php*
// @exclude      https://www.torn.com/level2.php*
// @homepageURL  https://github.com/Xoke/torn
// @updateURL    https://raw.githubusercontent.com/Xoke/torn/main/TornXanaxReminder.meta.js
// @downloadURL  https://raw.githubusercontent.com/Xoke/torn/main/TornXanaxReminder.user.js
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    function check() {
        const hasCooldown = !!document.querySelector("[aria-label^='Drug Cooldown:']");
        const hasBar = !!document.querySelector('.torn-xanax-reminder-bar');

        if (hasCooldown) {
            if (hasBar) document.querySelector('.torn-xanax-reminder-bar').remove();
            return;
        }

        if (!hasBar) {
            const bar = document.createElement('a');
            bar.className = 'torn-xanax-reminder-bar';
            bar.href = 'https://www.torn.com/item.php';
            bar.textContent = 'Take your Xanax!';
            bar.style.cssText =
                'position: fixed; top: 0; left: 0; z-index: 99999; ' +
                'background: #c0392b; color: white; padding: 8px 20px; font-size: 12px; font-weight: bold; ' +
                'text-decoration: none; border-radius: 0 0 6px 0; cursor: pointer; ' +
                'box-shadow: 0 2px 6px rgba(0,0,0,0.3);';
            bar.addEventListener('mouseenter', function () { bar.style.background = '#e74c3c'; });
            bar.addEventListener('mouseleave', function () { bar.style.background = '#c0392b'; });
            document.body.appendChild(bar);
        }
    }

    let debounceTimer = null;
    const observer = new MutationObserver(function () {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(check, 300);
    });

    function start() {
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(check, 500);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
