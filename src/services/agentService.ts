import type { AssistantSettings } from './assistantSettings'
import type {
  AgentEffect,
  AgentMemory,
  AgentMessage,
  AgentRunResult,
  AgentToolRun,
  AssistantResult,
  Exercise,
  KnowledgeNote,
  MusicTrack,
} from '../types'

export type AgentContext = {
  exercises: Exercise[]
  tracks: MusicTrack[]
  completedIds: string[]
  todayIds: string[]
  memories: AgentMemory[]
  knowledge: KnowledgeNote[]
  settings: AssistantSettings
  latestResult?: AssistantResult | null
}

const DEFAULT_AGENT_ENDPOINT = 'https://dance-workbench-d0fsehk340b824c0.service.tcloudbase.com/api/agent'

export const INITIAL_AGENT_KNOWLEDGE: KnowledgeNote[] = [
  {
    id: 'knowledge-training-order',
    title: '基本功训练顺序',
    content: '先关节活动与身体分离，再练重心和步伐，之后做协调组合，最后进入音乐串联。单项控制在 1 到 3 分钟。',
    tags: ['基本功', '训练顺序'],
    createdAt: '2026-08-14T00:00:00.000Z',
  },
  {
    id: 'knowledge-music-training',
    title: '训练选曲方法',
    content: '基本功计划随机排列曲库中的完整歌曲，按实际歌曲时长选足覆盖整份计划的曲目；歌曲结束后自动播放下一首。',
    tags: ['选曲', '训练计划'],
    createdAt: '2026-08-14T00:00:00.000Z',
  },
]

const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds))
const now = () => new Date().toISOString()
const uid = () => crypto.randomUUID()
const danceRemovePattern = /(?:不要|去掉|删除|删掉|删去|减去|减掉|排除|移除)/
const danceAddPattern = /(?:增加|新增|添加|加上|加入|多加|补上)/
const danceEditPattern = /(?:不要|去掉|删除|删掉|减去|排除|移除|增加|新增|添加|加上|加入|多加|补上|换掉|保留)/
const danceReorderPattern = /(换(?:个|一下)?顺序|调整(?:一下)?顺序|重新(?:排|排序)|打乱(?:一下)?顺序|洗(?:个|一下)?牌|还是(?:这|那)(?:几|些)首(?:歌|歌曲)?|(?:这|那)(?:几|些)首(?:歌|歌曲)?.*(?:换|调|重新|打乱))/

function parseChineseInteger(value: string) {
  if (/^\d+$/.test(value)) return Number(value)
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  let total = 0
  let current = 0
  for (const character of value) {
    if (character in digits) {
      current = digits[character]
    } else if (character === '十') {
      total += (current || 1) * 10
      current = 0
    } else if (character === '百') {
      total += (current || 1) * 100
      current = 0
    } else {
      return undefined
    }
  }
  const result = total + current
  return result > 0 ? result : undefined
}

function numberBeforeUnit(prompt: string, unit: '首' | '分钟') {
  const match = prompt.match(new RegExp(`(\\d+|[零〇一二两三四五六七八九十百]+)\\s*${unit}`))
  return match ? parseChineseInteger(match[1]) : undefined
}

function numberAfterAction(prompt: string, action: RegExp) {
  const match = prompt.match(new RegExp(`${action.source}\\s*(?:随机)?\\s*(\\d+|[零〇一二两三四五六七八九十百]+)\\s*首`))
  return match ? parseChineseInteger(match[1]) : undefined
}

function tool(name: string, label: string, summary: string, status: AgentToolRun['status'] = 'done'): AgentToolRun {
  return { id: uid(), name, label, summary, status }
}

