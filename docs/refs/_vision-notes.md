# Reference image vision notes — `refs/_candidates/`

**Target:** always-on-top desktop widget, 210–320px wide, ≤220px tall, semi-transparent over arbitrary wallpaper.
Shows: (a) one line current action, (b) short continuously-growing "thinking" text with pulsing feel, (c) currency amount (session spend), (d) short task list with done / in-progress states.

## Coverage disclosure (read this first)

- **Snapshot taken:** 2026-09-12 13:27:19 — **54 image files** present.
- **Vision-verified: 15 files.** **UNANALYZED: 39 files** (vision backend returned `VISION_RATE_LIMITED` / `VISION_BACKEND_UNAVAILABLE_THIS_TURN`; retried once per protocol, then stopped).
- **The directory is a moving target.** It grew 45 → 46 → 51 → 54 files *during* this analysis (`territory-*`, `aerospace-apollo-dsky`, `oculus-firstcontact-*`, `*-console.png` / `*-quest-tracker.png` / `*-macrodata-refinement.png` appeared mid-run). Filenames supplied in the task (e.g. `br2049-spinner-a`, `br2049-ksp-a/b`, `arrival-a/b/c`) **do not exist on disk**; the real set differs. Re-verify the list before trusting it.
- **3 files were analyzed but then disappeared** (renamed/removed mid-run): `br2049-spinner-a.jpg`, `br2049-spinner-b.jpg`, `br2049-ksp-a.jpg`. Their results are kept at the bottom.
- Rows marked **UNANALYZED** carry only *measured* facts (pixel size, KB, static vs animated) — **no visual claims are invented for them**.
- Not used: `vision_colors`. It returns *scene* colours, not UI colours (e.g. `destiny-missions.jpg` → beige/teal pastels from the film still), so it would mislead on palette decisions.

## Main table

