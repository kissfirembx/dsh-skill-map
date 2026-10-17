# dsh-skill-map

English | [中文](README.zh.md)

DSH skill map: browse every loaded skill through your own categories in a right-sidebar tab, and rename, add, delete, reorder or re-file them in place.

## What it does

- Contributes one tab to the right sidebar, through the public service the right sidebar exposes to other plugins.
- Shows the loaded skills as categories: a caret, a category name and a count, collapsed by default. A skill row is one line — the name, then a one-sentence summary of what the skill does. Hovering the row (or filtering a search) swaps that summary for the GitHub project the skill was downloaded from — read from the skills installer's ledger — and the fuller description.
- Keeps written copy and the inventory in step: when a skill is installed, removed or updated, the footer says how many rows need attention — unwritten ones, rows whose skill changed underneath them, and rows left behind by a deletion — and one click copies that list out of the panel.
- Can write the copy for you: the sync action in the header asks the profile's own model to fill every missing line and refresh the ones whose skill changed, then reloads the list and reports what it wrote. A machine-written line never overrides one you wrote by hand.
- Searches skill names and descriptions, and expands or collapses every category at once.
- Switches the description language from the panel's own settings view (the gear in the header): the skill's own text, or any translation cache kept at `$DSH_HOME/skill-map/descriptions.<lang>.json`. A skill with no row in that cache keeps its own text.
- Creates, renames and deletes categories from the panel, and reorders them by dragging.
- Moves a skill between categories, or back to Unassigned, by dragging it onto the target category.
- Copies `/skill-name` when a skill row is clicked, ready for the composer.
- Keeps the map in a user-owned file, so the categories outlive the plugin version.

## Install

```sh
dsh plugin --profile web add @kissfire/dsh-skill-map
```

Every release also ships the built package as a tarball on [Releases](https://github.com/kissfirembx/dsh-skill-map/releases) — same content, no build step. The URL is stable: `latest` always resolves to the newest release, so it never needs an edit when a version ships.

```sh
dsh plugin --profile web add https://github.com/kissfirembx/dsh-skill-map/releases/latest/download/kissfire-dsh-skill-map.tgz
```

Restart `dsh web`, or toggle the plugin's row in the plugin manager, then open the map. It lands in a right sidebar either way: with `dsh-better-sidebar` installed it is a tab in that sidebar; without it the plugin registers a tab of its own in the official right Sidebar (`@deepseek-ai/dsh-client-ui-sidebar-right`), which is opened once on first load. Only when neither right sidebar is running does it fall back to a central panel with an icon in the sidebar's panel list — so there is always a way in.

## Config

| Key | Type | Meaning |
| --- | --- | --- |
| `enabled` | boolean | Master switch for the host routes. |
| `customSkillDirs` | string[] | Extra skill roots to scan besides the official ones. |
| `dshHome` | string | DSH home override; the map file lives under it. |
| `agentsHome` | string | Agents home override (`~/.agents`). |

## Routes

| Route | Method | Meaning |
| --- | --- | --- |
| `/api/dsh-skill-map/list` | GET | Inventory grouped by the user map; accepts an optional `?cwd=`. |
| `/api/dsh-skill-map/save` | POST | Writes the whole user map (categories plus placements). |
| `/api/dsh-skill-map/health` | GET | Health check carrying the skill and category counts. |
| `/api/dsh-skill-map/sync` | POST | Asks the profile's model for the copy every unwritten or changed skill is missing; writes `summaries.auto.json` beside the map file. |

## Security model

- Every route sits behind the family trust fence: a loopback socket plus a loopback Host header, or a live paired-device cookie when `dsh-remote-web-ui` is loaded. An unpaired LAN client gets `403 forbidden: loopback-only` before any file is read.
- Skill roots are read-only for this plugin. It writes only its own files under the DSH home directory: the map file, and the auto-copy file the sync action produces.
- The save route validates placements against a fresh inventory pass, so a request cannot describe a skill this host does not serve; unknown names are dropped and counted in the response.
- The map file is written atomically and parsed defensively, so a truncated or hand-edited file falls back to the shipped categories instead of breaking the panel.

## Known limitations

- The map is a right-sidebar tab whether or not `dsh-better-sidebar` is installed; the plugin uses that sidebar's tab service when present and the official right Sidebar's tab registry otherwise. Only when neither right sidebar is running does it fall back to a central panel, which covers the conversation while it is up.
- Categories are flat: there is no nesting and no per-skill note.
- A placement for an uninstalled skill is dropped on the next save rather than kept as a placeholder.
- The shipped categories are a one-time seed; after the first open the panel never rewrites them from the package.
- The sync action needs an `llm` service in the profile. Without one it reports the action as unavailable and leaves the rest of the panel working.

## Development

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## Release

```sh
pnpm typecheck && pnpm test && pnpm build
# bump "version" in package.json
pnpm publish:npm
```

`pnpm publish:npm` builds first, then runs `npm publish --ignore-scripts`. The flag suppresses the `prepare` hook, which would otherwise re-run tsdown on artifacts `pnpm build` has already produced from the sources. Types are emitted only by the `tsc -b` half of `pnpm build` (tsdown is configured with `dts: false`), so that step must stay.

Then attach the prebuilt tarball under the stable name the install line points at:

```sh
npm pack
# rename the produced kissfire-dsh-skill-map-<version>.tgz to kissfire-dsh-skill-map.tgz
gh release create v<version> kissfire-dsh-skill-map.tgz -R kissfirembx/dsh-skill-map --title v<version> --notes "…"
```

Updates reach users through npm: the market compares the published version with the installed one, so shipping code never needs a pull request. Only a change to this plugin's catalogue entry (description, category, repository URL) needs a PR to [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin).

Screenshots come from a root `screenshots.json` in this repository and are picked up on the market's nightly run: either a bare array of paths, `{"screenshots": [...]}`, or a map from the entry URL to paths — at most 8, relative paths only, resolved against this repository at HEAD. Adding or replacing a shot is therefore a push here and nothing else.

## Telemetry

The browser half sends one anonymous install heartbeat per UTC day to dsh-market.com: a random localStorage id and this package name, nothing else. Implementation: [src/client/telemetry.ts](src/client/telemetry.ts).

## License

BSD-3-Clause.
