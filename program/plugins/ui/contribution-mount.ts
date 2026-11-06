import { useLayoutEffect, useState, useSyncExternalStore } from 'react'
import type { ClientUiService } from '../../../src/client/plugin-api.js'

/** Keep a portal attached to its toolbar without searching during chat edits. */
export function useContributionMount(ui: ClientUiService, selector: string): HTMLElement | null {
  const revision = useSyncExternalStore(ui.subscribe, ui.snapshot)
  const [mount, setMount] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    let current: HTMLElement | null = null
    const sync = (): void => {
      current = document.querySelector<HTMLElement>(selector)
      const next = current
      setMount(previous => previous === next ? previous : next)
    }
    sync()
    const observer = new MutationObserver(records => {
      if (current && (!current.isConnected || !current.matches(selector))) {
        sync()
        return
      }
      const introduced = records.some(record => record.type === 'attributes'
        ? record.target instanceof Element && record.target.matches(selector)
        : [...record.addedNodes].some(node => node instanceof Element && (
          node.matches(selector) || node.querySelector(selector)
        )))
      if (introduced) sync()
    })
    observer.observe(document.querySelector('.shell-kernel') ?? document.body, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['data-ui-contribution'],
    })
    return () => observer.disconnect()
  }, [revision, selector])
  return mount
}
