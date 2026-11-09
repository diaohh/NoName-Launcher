import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { ipc } from '../../services/ipcClient'
import { errorMessage } from '../../services/errors'
import { useIpcResource } from '../../hooks/useIpcResource'
import { useStatus } from '../../contexts/StatusContext'
import type { LauncherSettings } from '../../../../shared/ipcContract'
import JavaSection from './JavaSection'
import GameSection from './GameSection'
import LauncherSection from './LauncherSection'

/** For values main has already stored and answered with (RAM, data directory, Java path). */
export type UpdateSetting = <K extends keyof LauncherSettings>(key: K, value: LauncherSettings[K]) => void

/** Shows `changes` at once, writes them through `persist`, and reverts them if main refuses. */
export type SaveSettings = (
  changes: Partial<LauncherSettings>,
  persist: () => Promise<unknown>,
  failureMessage: string
) => Promise<void>

type TabId = 'game' | 'java' | 'launcher'

/** In the order the sidebar lists them; the first one is what the screen opens on. */
const TABS: readonly { id: TabId, label: string }[] = [
  { id: 'game', label: 'Juego' },
  { id: 'java', label: 'Java' },
  { id: 'launcher', label: 'Launcher' }
]

const tabId = (id: TabId) => `settings-tab-${id}`
const panelId = (id: TabId) => `settings-panel-${id}`

// Both columns start at the same height, so the screen title and the tab's title line up.
const TOP_PADDING = 'pt-[clamp(20px,4vh,40px)]'
const BOTTOM_PADDING = 'pb-[clamp(20px,4vh,40px)]'
// The content's side margins grow with the window, like the skin manager's.
const SIDE_PADDING = 'px-[clamp(24px,4vw,64px)]'

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="Cerrar"
      title="Cerrar"
      className="bg-transparent border-none text-white/50 hover:text-white cursor-pointer p-2 rounded hover:bg-white/5 transition-all duration-200"
    >
      <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
        <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  )
}

interface SettingsTabsProps {
  active: TabId
  onSelect: (id: TabId) => void
}

/**
 * The category list, as a WAI-ARIA tablist: a single tab stop (the open tab), and the arrows
 * and Home/End move between tabs, opening each one on the way — the panels are cheap to render.
 */
