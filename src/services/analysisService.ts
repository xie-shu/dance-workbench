import { createDemoReport } from '../data'
import type { AnalysisReport } from '../types'

export type AnalysisSettings = {
  systemPrompt: string
  knowledge: {
    bodyProfile: string
    wardrobe: string
    makeup: string
    budget: string
    preferences: string
    constraints: string
  }
}

export type AnalysisInput = {
  kind: 'jazz' | 'kpop' | 'custom'
  videoName: string
  settings: AnalysisSettings
}

/**
 * Service boundary for the future real analyzer. The browser demo deliberately
 * stays local, while the request shape already carries the editable prompt and
 * personal knowledge profile a backend/model adapter will need.
 */
export async function analyzeDanceVideo(input: AnalysisInput): Promise<AnalysisReport> {
  await new Promise((resolve) => window.setTimeout(resolve, 1900))
  return createDemoReport(input.kind, input.videoName)
}
