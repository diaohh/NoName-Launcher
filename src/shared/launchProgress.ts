import type { ErrorCode } from './errorCodes'

/**
 * The `launch:progress` contract (ADR-0005): one event type per `type`, so the renderer's
 * switch is exhaustive and a phase without a slice of the bar does not compile.
 */

/**
 * The preparation phases, in launch order. Each one owns a fixed slice of the progress bar
 * (`PHASE_RANGE` in the renderer's `launchPhases`), which is why a phase must appear exactly
 * once in a launch: a repeated one would make the bar run backwards.
 */
export type PhaseType =
  | 'auth'
  | 'manifest'
  | 'validation'
  | 'download_mods'
  | 'download'
  | 'java'
  | 'java_discover'
  | 'java_download'
  | 'java_extract'
  | 'modloader'
  | 'download_libraries'
  | 'launch'

/**
 * What every manager under `LaunchManager` reports: its own numbers, with no idea which launch
 * phase it is serving. `LaunchManager` is the one layer that adds `type`, except for Java's own
 * sub-phases (`JavaManager`) and the running game's events (`GameProcess`).
 */
export interface StepProgress {
  current: number
  total: number
  message: string
}

/** A preparation phase. With no countable total the bar sits on the phase's floor. */
export interface PhaseEvent {
  type: PhaseType
  message: string
  current?: number
  total?: number
  /** The header text when it is not the phase's own label (Minecraft's download sub-phase). */
  phase?: string
}

/** The JVM is up. Emitted on the child's `spawn` event, never right after calling `spawn()`. */
export interface StartedEvent {
  type: 'started'
  message: string
  pid: number
}

/**
 * The game's own startup, read from milestones in its output (`main/utils/StartupTracker`).
 * `current` is null while nothing has been recognised, which the bar shows as indeterminate,
 * and `done` arrives exactly once.
 */
export interface StartupProgress {
  current: number | null
  total: number
  message: string
  done: boolean
}

/** The one type that repeats, and has no slice in `PHASE_RANGE`: it drives the last step on its own. */
export interface GameStartupEvent extends StartupProgress {
  type: 'game_startup'
}

/** Whole lines of the game's output, one event per chunk the pipe delivered. */
export interface GameOutputEvent {
  type: 'stdout' | 'stderr'
  lines: string[]
}

export interface ExitEvent {
  type: 'exit'
  code: number | null
}

/** Only the preparation fails this way; a game that is already running ends with `exit`. */
export interface LaunchErrorEvent {
  type: 'error'
  error: string
  code: ErrorCode
}

export type LaunchProgress =
  | PhaseEvent
  | StartedEvent
  | GameStartupEvent
  | GameOutputEvent
  | ExitEvent
  | LaunchErrorEvent