function SettingsTabs({ active, onSelect }: SettingsTabsProps) {
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const current = TABS.findIndex(tab => tab.id === active)
    const last = TABS.length - 1
    const targets: Partial<Record<string, number>> = {
      ArrowDown: current === last ? 0 : current + 1,
      ArrowUp: current === 0 ? last : current - 1,
      Home: 0,
      End: last
    }
    const index = targets[e.key]
    const tab = index === undefined ? undefined : TABS[index]
    if (!tab) return

    e.preventDefault()
    onSelect(tab.id)
    // Focus follows the selection, or the next arrow would start from the old tab.
    e.currentTarget.querySelector<HTMLButtonElement>(`#${tabId(tab.id)}`)?.focus()
  }

  return (
    <div role="tablist" aria-orientation="vertical" aria-label="Categorias" onKeyDown={handleKeyDown} className="flex flex-col gap-1">
      {TABS.map(tab => {
        const selected = tab.id === active
        return (
          <button
            key={tab.id}
            id={tabId(tab.id)}
            role="tab"
            aria-selected={selected}
            aria-controls={panelId(tab.id)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            className={`relative w-full text-left rounded-md px-4 py-2.5 text-sm font-semibold uppercase tracking-widest border-none cursor-pointer transition-colors duration-200 before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-full before:transition-colors before:duration-200 ${
              selected
                ? 'bg-card-hover text-white before:bg-accent-green'
                : 'bg-transparent text-white/50 hover:bg-white/5 hover:text-white before:bg-transparent'
            }`}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Ajustes, one category at a time: the categories on the left, the open one on the right.
 * The window is wider than it is tall, so the tabs take width it has to spare instead of
 * height it does not, and no tab needs a scroll at the minimum window size (900x560).
 */
export default function SettingsScreen({ onBack }: { onBack: () => void }) {
  const { showStatus } = useStatus()
  // Every visit starts on Juego, the category most players come here for.
  const [activeTab, setActiveTab] = useState<TabId>('game')

  const { data: settings, setData: setSettings, failed } = useIpcResource(ipc.config.getSettings, (err) => {
    // Without this the screen sat on "Cargando..." forever, with nothing in the log and
    // nothing on screen — on the very screen StatusContext was introduced for.
    console.error('Failed to load settings:', err)
    showStatus(errorMessage(err, 'No se han podido cargar los ajustes'), 'error')
  })

  /** For values main has already stored and answered with (RAM, data directory, Java path). */
  const updateSetting: UpdateSetting = (key, value) => {
    setSettings(prev => prev && { ...prev, [key]: value })
  }

  /**
   * Shows `changes` at once and writes them through `persist`. If main rejects the value
   * (CONFIG_INVALID_VALUE) or cannot write it (CONFIG_SAVE_FAILED), the screen goes back to
   * what is actually stored and says why: it never shows a value the disk did not receive.
   */
  const saveSettings: SaveSettings = async (changes, persist, failureMessage) => {
    if (!settings) return
    const keys = Object.keys(changes) as (keyof LauncherSettings)[]
    const previous: Partial<LauncherSettings> = Object.fromEntries(keys.map(key => [key, settings[key]]))
    setSettings(prev => prev && { ...prev, ...changes })

    try {
      await persist()
    } catch (err) {
      setSettings(prev => prev && { ...prev, ...previous })
      showStatus(errorMessage(err, failureMessage), 'error')
    }
  }

  const activeLabel = TABS.find(tab => tab.id === activeTab)?.label ?? ''

  // Only the open tab is mounted. Leaving a half-typed resolution or RAM value still saves
  // it: pressing a tab blurs the input first, and those commit on blur.
  let section: ReactNode = null
  if (settings && activeTab === 'game') {
    section = <GameSection settings={settings} onSave={saveSettings} />
  } else if (settings && activeTab === 'java') {
    section = <JavaSection settings={settings} onUpdate={updateSetting} onSave={saveSettings} />
  } else if (settings) {
    section = <LauncherSection settings={settings} onUpdate={updateSetting} />
  }

  return (
    <div className="w-full h-full flex overflow-hidden bg-[#1a1a1e] font-inter text-white">
      <nav className={`w-[240px] shrink-0 flex flex-col gap-6 px-4 ${TOP_PADDING} ${BOTTOM_PADDING} bg-sidebar-bg border-r border-sidebar-border`}>
        <h1 className="h-9 flex items-center px-4 text-xl font-black uppercase tracking-[-1px] whitespace-nowrap">
          Configuracion
        </h1>
        <SettingsTabs active={activeTab} onSelect={setActiveTab} />
      </nav>

      <div className="flex-1 min-w-0 flex flex-col">
        {/* The same frame while loading, so the way out never depends on the load. */}
        <div className={`shrink-0 h-9 box-content flex items-center justify-between gap-4 ${SIDE_PADDING} ${TOP_PADDING} pb-6`}>
          <h2 className="text-sm font-semibold text-white/50 uppercase tracking-widest">{activeLabel}</h2>
          <CloseButton onClick={onBack} />
        </div>

        {/* The scroll is a safety net for a tab that outgrows the window, not the layout. */}
        <div
          role="tabpanel"
          id={panelId(activeTab)}
          aria-labelledby={tabId(activeTab)}
          className={`flex-1 min-h-0 overflow-y-auto ${SIDE_PADDING} ${BOTTOM_PADDING}`}
        >
          {settings ? (
            <div className="max-w-[600px]">{section}</div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center gap-4">
              {failed ? (
                <>
                  <p className="text-white/50 text-sm">No se han podido cargar los ajustes.</p>
                  <button
                    onClick={onBack}
                    className="bg-white/5 border border-white/10 rounded px-5 py-2.5 text-sm text-white/70 hover:bg-white/10 hover:border-accent-green hover:text-white transition-all duration-200 cursor-pointer"
                  >
                    Volver
                  </button>
                </>
              ) : (
                <p className="text-white/30 text-sm">Cargando...</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
