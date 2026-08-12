# Torn Userscripts

A collection of Greasemonkey/Tampermonkey userscripts for [Torn](https://www.torn.com/).

## Scripts

### [Torn Faction CSV Exporter](https://raw.githubusercontent.com/Xoke/torn/main/TornFactionCSVExporter.user.js)
Exports faction member data to CSV format, including battle stats from FF Scouter. Useful for analyzing faction strength and planning wars.

### [Torn Heal Advisor](https://raw.githubusercontent.com/Xoke/torn/main/TornHealAdvisor.user.js)
Recommends the most efficient healing item to use based on your remaining hospital time. On your items page or faction armoury, shows a banner with the best item to use and highlights it in the list. The logic picks the highest-cooldown item whose cooldown still expires before you leave hospital (so you can stack another heal) — and falls back to the smallest item when the stay is too short to justify a long cooldown.

### [Torn OC Recommender](https://raw.githubusercontent.com/Xoke/torn/main/TornOCRecommender.user.js)
WIP - Recommends the best Organized Crime to join based on your success rates. Follows faction rules: Level 2-6 require 70%+, Level 7+ require 50%+. Highlights the recommended slot with a green glow.

### [Torn OC Success Highlighter](https://raw.githubusercontent.com/Xoke/torn/main/TornOCSuccessHighlighter.user.js)
WIP - Highlights OC participants who have under 70% success rate in Level 2-6 crimes. Makes it easy to spot members who might need to be reassigned.

### [Torn Ranked War Target Finder](https://raw.githubusercontent.com/Xoke/torn/main/TornRankedWarTargetFinder.user.js)
Helps find suitable targets during ranked wars. Scrapes faction member data, shows battle stats, and allows filtering by various criteria.

### [Torn Retal Monitor](https://raw.githubusercontent.com/Xoke/torn/main/TornRetalMonitor.user.js)
Monitors for retaliation opportunities and tracks players who have attacked faction members.

### [Torn Target Manager](https://raw.githubusercontent.com/Xoke/torn/main/TornTargetManager.user.js)
Comprehensive target management tool for tracking and organizing attack targets.

### [Torn List Exporter](https://raw.githubusercontent.com/Xoke/torn/main/TornListExporter.user.js)
Exports your target or enemy list to JSON for import into Target Manager. On the list page, injects a fixed button that scrapes all visible entries (Torn ID, name, note) and downloads them as a JSON file.

### [Torn Xanax Reminder](https://raw.githubusercontent.com/Xoke/torn/main/TornXanaxReminder.user.js)
Reminds you to take your Xanax when you have no drug cooldown. Shows a small clickable banner that takes you to your items page. Amended from [Don't forget your Xanax](https://greasyfork.org/en/scripts/490129-don-t-forget-your-xanax) by Shade — bar is now smaller and clickable, and removed embedded analytics script.

### [Torn Property Watcher](https://raw.githubusercontent.com/Xoke/torn/main/TornPropertyWatcher.user.js)
Watches the Torn property market for cheap Private Islands (under $1.7 billion). Plays an audio chime and shows a clickable banner when one appears. Polls every 10 seconds. Requires an API key on first run.

### [Torn Bank Rounder](https://raw.githubusercontent.com/Xoke/torn/main/TornBankRounder.user.js)
Adds a "5M" button to the bank deposit form. Clicking it auto-fills the deposit amount to reach the highest achievable multiple of $5M in your bank balance, keeping at least $1M cash on hand.

### [Torn Vault Catcher](https://raw.githubusercontent.com/Xoke/torn/main/TornVaultCatcher.user.js)
Warns faction bankers when giving a member more money than their vault balance, helping prevent accidental overpayments from faction funds.

### [Torn Shoplifting Store Alert](https://raw.githubusercontent.com/Xoke/torn/main/TornShopliftingAlert.user.js)
Alerts when any shoplifting store (jewelry store, gun shop, clothing store, etc.) has all of its security — cameras, guard, checkpoint — disabled at once. Plays an audio chime and shows a clickable banner listing the open stores. A gear button on the crimes page (`sid=crimes`) opens a settings panel to enable/disable alerts per store — handy if you already have a merit like the Cluster Ring and don't need that one. Polls every 30 seconds. Requires an API key on first run. Generalizes [Torn Jewelry Store Cluster Ring Alert](https://greasyfork.org/en/scripts/553079-torn-jewelry-store-cluster-ring-alert) by swervelord (which only covered the jewelry store) to every shoplifting location.

## Other Useful Scripts

Scripts by other authors that I've found useful.

### Racing
- [Auto Select Car](https://greasyfork.org/en/scripts/398078-auto-select-car) - Remembers your preferred car for each racetrack and hides other vehicles.
- [Torn Custom Race Presets](https://greasyfork.org/en/scripts/393632-torn-custom-race-presets) - Create and use preset templates for custom race configuration.
- [BrainRacing: Custom Race Presets](https://raw.githubusercontent.com/br41nslug/torn-brainscripts/main/scripts/custom-race-presets.user.js) - Quick preset links for dedicated racers.
- [Race Filter](https://greasyfork.org/en/scripts/389105-race-filter) - Filter out long, private, or paid races.

### War & Combat
- [Torn War Helper](https://greasyfork.org/en/scripts/30913-torn-war-helper) - Adds filters to the faction war page.
- [Torn Attack Stats](https://greasyfork.org/en/scripts/391922-torn-extensions-torn-attack-stats) - Shows supplementary information on the attack page.
- [FF Scouter V2](https://greasyfork.org/en/scripts/535292-ff-scouter-v2) - Shows expected Fair Fight score against targets and faction war status.
- [Chain Watch Alert](https://greasyfork.org/en/scripts/478422-torn-city-chain-watch-alert-enhanced) - Alerts when your chain timer drops below a threshold and fades the screen red.

### Crimes & OC
- [Crime Morale](https://greasyfork.org/en/scripts/515557-crime-morale) - Comprehensive tool for Crime 2.0 supporting scamming, pickpocketing, and burglary.
- [Lazy Crimes](https://greasyfork.org/en/scripts/540604-lazy-crimes/) - Quality of life improvements for Crime 2.0.
- [OC 2.0 Helper](https://greasyfork.org/en/scripts/522974-torn-oc-2-0-helper) - Overview of OC 2.0 showing members not in crimes, members in each crime, and issues.
- [OutcomeDB](https://greasyfork.org/en/scripts/489750-outcomedb) - Captures crime outcome, skill gain, and target data for analysis.
- [Crime Profitability](https://greasyfork.org/en/scripts/538188-crime-profitability) - Shows crime profitability.

### Trading & Economy
- [Torn Bazaar Filler](https://greasyfork.org/en/scripts/473470-torn-bazaar-filler) - Auto-fills bazaar prices with lowest market price minus a customizable amount.
- [Torn Auction Price Checker](https://greasyfork.org/en/scripts/564049-torn-auction-price-checker) - Shows historical pricing data for auction house items.
- [Torn Jewelry Store Cluster Ring Alert](https://greasyfork.org/en/scripts/553079-torn-jewelry-store-cluster-ring-alert) - Alerts when both cameras and guard are disabled at the jewelry store.

### Missions & Misc
- [Torn Mission Reward Information](https://greasyfork.org/en/scripts/395668-torn-mission-reward-information) - Displays mission reward value per credit and compares mod offers.
- [Auto Gym Switch](https://greasyfork.org/en/scripts/480060-auto-gym-switch) - Automatically switches your gym before training.
- [cryosis7's Torn Userscripts](https://github.com/cryosis7/torn_userscripts) - Collection of utility scripts for filtering, racing, and various game mechanics.
- [BUSTR: Busting Reminder + PDA](https://greasyfork.org/en/scripts/480750-bustr-busting-reminder-pda) - Predicts how many jail busts you can make before the penalty jails you, with notifications and a difficulty score for inmates.

### Extensions
- [Torn Tools](https://github.com/Mephiles/torntools_extension) - Comprehensive browser extension with a wide range of quality-of-life features across the game.

### Mobile Apps
- [Torn PDA](https://www.torn.com/forums.php#/p=threads&t=16163503) - Feature-rich mobile app for Torn with notifications, target lists, travel assistance, and more.

## Installation

1. Install a userscript manager like [Tampermonkey](https://www.tampermonkey.net/) or [Greasemonkey](https://www.greasespot.net/)
2. Click on any script link above
3. Click "Install" when prompted

## API keys

Several scripts (Target Manager, Retal Monitor, Ranked War Target Finder, Property Watcher, Shoplifting Store Alert) need a Torn API key. Keys are stored locally in your userscript manager's storage (`GM_setValue`) in **plain text** — they are never sent anywhere except `api.torn.com` over HTTPS. Because the storage is unencrypted, generate a **Limited Access** (minimal) key rather than a Full Access one; these scripts only read basic user/faction, profile, and attack data.

## Dependencies

Some scripts require [FF Scouter](https://www.torn.com/forums.php#/p=threads&t=16290158) to be installed for battle stat estimates.

## License

See [LICENSE](LICENSE) for details.

