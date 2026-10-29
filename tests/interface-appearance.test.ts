import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { entriesOf, parseProgramProfile } from '../src/server/program-profile.js'

it('owns app-wide appearance independently of the replaceable workspace', () => {
  const profile = parseProgramProfile(readFileSync(new URL('../program/cordis.json', import.meta.url), 'utf8'))
  const interfaceEntry = profile.plugins.find((entry) => entry.id === 'interface')
  const appearance = interfaceEntry?.children?.find((entry) => entry.client === 'plugins/interface-appearance.client.ts')
  expect(appearance).toMatchObject({ enabled: true })

  const withoutWorkspace = {
    ...profile,
    plugins: profile.plugins.map((entry) => entry.id === 'interface'
      ? { ...entry, children: entry.children?.filter((child) => child.id !== 'workspace-layout') ?? [] }
      : entry),
  }
  const remaining = entriesOf(withoutWorkspace).map(({ entry }) => entry)
  expect(remaining.filter((entry) => entry.client === 'plugins/interface-appearance.client.ts')).toEqual([appearance])
  expect(remaining.some((entry) => entry.client === 'plugins/ui-surfaces.client.tsx')).toBe(true)
  expect(remaining.some((entry) => entry.client === 'plugins/search.client.tsx')).toBe(true)
})