| file | depicts | technique | legible at 280px |
|---|---|---|---|
| aerospace-apollo-dsky.jpg | UNANALYZED (vision rate-limited) | [measured] 1920x1765, 475KB, static | UNANALYZED |
| alienromulus-miner.gif | UNANALYZED (vision rate-limited) | [measured] 800x331, 8.4MB animated GIF (longest/heaviest loop) | UNANALYZED |
| alien-romulus-miner-console.png | UNANALYZED (vision rate-limited) | [measured] 800x331, 171KB, static — still of the same console | UNANALYZED |
| alienromulus-panel.gif | UNANALYZED (vision rate-limited) | [measured] 800x331, 5.3MB animated GIF | UNANALYZED |
| alienromulus-quota.gif | UNANALYZED (vision rate-limited) | [measured] 800x331, 5.0MB animated GIF — "quota" suggests a counter | UNANALYZED |
| br2049-b-a.jpg | Blade Runner 2049: top-down terrain surveillance / mapping screen | Sparse 1px white grid, ~10 columns, small 4x4px square markers; subtle teal film-grain overlay | No — leans on ambient texture, not readable data |
| br2049-d-a.jpg | BR2049: data-decryption / genetic-sequencing viewer | Tight monospace columns under ID+date headers; uniform character rhythm implies density without semantics | Yes — even monospace rhythm survives downscale |
| br2049-kspinner-a.jpg | BR2049: HUD over terrain scan, sensor + targeting readouts | Hairline 1px tick-mark ruler along left/right edges frames viewport, implies scale, leaves centre empty | No — central terrain noisy, data clusters resolve poorly |
| br2049-kspinner-b.jpg | BR2049: aerial surveillance, building footprints + coordinate grid | Thin bright white/orange wireframe strokes on desaturated dark ground: edges without solid fills | No — architectural detail and tiny coords blur together |
| br2049-luv-a.jpg | BR2049: thermal / X-ray surveillance monitor, figure inside cage structure | High-contrast blue gradients, bold outlines, simple geometry — contrast carries all meaning | Yes — strong contrast and large shapes hold |
| br2049-luv-b.jpg | BR2049: technical blueprint, vehicle specification + schematics | Light teal outlines on dark field over a consistent background grid; grid supplies structure cheaply | No — schematic detail and small text collapse |
| br2049-m-a.jpg | BR2049: scientific analysis console (biological / geological) | Monospace numeric block hard-anchored to far-left edge; heavy corner vignette frames the content | Yes — off-white mono on dark, high contrast |
| br2049-wallace-a.jpg | BR2049 (Wallace): cockpit dashboard + windshield, screen content | Bright cyan/white data on deep black screens so readouts beat warm ambient cabin light | No — screens physically small, glare and resolution |
| br2049-wallace-b.jpg | BR2049: technical schematic / system-status board, trajectory + errors | Monospaced data grid, strict orthogonal rows, thin separator lines for tabular alignment | No — dense small rows turn to static |
| cyberpunk2077-hud-quest-tracker.png | UNANALYZED (vision rate-limited) | [measured] 853x480, 162KB, static — but a *quest tracker* = task-list analogue | UNANALYZED |
| cyberpunk-hud.gif | UNANALYZED (vision rate-limited) | [measured] 853x480, 6.0MB animated GIF, in-game HUD | UNANALYZED |
| destiny-hud.jpg | UNANALYZED (vision rate-limited) | [measured] 1500x844, 280KB, static film/game still | UNANALYZED |
| destiny-missions.jpg | UNANALYZED (vision rate-limited) | [measured] 1500x844, 316KB, static mission UI | UNANALYZED |
| destiny-ui2.jpg | UNANALYZED (vision rate-limited) | [measured] 600x323, 100KB, static — already a small UI render | UNANALYZED |
| expanse-agathaking-a.jpg | The Expanse: spacecraft control panel, central radar + system statuses | Blue-on-black, thick ~2px borders, evenly spaced sections; large sans numerals for key metrics | Yes — high contrast plus bold typography |
| expanse-behemoth-a.jpg | The Expanse: command centre, multi-screen + central holographic ship | Dark ground, saturated accents, ample whitespace; critical data flagged by pulsing borders | Yes — contrast and clear type survive |
| expanse-razorback-a.jpg | The Expanse: HUD with planet, navigation data and system alerts | Semi-transparent overlay, thin white grid lines, bright blue text, centre-aligned focal point | No — overlapping detail loses clarity |
| expanse-rocinante-a.jpg | The Expanse: corridor wall panels, system statuses and controls | Monochrome plus one red highlight; bold sans numerals stacked vertically for compactness | Yes — simplification + large clear numbers |
| expanse-rocinante-b.jpg | UNANALYZED (vision rate-limited; call lost to a missing-file error, retry rate-limited) | [measured] 1500x888, 119KB, static | UNANALYZED |
| gits-a.jpg | UNANALYZED (vision rate-limited) | [measured] 1280x720, 888KB, static | UNANALYZED |
| gits-b.jpg | UNANALYZED (vision rate-limited) | [measured] 1280x720, 717KB, static | UNANALYZED |
| gits-c.jpg | UNANALYZED (vision rate-limited) | [measured] 1500x791, 161KB, static | UNANALYZED |
| gits-d.jpg | UNANALYZED (vision rate-limited) | [measured] 1500x791, 114KB, static | UNANALYZED |
| gits-e.jpg | UNANALYZED (vision rate-limited) | [measured] 1500x810, 217KB, static | UNANALYZED |
| ironman3-bootup.jpg | UNANALYZED (vision rate-limited) | [measured] 590x83, 22KB — *banner-strip* aspect, closest to target scale | UNANALYZED |
| ironman3-lab.jpg | UNANALYZED (vision rate-limited) | [measured] 590x83, 24KB, banner-strip aspect | UNANALYZED |
| ironman3-periodic.jpg | UNANALYZED (vision rate-limited) | [measured] 590x83, 32KB, banner-strip aspect | UNANALYZED |
| ironman3-rt.jpg | UNANALYZED (vision rate-limited) | [measured] 590x83, 30KB, banner-strip aspect | UNANALYZED |
| martian-a.png | UNANALYZED (vision rate-limited) | [measured] 1280x544, 470KB, static | UNANALYZED |
| martian-b.png | UNANALYZED (vision rate-limited) | [measured] 1280x544, 640KB, static | UNANALYZED |
| martian-c.png | UNANALYZED (vision rate-limited) | [measured] 1280x544, 715KB, static | UNANALYZED |
| martian-d.png | UNANALYZED (vision rate-limited) | [measured] 1280x720, 725KB, static | UNANALYZED |
| oculus-firstcontact-a.jpg | UNANALYZED (vision rate-limited) | [measured] 1440x810, 243KB, static | UNANALYZED |
| oculus-firstcontact-b.jpg | UNANALYZED (vision rate-limited) | [measured] 1440x810, 252KB, static | UNANALYZED |
| oculus-firstcontact-c.jpg | UNANALYZED (vision rate-limited) | [measured] 1440x810, 265KB, static | UNANALYZED |
| severance-100.gif | UNANALYZED (vision rate-limited) | [measured] 600x251, 5.2MB animated GIF — Lumon terminal, heavy loop | UNANALYZED |
| severance-folder.gif | UNANALYZED (vision rate-limited) | [measured] 600x251, 1.3MB animated GIF — small, list-like, light loop | UNANALYZED |
| severance-macrodata-refinement.png | UNANALYZED (vision rate-limited) | [measured] 600x251, 107KB, static; "Macrodata Refinement" = number-grid task screen | UNANALYZED |
| starcitizen-card-system.png | Star Citizen: holographic circular ship-model selector, "card system" | Circular layout with radial gradients pulling the eye to centre; large headings, small details | No — circular layout and detail get too compact |
| starcitizen-factory.jpg | UNANALYZED (vision rate-limited) | [measured] 1500x844, 227KB, static | UNANALYZED |
| starcitizen-kiosk-1.jpg | UNANALYZED (vision rate-limited) | [measured] 1500x692, 140KB, static | UNANALYZED |
| starcitizen-mobiglas.png | Star Citizen: mobiGlas HUD — finances, suit status, other vitals | Semi-transparent dark overlay over a clear grid of sections; bold sans headings, smaller detail rows | Yes — high contrast plus clear typography |
| starcitizen-starmap.png | UNANALYZED (vision rate-limited) | [measured] 708x398, 275KB, static — already small render | UNANALYZED |
| starcitizen-terminal.jpg | UNANALYZED (vision rate-limited) | [measured] 1500x844, 126KB, static | UNANALYZED |
| territory-atlas.jpg | UNANALYZED (vision rate-limited) | [measured] 2560x1073, 196KB, static, ultra-wide | UNANALYZED |
| territory-batman.jpg | UNANALYZED (vision rate-limited) | [measured] 1750x828, 1036KB, static | UNANALYZED |
| territory-mi-combat-mgmt.jpg | UNANALYZED (vision rate-limited) | [measured] 1920x800, 138KB, static; "combat mgmt" = list-heavy | UNANALYZED |
| territory-shelter-command.jpg | UNANALYZED (vision rate-limited) | [measured] 1920x800, 217KB, static; "command" = status-dense | UNANALYZED |
| territory-silo-cypher.jpg | UNANALYZED (vision rate-limited) | [measured] 1250x850, 234KB, static | UNANALYZED |

