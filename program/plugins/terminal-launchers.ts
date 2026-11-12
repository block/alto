import type { Context } from 'cordis'
import type { TerminalLauncher, TerminalLaunchRequest, TerminalTabAccessory } from './ghostty-terminal-api.js'

export class TerminalLaunchers {
  private launcher: TerminalLauncher | undefined

  register(owner: Context, launcher: TerminalLauncher): { dispose(): void } {
    if (this.launcher) throw new Error(`Terminal launcher ${this.launcher.id} is already registered`)
    const dispose = owner.effect(() => {
      this.launcher = launcher
      return () => { if (this.launcher === launcher) this.launcher = undefined }
    })
    return { dispose }
  }

  async prepare(request: TerminalLaunchRequest): Promise<{ command?: string }> {
    return request.identity && this.launcher
      ? this.launcher.prepare(request)
      : (request.command ? { command: request.command } : {})
  }

  async close(identity: NonNullable<TerminalLaunchRequest['identity']>): Promise<void> {
    await this.launcher?.close(identity)
  }
}

/** Accessories drawn on terminal tabs, held as an external store for React. */
export class TerminalTabAccessories {
  private readonly listeners = new Set<() => void>()
  private accessories: readonly TerminalTabAccessory[] = []

  register(owner: Context, accessory: TerminalTabAccessory): { dispose(): void } {
    if (this.accessories.some((candidate) => candidate.id === accessory.id)) {
      throw new Error(`Terminal tab accessory ${accessory.id} is already registered`)
    }
    const dispose = owner.effect(() => {
      this.update([...this.accessories, accessory])
      return () => this.update(this.accessories.filter((candidate) => candidate !== accessory))
    }, `clientGhosttyTerminal.registerTabAccessory(${JSON.stringify(accessory.id)})`)
    return { dispose }
  }

  snapshot = (): readonly TerminalTabAccessory[] => this.accessories

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private update(next: TerminalTabAccessory[]): void {
    this.accessories = next.sort((left, right) => (
      (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id)
    ))
    for (const listener of this.listeners) listener()
  }
}
