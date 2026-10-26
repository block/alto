import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isRecord, type ThreadSummary } from '../../src/shared/protocol.js'
import { workspacePane, workspacePaneIds, type WorkspaceLayoutState } from './workspace-layout-state.js'
import type { NamedConversation, SavedTabSummary, WorkspaceHistoryService } from './workspace-history-api.js'

/** Keeps tab names after a rename, closure, restart, or navigation to another chat. */
export class WorkspaceHistory implements WorkspaceHistoryService {
  private readonly named = new Map<string, NamedConversation>()
  private openTabs: SavedTabSummary[] = []
  private saved = ''

  constructor(private readonly file: string, private readonly publish: (records: NamedConversation[]) => void) {}

  async load(): Promise<void> {
    try {
      const value: unknown = JSON.parse(await readFile(this.file, 'utf8'))
      if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.conversations)) throw new Error('Invalid saved tab-name history')
      for (const entry of value.conversations) {
        if (!isRecord(entry) || !isRecord(entry.thread) || typeof entry.thread.id !== 'string'
          || typeof entry.thread.title !== 'string' || !Array.isArray(entry.titles)) continue
        this.named.set(entry.thread.id, {
          thread: entry.thread as unknown as ThreadSummary,
          titles: entry.titles.filter((title): title is string => typeof title === 'string' && Boolean(title.trim())),
        })
      }
      this.saved = this.serialize()
      this.publish(this.conversations())
    } catch (error) {
      if (!isRecord(error) || error.code !== 'ENOENT') throw error
    }
  }

  conversations(): NamedConversation[] { return structuredClone([...this.named.values()]) }
  tabs(): SavedTabSummary[] { return structuredClone(this.openTabs) }

  observe(layout: WorkspaceLayoutState): void {
    this.openTabs = layout.views.map((view) => {
      const panes = workspacePaneIds(view.root).map((id) => workspacePane(view.root, id)!)
      for (const pane of panes) {
        if (!pane.thread) continue
        const prior = this.named.get(pane.thread.id)
        const titles = new Set(prior?.titles)
        const name = view.name.trim()
        if (name && !/^(New chat(?: \d+)?|Untitled conversation)$/iu.test(name)) titles.add(name)
        // Status and streaming updates do not belong in the durable name index.
        const { status: _status, canAcceptDirectInput: _input, ...thread } = pane.thread
        this.named.set(thread.id, { thread, titles: [...titles] })
      }
      return {
        id: view.id, title: view.name, active: view.id === layout.activeViewId,
        panes: panes.map((pane) => ({ id: pane.id, kind: pane.kind ?? 'chat', ...(pane.thread ? { threadId: pane.thread.id } : {}) })),
      }
    })
  }

  private serialize(): string { return JSON.stringify({ version: 1, conversations: [...this.named.values()] }) }

  /** Called in the same write queue as the layout, before replacing that layout. */
  async save(): Promise<void> {
    const content = this.serialize()
    if (content === this.saved) return
    await mkdir(path.dirname(this.file), { recursive: true })
    const temporary = `${this.file}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, content + '\n', { mode: 0o600 })
      await rename(temporary, this.file)
      this.saved = content
      this.publish(this.conversations())
    } finally { await rm(temporary, { force: true }).catch(() => undefined) }
  }
}
