/**
 * Test helpers for the skill-map host surface: fake HTTP request/response
 * objects (the shared trust fence reads socket, Host header and same-origin
 * markers) and temp skill roots.
 */

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Captured response of a fake ServerResponse. */
export interface FakeResponse {
  status: number
  body: unknown
}

/** A fake IncomingMessage: loopback socket, loopback Host, optional JSON body. */
export function fakeRequest(options: { method: string; url: string; body?: unknown; remoteAddress?: string; host?: string }): IncomingMessage {
  const chunks = options.body === undefined ? [] : [Buffer.from(JSON.stringify(options.body), 'utf8')]
  return {
    method: options.method,
    url: options.url,
    socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1' },
    headers: { host: options.host ?? '127.0.0.1:19387' },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
    destroy() {},
  } as unknown as IncomingMessage
}

/** A fake ServerResponse that records status and the parsed JSON body. */
export function fakeResponse(): { res: ServerResponse; captured: FakeResponse } {
  const captured: FakeResponse = { status: 0, body: undefined }
  const res = {
    writeHead(status: number) {
      captured.status = status
      return res
    },
    end(payload?: string) {
      captured.body = payload === undefined ? undefined : JSON.parse(payload)
      return res
    },
  }
  return { res: res as unknown as ServerResponse, captured }
}

/** Create an isolated temp directory. */
export async function makeTempDir(prefix = 'dsh-skill-map-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix))
}

/** Write `<root>/<name>/SKILL.md` with the given frontmatter fields. */
export async function writeSkill(root: string, name: string, frontmatter: Record<string, string>): Promise<string> {
  const dir = join(root, name)
  await mkdir(dir, { recursive: true })
  const lines = Object.entries(frontmatter).map(([key, value]) => `${key}: ${value}`)
  const file = join(dir, 'SKILL.md')
  await writeFile(file, `---\n${lines.join('\n')}\n---\n\n# ${name}\n`, 'utf8')
  return file
}