function timeLabel(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function keywords(value: string) {
  return value.toLowerCase().split(/[\s，。！？、,.!?：:；;（）()\-_/]+/).filter((item) => item.length > 1)
}

function searchKnowledge(prompt: string, notes: KnowledgeNote[]) {
  const terms = keywords(prompt)
  return notes
    .map((note) => {
      const source = `${note.title} ${note.content} ${note.tags.join(' ')}`.toLowerCase()
      return { note, score: terms.reduce((sum, term) => sum + (source.includes(term) ? 1 : 0), 0) }
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((item) => item.note)
}

function findTrack(prompt: string, tracks: MusicTrack[]) {
  const lower = prompt.toLowerCase()
  return tracks.find((track) => lower.includes(track.title.toLowerCase()) || lower.includes(track.artist.toLowerCase()))
    ?? tracks.find((track) => prompt.includes(track.status === 'review' ? '待复习' : '__never__'))
    ?? tracks[0]
}

function seededTrackQueue(tracks: MusicTrack[], targetSeconds: number, seed: string, preferredId?: string) {
  const eligible = tracks.filter((track) => Number.isFinite(track.durationSeconds) && (track.durationSeconds ?? 0) > 0)
  const score = (value: string) => {
    let hash = 2166136261
    for (const character of `${seed}:${value}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
    return hash >>> 0
  }
  const ordered = [...eligible].sort((a, b) => score(a.id) - score(b.id))
  if (preferredId) {
    const preferredIndex = ordered.findIndex((track) => track.id === preferredId)
    if (preferredIndex > 0) ordered.unshift(...ordered.splice(preferredIndex, 1))
  }
  const trackIds: string[] = []
  let durationSeconds = 0
  let index = 0
  while (ordered.length && durationSeconds < targetSeconds && index < 100) {
    const track = ordered[index % ordered.length]
    trackIds.push(track.id)
    durationSeconds += track.durationSeconds ?? 0
    index += 1
  }
  return { trackIds, durationSeconds }
}

function allocateExerciseMinutes(exercises: Exercise[], targetMinutes: number) {
  const exerciseMinutes = Object.fromEntries(exercises.map((exercise) => [exercise.id, Math.min(3, Math.max(1, exercise.minutes))]))
  let totalMinutes = Object.values(exerciseMinutes).reduce((sum, value) => sum + value, 0)
  while (totalMinutes < targetMinutes) {
    const exercise = exercises.find((item) => exerciseMinutes[item.id] < 3)
    if (!exercise) break
    exerciseMinutes[exercise.id] += 1
    totalMinutes += 1
  }
  while (totalMinutes > targetMinutes) {
    const exercise = [...exercises].reverse().find((item) => exerciseMinutes[item.id] > 1)
    if (!exercise) break
    exerciseMinutes[exercise.id] -= 1
    totalMinutes -= 1
  }
  return { exerciseMinutes, totalMinutes }
}

function isDancePlanRequest(prompt: string, context: AgentContext) {
  const asksForDance = /(随舞|随机舞蹈)/.test(prompt) && (
    /(计划|方案|安排|排序|生成|练习|训练|开始|开跳)/.test(prompt)
    || /(想|要|来|做|练|开始|帮我|给我).*(随舞|随机舞蹈)/.test(prompt)
    || /\d+\s*分钟.*(随舞|随机舞蹈)/.test(prompt)
  )
  return asksForDance
    || (context.latestResult?.plan?.mode === 'dance' && (danceEditPattern.test(prompt) || danceReorderPattern.test(prompt) || /(再生成|重新)/.test(prompt)))
}

function createDancePlan(prompt: string, context: AgentContext): AssistantResult | null {
  const tracks = context.tracks.filter((track) => track.audioUrl || track.blobKey)
  const previousIds = context.latestResult?.plan?.mode === 'dance' ? (context.latestResult.plan.trackIds ?? []) : []
  const modifying = previousIds.length > 0 && danceEditPattern.test(prompt)
  const requestedCount = numberBeforeUnit(prompt, '首')
  const requestedMinutes = numberBeforeUnit(prompt, '分钟')
  const reorderOnly = previousIds.length > 0 && danceReorderPattern.test(prompt)
  const reshufflingPrevious = previousIds.length > 0 && (reorderOnly || (/(再生成|重新)/.test(prompt) && !requestedCount && !requestedMinutes))
  const wantsRemoval = previousIds.length > 0 && danceRemovePattern.test(prompt)
  const wantsAddition = previousIds.length > 0 && danceAddPattern.test(prompt)
  const named = (track: MusicTrack) => {
    const index = prompt.toLowerCase().indexOf(track.title.toLowerCase())
    if (index < 0) return { excluded: false, added: false }
    const prefix = prompt.slice(Math.max(0, index - 10), index)
    return { excluded: /(不要|去掉|删除|删掉|删去|减去|减掉|排除|移除|不放)/.test(prefix), added: /(增加|新增|添加|加上|加入|多加|补上|放入|保留|要有)/.test(prefix) }
  }
  const excluded = new Set(tracks.filter((track) => named(track).excluded).map((track) => track.id))
  const namedAdditions = tracks.filter((track) => named(track).added && !excluded.has(track.id)).map((track) => track.id)
  const resultId = uid()
  const score = (value: string) => {
    let hash = 2166136261
    for (const character of `${resultId}:${value}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
    return hash >>> 0
  }
  let ids = modifying || reshufflingPrevious ? previousIds.filter((id) => tracks.some((track) => track.id === id) && !excluded.has(id)) : tracks.filter((track) => !excluded.has(track.id)).map((track) => track.id)
  for (const id of namedAdditions) if (!ids.includes(id)) ids.push(id)
  const removalDelta = wantsRemoval && !excluded.size
    ? numberAfterAction(prompt, danceRemovePattern) ?? (!wantsAddition ? requestedCount : undefined) ?? 1
    : 0
  const additionDelta = wantsAddition && !namedAdditions.length
    ? numberAfterAction(prompt, danceAddPattern) ?? (!wantsRemoval ? requestedCount : undefined) ?? 1
    : 0
  if (removalDelta) {
    const removableIds = [...new Set(ids)].sort((a, b) => score(`remove:${a}`) - score(`remove:${b}`))
    const removeCount = Math.min(removalDelta, Math.max(0, removableIds.length - 1))
    const randomlyRemoved = new Set(removableIds.slice(0, removeCount))
    ids = ids.filter((id) => !randomlyRemoved.has(id))
  }
  if (additionDelta) {
    const candidates = tracks.filter((track) => !ids.includes(track.id) && !excluded.has(track.id)).sort((a, b) => score(`add:${a.id}`) - score(`add:${b.id}`))
    ids.push(...candidates.slice(0, additionDelta).map((track) => track.id))
  }
  const ordered = ids.map((id) => tracks.find((track) => track.id === id)).filter((track): track is MusicTrack => Boolean(track))
  if (!modifying || reorderOnly || /(再生成|重新)/.test(prompt)) {
    const shuffled = ordered
      .map((track, index) => ({ track, rank: score(`${track.id}:${index}`) }))
      .sort((a, b) => a.rank - b.rank)
      .map((item) => item.track)
    ordered.splice(0, ordered.length, ...shuffled)
  }
  const shouldChangeOrder = reorderOnly || reshufflingPrevious || (!modifying && previousIds.length > 0)
  if (shouldChangeOrder && ordered.length > 1 && ordered.map((track) => track.id).join(',') === previousIds.join(',')) ordered.push(ordered.shift()!)
  const clipSeconds = (track: MusicTrack) => Math.max(8, (track.chorusEnd ?? ((track.chorusStart ?? 45) + 32)) - (track.chorusStart ?? 45))
  const selected: MusicTrack[] = []
  if (requestedMinutes && ordered.length) {
    const targetSeconds = Math.min(60, Math.max(1, Number(requestedMinutes))) * 60
    let sessionSeconds = 0
    while (sessionSeconds < targetSeconds && selected.length < 120) {
      const track = ordered[selected.length % ordered.length]
      selected.push(track)
      sessionSeconds += clipSeconds(track) + 5
    }
  } else {
    const count = wantsRemoval || wantsAddition ? ordered.length : requestedCount ?? ordered.length
    selected.push(...ordered.slice(0, Math.max(1, Math.min(count, ordered.length))))
  }
  if (!selected.length) return null
  const musicDurationSeconds = selected.reduce((sum, track) => sum + clipSeconds(track), 0)
  const countdownSeconds = selected.length * 5
  const sessionDurationSeconds = musicDurationSeconds + countdownSeconds
  return {
    id: resultId,
    kind: 'training',
    title: requestedMinutes ? `${requestedMinutes} 分钟随舞计划` : `${selected.length} 首随舞计划`,
    summary: `根据当前曲库生成随机歌曲顺序，预计执行 ${timeLabel(sessionDurationSeconds)}，可确认后直接进入随舞模式。`,
    source: 'demo',
    createdAt: now(),
    plan: { mode: 'dance', exerciseIds: [], trackId: selected[0].id, trackIds: selected.map((track) => track.id), musicDurationSeconds, totalMinutes: Math.ceil(sessionDurationSeconds / 60) },
    blocks: [
      { title: '随舞顺序', detail: `${selected.length} 首 · 预计 ${timeLabel(sessionDurationSeconds)}（含倒计时）`, items: selected.map((track, index) => `${String(index + 1).padStart(2, '0')} ${track.title} · ${track.artist} · ${timeLabel(clipSeconds(track))}`) },
      { title: '播放规则', detail: `音乐 ${timeLabel(musicDurationSeconds)} + 倒计时 ${timeLabel(countdownSeconds)}`, items: ['进入随舞页面后自动开始第一首', '每首片段结束后按计划顺序播放下一首', '最后一首结束后停止'] },
      { title: '计划调整', detail: '可以继续和 Agent 对话调整', items: ['说“删除两首歌”会随机移除两首', '说“增加两首歌”会从曲库随机补入两首', '说“还是这几首歌，换个顺序”会保留歌曲并重新排序'] },
    ],
  }
}

function extractMemory(prompt: string): AgentMemory | null {
  if (!/(记住|以后|我喜欢|我不喜欢|不舒服|旧伤|目标是)/.test(prompt)) return null
  const content = prompt.replace(/^(请|帮我)?记住[：:]?\s*/, '').split(/[，,。；;]?然后/)[0].trim()
  const category: AgentMemory['category'] = /(疼|不舒服|旧伤|受伤)/.test(content)
    ? 'body'
    : /(目标|想学|想练)/.test(content)
      ? 'goal'
      : /(每天|每周|习惯|通常)/.test(content)
        ? 'routine'
        : 'preference'
  return { id: uid(), category, content, createdAt: now() }
}

function extractKnowledge(prompt: string): KnowledgeNote | null {
  if (!/(加入知识库|保存为笔记|记到知识库)/.test(prompt)) return null
  const content = prompt.replace(/(请|帮我|把)?(加入知识库|保存为笔记|记到知识库)[：:]?/g, '').trim()
  if (!content) return null
  return { id: uid(), title: content.slice(0, 18), content, tags: keywords(content).slice(0, 3), createdAt: now() }
}

function trainingPlan(prompt: string, context: AgentContext) {
  const requestedMinutes = Number(prompt.match(/(\d{1,2})\s*分钟/)?.[1] ?? 10)
  const minutes = Math.min(30, Math.max(5, requestedMinutes))
  const focus = /手脚|协调/.test(prompt) ? '手脚协调' : /力度|爆发/.test(prompt) ? 'Jazz 力度' : /律动|groove/i.test(prompt) ? 'K-pop 律动' : '基本功控制'
  const bodyWarnings = `${context.memories.filter((item) => item.category === 'body').map((item) => item.content).join(' ')} ${context.settings.knowledge.bodyProfile}`
  const avoidShoulder = /(肩|手臂).*(疼|不舒服|旧伤)|(疼|不舒服|旧伤).*(肩|手臂)/.test(`${bodyWarnings} ${prompt}`)
  const candidates = context.exercises.filter((exercise) => !context.completedIds.includes(exercise.id) && (!avoidShoulder || !['shoulder', 'combo', 'coordination'].includes(exercise.id)))
  const pool = candidates.length ? candidates : context.exercises
  const selected: Exercise[] = []
  let total = 0
  for (const exercise of pool) {
    if (total >= minutes || selected.length >= 6) break
    if (selected.length && total + exercise.minutes > minutes) continue
    selected.push(exercise)
    total += exercise.minutes
  }
  const mode = /(随舞|跳舞|练舞|扒舞|副歌|整支舞|编舞)/.test(prompt) && !/(基本功|分离|isolation|热身)/i.test(prompt) ? 'dance' : 'fundamentals'
  const track = findTrack(prompt, context.tracks)
  const allocation = allocateExerciseMinutes(selected, minutes)
  let cursor = 0
  const timeline = selected.map((exercise) => {
    const start = cursor * 60
    cursor += allocation.exerciseMinutes[exercise.id]
    return `${timeLabel(start)}–${timeLabel(cursor * 60)} ${exercise.name}`
  })
  const resultId = uid()
  const totalMinutes = allocation.totalMinutes
  const musicQueue = mode === 'fundamentals' ? seededTrackQueue(context.tracks, totalMinutes * 60, resultId) : { trackIds: track ? [track.id] : [], durationSeconds: track?.durationSeconds ?? 0 }
  const queuedTracks = musicQueue.trackIds.map((id) => context.tracks.find((item) => item.id === id)).filter(Boolean) as MusicTrack[]
  const result: AssistantResult = {
    id: resultId,
    kind: 'training',
    title: `${totalMinutes} 分钟 ${focus}训练`,
    summary: avoidShoulder ? '已读取身体状态记忆，并避开肩臂负担较大的组合。' : '根据未完成动作和可用时间生成今日训练顺序。',
    source: 'demo',
    createdAt: now(),
    plan: {
      mode,
      exerciseIds: selected.map((exercise) => exercise.id),
      exerciseMinutes: allocation.exerciseMinutes,
      trackId: mode === 'dance' ? track?.id : musicQueue.trackIds[0],
      trackIds: mode === 'fundamentals' ? musicQueue.trackIds : undefined,
      musicDurationSeconds: musicQueue.durationSeconds || undefined,
      totalMinutes,
    },
    blocks: [
      { title: '训练顺序', detail: `${selected.length} 组 · 每组 1–3 分钟`, items: timeline },
      { title: '动作要求', detail: '每组只盯一个质量点', items: selected.slice(0, 4).map((exercise) => `${exercise.name}：${exercise.cue}`) },
      { title: '音乐安排', detail: mode === 'fundamentals' ? `${queuedTracks.length} 首完整歌曲 · 覆盖 ${timeLabel(musicQueue.durationSeconds)}` : track ? `${track.title} · ${track.artist}` : '无指定歌曲', items: mode === 'fundamentals' ? queuedTracks.map((item) => `${item.title} · ${item.artist}（${timeLabel(item.durationSeconds ?? 0)}）`) : track ? [`随舞片段 ${timeLabel(track.chorusStart ?? 45)}–${timeLabel(track.chorusEnd ?? 77)}`, '按计划进入随舞模式'] : ['执行时仅显示动作提示'] },
      { title: '完成标准', detail: '完成质量优先于遍数', items: ['每组连续两遍动作落点稳定', '结束后记录最需要复习的一组动作'] },
    ],
  }
  return { selected, result, minutes: totalMinutes, focus, avoidShoulder }
}

function isPlanningRequest(prompt: string, context: AgentContext) {
  return isDancePlanRequest(prompt, context) || /(安排|制定|生成|创建|修改|更新|恢复|推荐|帮我).*(训练|计划|报告)|(训练|计划).*(安排|生成|制定|更新|推荐)|练什么|\d+\s*分钟.*(训练|基本功)/.test(prompt)
}

function isTrackLibraryFactRequest(prompt: string, tracks: MusicTrack[]) {
  const text = prompt.toLowerCase()
  const namesLibrary = /(曲库|歌单|音乐库)/.test(text)
  const asksQuantity = /(多少|几首|数量|总共|一共)/.test(text)
  const asksList = /(有哪些|有哪|哪几首|列出|都有什么|分别是|歌曲列表|曲目列表)/.test(text)
  const asksReview = /待复习/.test(text) && /(多少|几首|哪些|哪几|歌曲|曲目|歌)/.test(text)
  const asksExistence = /(有没有|是否有|存在吗|在不在|有这首|有.*吗)/.test(text)
  const mentionsTrack = tracks.some((track) => {
    const title = track.title.trim().toLowerCase()
    return title.length >= 2 && text.includes(title)
  })
  return (namesLibrary && (asksQuantity || asksList || asksExistence))
    || asksReview
    || (namesLibrary && mentionsTrack && /[吗么？?]/.test(text))
    || /(多少|几)\s*首\s*(歌|歌曲|曲目)/.test(text)
}

async function localAgent(prompt: string, context: AgentContext): Promise<AgentRunResult> {
  const tools: AgentToolRun[] = []
  const effects: AgentEffect[] = []
  const answers: string[] = []
  const memory = extractMemory(prompt)
  const note = extractKnowledge(prompt)
  const matchedNotes = searchKnowledge(prompt, context.knowledge)
  const restoreDefaultPlan = /恢复默认(的)?今日计划/.test(prompt)
  const planning = isPlanningRequest(prompt, context)
  const asksTracks = isTrackLibraryFactRequest(prompt, context.tracks)
  const asksMemory = /(长期记忆|记得我|我的记忆|记录了我)/.test(prompt)
  const asksKnowledge = /(知识库|知识条目|笔记)/.test(prompt)
  const asksExercises = /(动作库|基本功动作|有哪些动作)/.test(prompt)
  const asksToday = /(今日计划|今天的计划|当前计划|完成记录|完成了|训练上下文)/.test(prompt)

  if (planning || asksToday) tools.push(tool('read_training_context', '读取训练上下文', `今日 ${context.todayIds.length} 项 · 已完成 ${context.completedIds.length} 项`))
  if (planning || asksMemory) tools.push(tool('read_memory', '读取长期记忆', `读取 ${context.memories.length} 条个人记忆`))
  if (planning || asksKnowledge) tools.push(tool('search_knowledge', '检索舞蹈知识库', `知识库共 ${context.knowledge.length} 条 · 命中 ${matchedNotes.length} 条`, context.knowledge.length ? 'done' : 'skipped'))

  if (memory) {
    effects.push({ type: 'save_memory', memory })
    tools.push(tool('save_memory', '写入长期记忆', memory.content))
    answers.push(`已记住：${memory.content}`)
  }
  if (note) {
    effects.push({ type: 'add_knowledge', note })
    tools.push(tool('add_knowledge_note', '写入知识库', note.title))
    answers.push(`已加入知识库：${note.title}`)
  }

  if (restoreDefaultPlan) {
    const defaultIds = ['head', 'chest', 'combo', 'walk', 'groove'].filter((id) => context.exercises.some((exercise) => exercise.id === id))
    effects.push({ type: 'set_today_plan', exerciseIds: defaultIds })
    tools.push(tool('set_today_plan', '恢复默认今日计划', `${defaultIds.length} 个动作`))
    answers.push('默认今日训练计划已恢复。')
  }

  if (!restoreDefaultPlan && planning) {
    if (isDancePlanRequest(prompt, context)) {
      const previousIds = context.latestResult?.plan?.mode === 'dance' ? (context.latestResult.plan.trackIds ?? []) : []
      const wantsRemoval = danceRemovePattern.test(prompt)
      const wantsAddition = danceAddPattern.test(prompt)
      const result = createDancePlan(prompt, context)
      tools.push(tool('search_tracks', '检索本地曲库', `曲库共 ${context.tracks.length} 首`, context.tracks.length ? 'done' : 'skipped'))
      if (result?.plan) {
        tools.push(tool('create_training_report', '生成随舞计划', `${result.plan.trackIds?.length ?? 0} 首歌曲 · 随机顺序`))
        effects.push({ type: 'save_assistant_result', result })
        const nextIds = result.plan.trackIds ?? []
        const removedCount = previousIds.filter((id) => !nextIds.includes(id)).length
        const addedCount = nextIds.filter((id) => !previousIds.includes(id)).length
        const adjustment = [removedCount ? `移除 ${removedCount} 首` : '', addedCount ? `增加 ${addedCount} 首` : ''].filter(Boolean).join('、')
        answers.push((wantsRemoval || wantsAddition) && previousIds.length
          ? `已调整当前随舞计划：${adjustment || '曲库中没有更多可增删的歌曲'}，现在共 ${nextIds.length} 首。确认后会按新计划自动播放。`
          : danceReorderPattern.test(prompt)
            ? `已保留当前随舞计划中的 ${nextIds.length} 首歌曲，只重新调整了播放顺序。确认后会按新顺序自动播放。`
            : `已生成 ${nextIds.length} 首歌曲的随舞计划。确认后会按报告中的顺序自动播放。`)
      } else answers.push('当前曲库没有可播放歌曲，暂时无法生成随舞计划。')
    } else {
      const plan = trainingPlan(prompt, context)
      tools.push(tool('search_exercises', '检索动作库', `找到 ${plan.selected.length} 个适合的动作`))
      const track = findTrack(prompt, context.tracks)
      tools.push(tool('search_tracks', '检索本地曲库', track ? `${track.title} · ${track.artist}` : '曲库暂无歌曲', track ? 'done' : 'skipped'))
      tools.push(tool('set_today_plan', '更新今日计划', plan.selected.map((item) => item.name).join('、')))
      tools.push(tool('create_training_report', '生成训练报告', `${plan.minutes} 分钟 · ${plan.focus}`))
      effects.push({ type: 'set_today_plan', exerciseIds: plan.selected.map((item) => item.id) })
      effects.push({ type: 'save_assistant_result', result: plan.result })
      answers.push(`已结合曲库和训练上下文，把 ${plan.selected.length} 组动作排进今日计划，并生成 ${plan.minutes} 分钟训练报告。${plan.avoidShoulder ? '我根据身体状态记忆避开了肩臂负担较大的动作。' : ''}`)
    }
  }

  if (!planning && asksTracks) {
    const reviewTracks = context.tracks.filter((track) => track.status === 'review')
    tools.push(tool('search_tracks', '检索本地曲库', `曲库共 ${context.tracks.length} 首 · ${reviewTracks.length} 首待复习`, context.tracks.length ? 'done' : 'skipped'))
    const namedTrack = context.tracks.find((track) => prompt.toLowerCase().includes(track.title.toLowerCase()))
    if (namedTrack) answers.push(`有，${namedTrack.title} · ${namedTrack.artist} 在当前曲库中，状态是${namedTrack.status === 'review' ? '待复习' : namedTrack.status === 'remembered' ? '记得' : '新加入'}。`)
    else if (/(有哪些|有哪|列出|歌单)/.test(prompt)) answers.push(context.tracks.length ? `曲库现在有 ${context.tracks.length} 首歌：${context.tracks.map((track) => `${track.title}（${track.artist}）`).join('、')}。其中 ${reviewTracks.length} 首待复习。` : '曲库现在是空的。')
    else answers.push(`曲库现在有 ${context.tracks.length} 首歌，其中 ${reviewTracks.length} 首待复习。`)
  }
  if (!planning && asksToday) {
    const today = context.todayIds.map((id) => context.exercises.find((exercise) => exercise.id === id)).filter(Boolean) as Exercise[]
    const completed = context.completedIds.map((id) => context.exercises.find((exercise) => exercise.id === id)).filter(Boolean) as Exercise[]
    answers.push(`今日计划有 ${today.length} 项：${today.length ? today.map((item) => item.name).join('、') : '暂无'}。目前完成 ${completed.length} 项。`)
  }
  if (!planning && asksMemory) answers.push(context.memories.length ? `当前有 ${context.memories.length} 条长期记忆：${context.memories.map((item) => item.content).join('；')}。` : '当前没有记录任何长期记忆。')
  if (!planning && asksKnowledge) answers.push(context.knowledge.length ? `知识库当前有 ${context.knowledge.length} 条内容：${context.knowledge.map((item) => item.title).join('、')}。` : '知识库当前是空的。')
  if (!planning && asksExercises) {
    tools.push(tool('search_exercises', '检索动作库', `动作库共 ${context.exercises.length} 项`))
    answers.push(`动作库当前有 ${context.exercises.length} 项：${context.exercises.map((item) => item.name).join('、')}。`)
  }
  if (!answers.length && /^(你好|嗨|哈喽|hello|hi|早上好|下午好|晚上好|在吗|谢谢|谢谢你)[！!。,.，\s]*$/i.test(prompt)) answers.push('我在。现在是离线工作台模式，曲库、计划和训练记录仍然可以查询；需要开放式对话时，请稍后重试云端 Agent。')
  if (!answers.length && /^jazz[！!。,.，\s]*$/i.test(prompt)) answers.push('Jazz 舞通常强调节奏切分、身体线条、重心转换和表现力；但它不是单一固定风格，还会分成 Commercial Jazz、Street Jazz、Heels 等方向。现在是离线模式，如果你告诉我想了解哪一种，我可以先按本地基础知识给你一个练习入口。')
  if (!answers.length && /(扒舞|自己学舞|自学.*舞).*(怎么|方法|步骤)|怎么.*(扒舞|自己学舞)/.test(prompt)) answers.push('可以按“看结构、拆八拍、先脚后手、降速连段、原速复盘”来扒：先把视频分成 2 个八拍的小段，标出方向和重心；只练脚下，再加上身和手部；0.5–0.75 倍速连续成功两遍后再接下一段，最后录一遍对照动作落点。')
  if (!answers.length && /(什么风格|风格是什么|属于.*风格)/.test(prompt)) {
    const track = context.tracks.find((item) => prompt.toLowerCase().includes(item.title.toLowerCase()))
    answers.push(track ? `我只能确认 ${track.title} · ${track.artist} 在当前曲库中；曲库没有具体编舞内容，所以我无法判断这支舞的准确舞蹈风格。` : '我没有这支舞的编舞视频或知识库资料，因此无法判断它的准确舞蹈风格。')
  }
  if (!answers.length && /(上周|昨天|之前|历史).*(练了|训练).*(多久|多少)/.test(prompt)) answers.push('我不知道。当前工作台没有记录这段时间的训练时长。')
  if (!answers.length && matchedNotes.length) answers.push(`${matchedNotes[0].title}：${matchedNotes[0].content}`)
  if (!answers.length) answers.push('云端 GPT 暂时没有连接成功，我不会用固定模板假装已经回答。当前工作台数据仍可查询和执行；开放式舞蹈问题请稍后重试。')
  await wait(650)
  return { answer: answers.join('\n'), source: 'local', tools, effects }
}

export async function runDanceAgent(prompt: string, context: AgentContext, history: AgentMessage[]): Promise<AgentRunResult> {
  const endpoint = import.meta.env.VITE_AGENT_PROXY_URL?.trim() || DEFAULT_AGENT_ENDPOINT
  const requestPayload = { prompt, context, history: history.slice(-10) }
  let diagnostic = ''
  if (endpoint) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          cache: 'no-store',
          body: JSON.stringify(requestPayload),
        })
        if (!response.ok) throw new Error(`Agent proxy returned ${response.status}`)
        const payload = await response.json() as AgentRunResult
        if (!payload.answer || !Array.isArray(payload.tools) || !Array.isArray(payload.effects)) throw new Error('Invalid agent result')
        return payload
      } catch (error) {
        diagnostic = error instanceof Error ? error.message : '浏览器网络请求失败'
        console.warn(`Dance Agent cloud request failed on attempt ${attempt + 1}.`, error)
        if (attempt === 0) await wait(700)
      }
    }
    try {
      const fallbackUrl = `${endpoint}?payload=${encodeURIComponent(JSON.stringify(requestPayload))}&_=${Date.now()}`
      const response = await fetch(fallbackUrl, { method: 'GET', cache: 'no-store' })
      if (!response.ok) throw new Error(`Agent GET fallback returned ${response.status}`)
      const payload = await response.json() as AgentRunResult
      if (!payload.answer || !Array.isArray(payload.tools) || !Array.isArray(payload.effects)) throw new Error('Invalid Agent GET result')
      return payload
    } catch (error) {
      diagnostic = error instanceof Error ? error.message : diagnostic || '浏览器网络请求失败'
      console.warn('Dance Agent GET fallback failed.', error)
    }
  }
  const result = await localAgent(prompt, context)
  return { ...result, diagnostic: diagnostic || '云端 Agent 地址不可用' }
}
