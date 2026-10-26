import { useState, useSyncExternalStore, type ReactNode } from 'react'
import type { BrowserPlugin, ClientHostService } from '../../src/client/plugin-api.js'
import { KEEP_AWAKE_DEFAULT, KEEP_AWAKE_SET, KEEP_AWAKE_STATE, type KeepAwakeState } from './keep-awake-api.js'
import { SettingsRow, SettingsSwitch } from './ui/settings.js'

export function KeepAwakeSettings({ host }: { host: ClientHostService }): ReactNode {
  const snapshot = useSyncExternalStore(host.subscribe, host.snapshot)
  const state = snapshot.snapshot?.extensions[KEEP_AWAKE_STATE] as unknown as KeepAwakeState | undefined
  const { enabled, available, active, problem } = state ?? KEEP_AWAKE_DEFAULT
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const toggle = async () => {
    setPending(true)
    setError(undefined)
    try { await host.call(KEEP_AWAKE_SET, { enabled: !enabled }) }
    catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setPending(false) }
  }
  return <section className="settings-section">
    <h2>Power</h2>
    <div className="settings-card">
      <SettingsRow label="Keep awake while local agents work"
        description={available
          ? 'The screen can turn off or lock as usual without stopping local agents. Remote sessions don’t prevent sleep.'
          : 'Available in the Alto desktop app.'}
        role="switch" checked={enabled} disabled={!available || pending} onClick={() => void toggle()}>
        <SettingsSwitch on={enabled} />
      </SettingsRow>
      {(error || problem) && <div className="settings-row" role="alert"><span className="settings-row-copy"><small>{error ?? problem}</small></span></div>}
      {active && <div className="settings-row" role="status"><span className="settings-row-copy"><small>Preventing idle sleep.</small></span></div>}
    </div>
  </section>
}

const keepAwake: BrowserPlugin = (ctx) => {
  ctx.clientUi.registerSettingsPage(ctx, {
    id: 'keep-awake', label: 'Power', placement: 'general', order: 20,
    keywords: ['power', 'sleep', 'awake', 'battery', 'local'],
    renderer: () => <KeepAwakeSettings host={ctx.clientHost} />,
  })
}
keepAwake.inject = ['clientHost', 'clientUi']
export default keepAwake
