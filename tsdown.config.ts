/**
 * Standalone tsdown config for the skill-map plugin.
 *
 * Uses the client-bundle preset vendored under build/ (a copy of the dsh-web
 * plugin family's shared/tsdown.client.ts): node-half lib/ (skill inventory and
 * map routes) plus the browser bundle lib/client.js — a closure-factory
 * artifact for the GUI's __ModuleLoader__, with CSS Modules inlined and an
 * auto-injected <style data-plugin>. The client entry is auto-detected at
 * src/client/index.ts by the preset.
 */
import { clientBundle } from './build/tsdown.client.ts'

export default clientBundle('@kissfire/dsh-skill-map', ['src/index.ts'], {
  libExternal: [
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-host-webserver',
  ],
})
