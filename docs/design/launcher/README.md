# Launcher design (approved 15 Nov 2026, D-064)

Design references for Phase U, exported from the Claude Project canvas. Not shipped code:
they need the canvas runtime (`support.js`) to render, so open them on the canvas, not in a browser.

| Frame | Crumb |
|---|---|
| Main (Connect), Check, Pick, Pick-Empty, Pick-Error + Mobile-Connect, Mobile-Check, Mobile-Pick | U.4 |
| Extract, Extract-Failed, Done, Recent, Recent-Delete, Recent-Rerun, Quit + Mobile-Extract, Mobile-Done, Mobile-Recent | U.5 |

Mockup-only, do not copy into the product:
- "Trust server certificate" is ticked in the mockup to show the warning; the product starts unticked.
- "Prototype: skip to Done" link on Extract.
- Placeholder logo; use the real mark from `site/`.
- Inter from Google Fonts; the product uses the self-hosted Inter.
- Hard-coded Entra methods and the `os` tweak; the product gets both from the server.
- Sample data (database names, timings, sizes, counts) except AdventureWorks2022 = 71 tables.
