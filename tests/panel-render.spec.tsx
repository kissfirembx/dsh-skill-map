import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SkillMapPanel } from '../src/client/SkillMapPanel.tsx'
import type { SkillMapApi } from '../src/client/api.ts'
import type { MapPayload, MapWorkspace } from '../src/core/payload.ts'

/**
 * Render-level smoke tests for the workspace shell. The panel is the one place
 * where a wrong state shape shows up as an empty screen rather than a type
 * error, so these mount it against a fake API: the first-run prompt, the tab
 * strip, and switching tabs.
 */

function payload(workspaces: MapWorkspace[]): MapPayload {
  return {
    cwd: 'c',
    complete: true,
    total: 2,
    skills: ['alpha', 'zeta'],
    workspaces,
    descriptions: { alpha: 'A', zeta: 'Z' },
    summaries: { alpha: 'A', zeta: 'Z' },
    mapPath: '/tmp/skill-map/map.json',
  }
}

/** A workspace fixture with one category holding alpha and zeta unassigned. */
function workspace(id: string, name: string, category: string): MapWorkspace {
  return {
    id,
    name,
    categories: [{ id: 'c1', name: category, skills: ['alpha'] }],
    unassigned: ['zeta'],
  }
}

/** A workspace whose categories are built but nothing is placed yet. */
function emptyWorkspace(id: string, name: string, category: string): MapWorkspace {
  return {
    id,
    name,
    categories: [{ id: 'c1', name: category, skills: [] }],
    unassigned: ['alpha', 'zeta'],
  }
}

function fakeApi(listPayload: MapPayload): SkillMapApi {
  return {
    list: vi.fn(async () => listPayload),
    save: vi.fn(async () => ({ ok: true, mapPath: '/tmp/skill-map/map.json', dropped: 0 })),
    health: vi.fn(),
    sync: vi.fn(),
    auto: vi.fn(async () => ({
      ok: true,
      workspaceId: 'w1',
      name: '我的分类',
      mode: 'assign' as const,
      source: 'model' as const,
      assigned: 2,
      total: 2,
    })),
  } as unknown as SkillMapApi
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
})

/** Mount the panel and let its list promise settle. */
async function mount(api: SkillMapApi): Promise<void> {
  await act(async () => {
    root.render(<SkillMapPanel api={api} />)
  })
}

describe('SkillMapPanel workspaces', () => {
  it('shows the first-run prompt when the document has no workspace', async () => {
    await mount(fakeApi(payload([])))
    expect(container.textContent).toContain('还没有工作区')
    expect(container.querySelector('[data-dsh-part="workspaces"]')).toBeNull()
  })

  it('renders one tab per workspace and the active classification', async () => {
    await mount(fakeApi(payload([workspace('w1', '默认分类', '甲类'), workspace('w2', '第二套', '乙类')])))
    const tabs = [...container.querySelectorAll('[data-dsh-part="workspaces"] button')]
      .map((button) => button.textContent)
    expect(tabs).toContain('默认分类')
    expect(tabs).toContain('第二套')
    expect(container.textContent).toContain('甲类')
    expect(container.textContent).not.toContain('乙类')
  })

  it('switches the list when another tab is clicked', async () => {
    await mount(fakeApi(payload([workspace('w1', '默认分类', '甲类'), workspace('w2', '第二套', '乙类')])))
    const second = [...container.querySelectorAll('button')]
      .find((button) => button.textContent === '第二套')
    expect(second).toBeDefined()
    await act(async () => {
      second!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.textContent).toContain('乙类')
    expect(container.textContent).not.toContain('甲类')
  })

  it('adds a blank workspace from the plus button', async () => {
    await mount(fakeApi(payload([workspace('w1', '默认分类', '甲类')])))
    const add = container.querySelector('button[aria-label="新建工作区"]')
    expect(add).not.toBeNull()
    await act(async () => {
      add!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.textContent).toContain('工作区 2')
    expect(container.textContent).toContain('这个工作区还没有分类')
  })

  it('offers to place skills into categories the user already built', async () => {
    const api = fakeApi(payload([emptyWorkspace('w1', '我的分类', '甲类')]))
    await mount(api)
    expect(container.querySelector('[data-dsh-part="assign-hint"]')).not.toBeNull()
    expect(container.textContent).toContain('分类建好了')

    const button = [...container.querySelectorAll('button')]
      .find((candidate) => candidate.textContent === '按这些分类自动分配')
    expect(button).toBeDefined()
    await act(async () => {
      button!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    // The panel persists the workspace first, then asks the host to fill it.
    expect(api.save).toHaveBeenCalled()
    expect(api.auto).toHaveBeenCalledWith('w1')
  })

  it('hides the guided hint once something is placed', async () => {
    await mount(fakeApi(payload([workspace('w1', '我的分类', '甲类')])))
    expect(container.querySelector('[data-dsh-part="assign-hint"]')).toBeNull()
  })
})
