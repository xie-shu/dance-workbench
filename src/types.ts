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
  durationSeconds?: number
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

export type AssistantBlock = {
  title: string
  detail: string
  items: string[]
}

export type AssistantResult = {
  id: string
  kind: 'training'
  title: string
  summary: string
  source: 'demo' | 'live'
  createdAt: string
  blocks: AssistantBlock[]
  plan?: ExecutableTrainingPlan
}

export type ExecutableTrainingPlan = {
  mode?: 'fundamentals' | 'dance'
  exerciseIds: string[]
  exerciseMinutes?: Record<string, number>
  trackId?: string
  trackIds?: string[]
  musicDurationSeconds?: number
  totalMinutes: number
}

export type AgentMemory = {
  id: string
  category: 'preference' | 'body' | 'goal' | 'routine'
  content: string
  createdAt: string
}

export type KnowledgeNote = {
  id: string
  title: string
  content: string
  tags: string[]
  createdAt: string
}

export type AgentToolRun = {
  id: string
  name: string
  label: string
  summary: string
  status: 'done' | 'skipped'
}

export type AgentEffect =
  | { type: 'set_today_plan'; exerciseIds: string[] }
  | { type: 'save_memory'; memory: AgentMemory }
  | { type: 'add_knowledge'; note: KnowledgeNote }
  | { type: 'save_assistant_result'; result: AssistantResult }

export type AgentMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  source?: 'local' | 'live' | 'tool'
  tools?: AgentToolRun[]
}

export type AgentRunResult = {
  answer: string
  source: 'local' | 'live' | 'tool'
  tools: AgentToolRun[]
  effects: AgentEffect[]
  diagnostic?: string
}
