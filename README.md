# dsh-skill-map

English | [中文](README.zh.md)

DSH skill map: browse every loaded skill through one or more of your own classifications — workspaces — in a right-sidebar tab. Each workspace is a complete way of sorting the same skills; switch with the tab strip, rename, add, delete, reorder or re-file anything in place.

## What it does

- Contributes one tab to the right sidebar, through the public service the right sidebar exposes to other plugins.
- The tab strip names the workspaces: one tab is one classification (its own category list plus where every skill sits), so switching tabs switches the whole scheme. `+` opens a blank workspace, double-click renames a tab, and the close glyph on a tab deletes it after an inline confirmation.
- The first open has no workspace, by design: the panel is blank, says how many skills are loaded, and offers "Classify with AI" (builds the first workspace) or "New blank workspace" (start from nothing). The AI path asks the profile's model first and falls back to the shipped category table when there is no model, the call fails, or the reply is unusable — the button never dead-ends.
- Or the other way round: build the categories yourself first, and the panel offers "Assign with these categories" above the list. The model then places the still-unassigned skills into the categories you built. It only fills skills that are not placed yet — anything you filed yourself stays put — and it reports a failure instead of writing anything when it cannot place a single skill.
- Shows the loaded skills as categories: a caret, a category name and a count, collapsed by default. A skill row is one line — the name, then a one-sentence summary of what the skill does. Hovering the row (or filtering a search) swaps that summary for the GitHub project the skill was downloaded from — read from the skills installer's ledger — and the fuller description.
- Copy drift is tracked internally and stays off the screen: when a newly installed skill still has no copy, the footer offers a small "Write N missing lines" chip that runs the same update pass. Rows whose skill changed underneath them, and rows left behind by a deletion, are no longer reported and need no attention.
- Can write the copy for you: the Update action in the header asks the profile's own model to fill every missing line and refresh the ones whose skill changed, then reloads the list and reports what it wrote. A machine-written line never overrides one you wrote by hand. Copy is per skill and shared by every workspace.
- Searches skill names and descriptions within the current workspace, and expands or collapses every category at once.
- Switches the description language from the panel's own settings view (the gear in the header): the skill's own text, or any translation cache kept at `$DSH_HOME/skill-map/descriptions.<lang>.json`. A skill with no row in that cache keeps its own text.
- Creates and renames categories from the panel, and reorders them by dragging. Deleting asks first: the trash icon opens an inline bar naming the category and how many skills will return to Unassigned, and only its Delete button removes anything.
- Keeps Unassigned in a band pinned under the list — always reachable, collapsed until you open it, and capped in height so an expanded bucket cannot take over the pane.
- Moves a skill between categories, or back to Unassigned, by dragging it onto the target category.
- Re-files a skill without dragging: open a row (hover or keyboard focus) and pick a category from the small picker under its description. The picker is part of the open row only, so a resting row still reads as one line and a search that reveals the description does not unfold it. The footer names the destination, because the target category may be collapsed.
- Copies `/skill-name` when a skill row is clicked, ready for the composer.
- Keeps the workspaces in a user-owned file, so they outlive the plugin version. A version 2 single-map file becomes the first workspace, named after `DEFAULT_WORKSPACE_NAME`, the first time it is read.

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
| `dshHome` | string | DSH home override; the workspace document lives under it. |
| `agentsHome` | string | Agents home override (`~/.agents`). |
| `syncModel` | string | Model route (`provider/model`) used by Update and by auto classify. Defaults to the model this profile's agent runs. |

## Routes

| Route | Method | Meaning |
| --- | --- | --- |
| `/api/dsh-skill-map/list` | GET | The whole inventory plus every workspace with its placements resolved; accepts an optional `?cwd=`. |
| `/api/dsh-skill-map/save` | POST | Writes the whole workspace document (every tab, category and placement). |
| `/api/dsh-skill-map/workspaces/auto` | POST | Asks the model to classify: a workspace with no categories gets a scheme proposed; a workspace with categories gets its still-unassigned skills placed into them. Optional body `{ "workspaceId": "w2" }`. |
| `/api/dsh-skill-map/health` | GET | Health check carrying the skill and workspace counts. |
| `/api/dsh-skill-map/sync` | POST | Asks the profile's model for the copy every unwritten or changed skill is missing; writes `summaries.auto.json` beside the workspace document. |

## Security model

- Every route sits behind the family trust fence: a loopback socket plus a loopback Host header, or a live paired-device cookie when `dsh-remote-web-ui` is loaded. An unpaired LAN client gets `403 forbidden: loopback-only` before any file is read.
- Skill roots are read-only for this plugin. It writes only its own files under the DSH home directory: the workspace document, and the auto-copy file the Update action produces.
- The save route validates placements against a fresh inventory pass, so a request cannot describe a skill this host does not serve; unknown names are dropped and counted in the response. The whole document is validated together: workspace ids and category ids must be unique, and every placement must name a category the document carries.
- Auto classify only fills skills that are still unassigned; a skill already placed is never moved. When the workspace already has categories, the model may only place skills into those — it cannot invent or rename one. A pass that places nothing answers `502` and leaves the file untouched, and without an `llm` service the guided pass answers `503` (the built-in table cannot answer "which of your categories").
- The workspace document is written atomically and parsed defensively. A missing, truncated or hand-edited file degrades to "no workspace", leaving the choice of re-classifying to the user instead of planting a classification they never confirmed.

## Known limitations

- At most 20 workspaces, and at most 200 categories per workspace; a save beyond either bound is rejected.
- The map is a right-sidebar tab whether or not `dsh-better-sidebar` is installed; the plugin uses that sidebar's tab service when present and the official right Sidebar's tab registry otherwise. Only when neither right sidebar is running does it fall back to a central panel, which covers the conversation while it is up.
- Categories are flat: there is no nesting and no per-skill note.
- A placement for an uninstalled skill is dropped on the next save rather than kept as a placeholder.
- Workspaces share no categories: how one tab sorts a skill says nothing about another. Switching tabs collapses every open category, because two tabs can reuse the same category ids.
- Update needs an `llm` service in the profile; without one it reports the action as unavailable. Auto classify falls back to the built-in table only when it has to propose a scheme; a guided pass needs the model and says so.
- The built-in table only backs "propose a scheme"; opening the panel never seeds a workspace on its own.

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
