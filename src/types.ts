export type TabId = 'today' | 'training' | 'analysis' | 'music'

export type Exercise = {
  id: string
  name: string
  category: string
  minutes: number
  level: '基础' | '进阶'
  cue: string
}

export type MusicTrack = {
  id: string
  title: string
  artist: string
  tag: string
  source: 'local'
  audioUrl?: string
  chorusStart?: number
  chorusEnd?: number
  blobKey?: string
  status: 'new' | 'remembered' | 'review'
  lastPlayed?: string
}

export type StoredMedia = {
  id: string
  name: string
  type: string
  size: number
  createdAt: string
  blob: Blob
}

export type AnalysisSection = {
  id: string
  title: string
  summary: string
  bullets: string[]
}

export type AnalysisReport = {
  id: string
  videoName: string
  videoKind: 'jazz' | 'kpop' | 'custom'
  createdAt: string
  bpm: string
  style: string
  sections: AnalysisSection[]
}
