# dsh-skill-map

English | [中文](README.zh.md)

DSH skill map: browse every loaded skill through your own categories in a right-sidebar tab, and rename, add, delete, reorder or re-file them in place.

## What it does

- Contributes one tab to the right sidebar, through the public service the right sidebar exposes to other plugins.
- Shows the loaded skills as categories: a caret, a category name and a count, collapsed by default. A skill row is one line; its description unfolds on hover, and while a search is filtering.
- Searches skill names and descriptions, and expands or collapses every category at once.
- Switches the description language from the panel's own settings view (the gear in the header): the skill's own text, or any translation cache kept at `$DSH_HOME/skill-map/descriptions.<lang>.json`. A skill with no row in that cache keeps its own text.
- Creates, renames and deletes categories from the panel, and reorders them by dragging.
- Moves a skill between categories, or back to Unassigned, by dragging it onto the target category.
- Copies `/skill-name` when a skill row is clicked, ready for the composer.
- Keeps the map in a user-owned file, so the categories outlive the plugin version.

## Install

```sh
dsh plugin --profile web add dsh-skill-map
```

Every release also ships the built package as a tarball on [Releases](https://github.com/coolwyz/dsh-skill-map/releases) — same content, no build step (bump the tag in the URL for later releases):

```sh
dsh plugin --profile web add https://github.com/coolwyz/dsh-skill-map/releases/download/v0.1.0/dsh-skill-map-0.1.0.tgz
```

Restart `dsh web`, or toggle the plugin's row in the plugin manager, then open the map tab in the right sidebar. The tab needs a right sidebar that exposes its plugin service; without one (no `dsh-better-sidebar` in the profile) the plugin stays installed and simply contributes no surface.

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

## Security model

- Every route sits behind the family trust fence: a loopback socket plus a loopback Host header, or a live paired-device cookie when `dsh-remote-web-ui` is loaded. An unpaired LAN client gets `403 forbidden: loopback-only` before any file is read.
- Skill roots are read-only for this plugin. The only file it writes is its own map file under the DSH home directory.
- The save route validates placements against a fresh inventory pass, so a request cannot describe a skill this host does not serve; unknown names are dropped and counted in the response.
- The map file is written atomically and parsed defensively, so a truncated or hand-edited file falls back to the shipped categories instead of breaking the panel.

## Known limitations

- The tab needs a right sidebar that exposes the plugin service; a profile without one leaves the plugin with no surface at all.
- Categories are flat: there is no nesting and no per-skill note.
- A placement for an uninstalled skill is dropped on the next save rather than kept as a placeholder.
- The shipped categories are a one-time seed; after the first open the panel never rewrites them from the package.

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

Updates reach users through npm: the market compares the published version with the installed one, so shipping code never needs a pull request. Only a change to this plugin's catalogue entry (description, category, repository URL) needs a PR to [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin); screenshots come from `screenshots.json` in this repository and are picked up nightly.

## Telemetry

The browser half sends one anonymous install heartbeat per UTC day to dsh-market.com: a random localStorage id and this package name, nothing else. Implementation: [src/client/telemetry.ts](src/client/telemetry.ts).

## License

BSD-3-Clause.