### Analyzed, then removed by the concurrent downloader (kept for reference)

| file | depicts | technique | legible at 280px |
|---|---|---|---|
| br2049-spinner-a.jpg *(gone)* | BR2049: cockpit interior, two figures in conversation | Thin white grid overlays plus minimal white text labels for a clean look | No — cockpit detail and figures too small |
| br2049-spinner-b.jpg *(gone)* | BR2049: futuristic tactical display, trajectory data + system statuses | Ultra-thin white grid lines; small monochromatic icons pack data compactly | No — dense text and fine detail lose clarity |
| br2049-ksp-a.jpg *(gone)* | BR2049: multi-channel audio / radar analyzer | Two-column widget layout with heavy 2px borders; large bold numerals along the bottom for primary stats | Yes — big numbers at bottom allow instant scanning |

## What the verified references actually teach the widget

- **Numbers:** put the spend figure last and biggest, in a monospace face, hard-anchored to an edge (`br2049-m-a`, `br2049-ksp-a`, `expanse-agathaking-a`). Numerals beat prose for instant scanning.
- **Task list:** a monospace grid with strict orthographic rows and hairline separators reads as a list even when the words are too small to parse (`br2049-wallace-b`, `br2049-d-a`). Done / in-progress can therefore be carried by **column position + row rhythm**, not by text.
- **Semi-transparency over arbitrary wallpaper:** the only reliable trick seen is bright data on a *deeply darkened* translucent plate (`starcitizen-mobiglas`, `br2049-wallace-a`) — dimming the backdrop matters more than the accent colour.
- **Structure for free:** a 1px grid or edge ruler costs almost no pixels and supplies the entire layout (`br2049-kspinner-a`, `br2049-b-a`).
- **Motion cue for "thinking":** pulsing borders marking live/critical fields (`expanse-behemoth-a`) and centre-aligned focal points (`expanse-razorback-a`) — subtle, low-cost, does not fight the wallpaper.
- **Accent discipline:** monochrome plus exactly one highlight colour (`expanse-rocinante-a`) survives extreme downscaling better than multi-hue palettes.
- **Anti-pattern:** radial / circular layouts (`starcitizen-card-system`) and dense schematics (`br2049-luv-b`, `br2049-kspinner-b`) are the two things that reliably die at 280px.

## Ranked recommendation

Ranking is weighted for our panel: numeric treatment, list readability, semi-transparency over unknown wallpaper, and low pixel cost.

### Tier A — vision-verified (1–15)

| # | file | why (5 words) |
|---|---|---|
| 1 | br2049-m-a.jpg | mono numerals anchored left edge |
| 2 | starcitizen-mobiglas.png | translucent overlay, spend plus vitals |
| 3 | br2049-d-a.jpg | monospace columns read as rows |
| 4 | br2049-wallace-b.jpg | tabular mono grid, thin rules |
| 5 | expanse-agathaking-a.jpg | big numerals, thick 2px frame |
| 6 | br2049-kspinner-a.jpg | hairline ruler ticks frame quietly |
| 7 | expanse-rocinante-a.jpg | monochrome plus one red accent |
| 8 | expanse-razorback-a.jpg | translucent grid, centre focal pulse |
| 9 | br2049-luv-a.jpg | bold outlines survive downscale |
| 10 | expanse-behemoth-a.jpg | pulsing border flags critical info |
| 11 | br2049-wallace-a.jpg | cyan on black beats wallpaper |
| 12 | br2049-kspinner-b.jpg | thin bright wireframe, no fills |
| 13 | br2049-b-a.jpg | sparse 1px grid, tiny markers |
| 14 | br2049-luv-b.jpg | teal outlines on dark grid |
| 15 | starcitizen-card-system.png | radial density: avoid at small |

### Tier B — provisional, **not vision-verified** (16–20)

Selected only on *measured* evidence (already near target scale, or animated), pending re-analysis.

| # | file | why (5 words) |
|---|---|---|
| 16 | cyberpunk2077-hud-quest-tracker.png | quest tracker mirrors task list |
| 17 | ironman3-rt.jpg | tiny 590x83 HUD strip |
| 18 | destiny-ui2.jpg | 600px UI, near target scale |
| 19 | severance-folder.gif | 600px folder-list motion reference |
| 20 | alienromulus-quota.gif | animated quota counter, CRT feel |

## To finish this properly

Re-run the remaining **39 images** (and any files added since the 13:27 snapshot) in a fresh session so the vision backend rate limit has reset. Give `br2049-kspinner-*` and `br2049-wallace-*` a re-read too: they surfaced as BR2049 in the filename but the model's scene descriptions were partly inconsistent, so treat those two pairs as medium-confidence.

---

## Mapping: this log's filenames → final shortlist filenames

This log was written against the working candidate set in `refs/_candidates/` (since removed). The 16 shortlisted references were copied to `refs/` under their final names:

| log filename | final filename in `refs/` |
|---|---|
| br2049-m-a.jpg | blade-runner-2049-analysis-console-01.jpg |
| starcitizen-mobiglas.png | star-citizen-mobiglas-overlay-02.png |
| br2049-d-a.jpg | blade-runner-2049-database-columns-03.jpg |
| expanse-agathaking-a.jpg | the-expanse-agatha-king-panel-04.jpg |
| expanse-rocinante-a.jpg | the-expanse-rocinante-panels-05.jpg |
| expanse-behemoth-a.jpg | the-expanse-behemoth-command-06.jpg |
| br2049-luv-a.jpg | blade-runner-2049-lapd-scan-07.jpg |
| br2049-wallace-b.jpg | blade-runner-2049-wallace-grid-08.jpg |
| br2049-kspinner-a.jpg | blade-runner-2049-ks-spinner-09.jpg |
| br2049-wallace-a.jpg | blade-runner-2049-wallace-cockpit-10.jpg |
| expanse-razorback-a.jpg | the-expanse-razorback-hud-11.jpg |
| cyberpunk2077-hud-quest-tracker.png | cyberpunk-2077-quest-tracker-12.png |
| destiny-missions.jpg | destiny-mission-list-13.jpg |
| martian-b.png | the-martian-console-14.png |
| severance-macrodata-refinement.png | severance-macrodata-terminal-15.png |
| territory-silo-cypher.jpg | silo-territory-cypher-ui-16.jpg |

Note: the five lower-confidence entries (#12–#16) appear in this log as `UNANALYZED`. That is the honest state — no visual claim was invented for them in `REFERENCES.md` either.
