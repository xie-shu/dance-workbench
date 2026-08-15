import { createServer } from 'node:http'

const port = Number(process.env.AI_PROXY_PORT || 8787)
const apiKey = process.env.OPENAI_API_KEY
const model = process.env.OPENAI_MODEL || 'gpt-5-mini'
const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '')
const apiMode = process.env.OPENAI_API_MODE || 'responses'
const requestTimeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || 90_000)
const allowedOrigins = new Set((process.env.AI_ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:41733,https://xie-shu.github.io').split(',').map((value) => value.trim()).filter(Boolean))
const hits = new Map()

const agentTools = [
  {
    type: 'function', name: 'read_training_context', description: '读取当前工作台统计、今日计划、完成记录和 Agent 设置。制定计划或回答这些当前事实前必须调用。', strict: true,
    parameters: { type: 'object', additionalProperties: false, required: [], properties: {} },
  },
  {
    type: 'function', name: 'read_memory', description: '读取与当前任务相关的用户长期记忆。', strict: true,
    parameters: { type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string' } } },
  },
  {
    type: 'function', name: 'search_knowledge', description: '检索用户的舞蹈知识库笔记，并返回知识库总数。回答知识库事实前必须调用。', strict: true,
    parameters: { type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string' } } },
  },
  {
    type: 'function', name: 'search_exercises', description: '从基本功动作库检索适合的动作，并返回动作库总数。回答动作库事实前必须调用。', strict: true,
    parameters: { type: 'object', additionalProperties: false, required: ['query', 'limit'], properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 8 } } },
  },
  {
    type: 'function', name: 'search_tracks', description: '检索用户本地曲库，只返回歌曲元数据、曲库精确总数和状态数量。回答曲库数量、歌曲是否存在或歌曲列表前必须调用。', strict: true,
    parameters: { type: 'object', additionalProperties: false, required: ['query', 'status'], properties: { query: { type: 'string' }, status: { type: 'string', enum: ['all', 'review', 'remembered', 'new'] } } },
  },
  {
    type: 'function', name: 'set_today_plan', description: '把指定动作写入用户今天的训练计划。仅在用户要求安排或修改计划时调用。', strict: true,
    parameters: { type: 'object', additionalProperties: false, required: ['exercise_ids'], properties: { exercise_ids: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string' } } } },
  },
  {
    type: 'function', name: 'save_memory', description: '保存用户明确表达的长期偏好、身体状态、目标或习惯。', strict: true,
    parameters: { type: 'object', additionalProperties: false, required: ['content', 'category'], properties: { content: { type: 'string' }, category: { type: 'string', enum: ['preference', 'body', 'goal', 'routine'] } } },
  },
  {
    type: 'function', name: 'add_knowledge_note', description: '在用户明确要求时将舞蹈方法或笔记写入知识库。', strict: true,
    parameters: { type: 'object', additionalProperties: false, required: ['title', 'content', 'tags'], properties: { title: { type: 'string' }, content: { type: 'string' }, tags: { type: 'array', maxItems: 5, items: { type: 'string' } } } },
  },
  {
    type: 'function', name: 'create_training_report', description: '根据已检索到的动作、曲目和上下文生成训练报告并保存。', strict: true,
    parameters: { type: 'object', additionalProperties: false, required: ['minutes', 'focus', 'intensity', 'track_id', 'exercise_ids'], properties: { minutes: { type: 'integer', minimum: 5, maximum: 30 }, focus: { type: 'string', maxLength: 20 }, intensity: { type: 'string', maxLength: 12 }, track_id: { type: 'string' }, exercise_ids: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string' } } } },
  },
]

const toolLabels = {
  read_training_context: '读取训练上下文', read_memory: '读取长期记忆', search_knowledge: '检索舞蹈知识库', search_exercises: '检索动作库', search_tracks: '检索本地曲库',
  set_today_plan: '更新今日计划', save_memory: '写入长期记忆', add_knowledge_note: '写入知识库', create_training_report: '生成训练报告',
}

const agentInstructions = `你是蟹堡王的私人舞蹈工作台 Agent，以训练安排为核心，也可以自然地进行寒暄、基础对话和一般舞蹈知识交流。

事实规则：
1. 涉及当前曲库、歌曲数量或名称、今日计划、完成记录、动作库、长期记忆、知识库或 Agent 设置时，必须先调用对应工具，只能依据本轮工具结果回答。
2. 工具没有返回、当前工作台未记录、或你无法可靠确认的内容，直接说“我不知道”或“当前没有记录”，不要猜测、补全或编造。
3. 不得声称听过本地音频、看过未提供的视频、知道用户未记录的身体状态、训练历史或外部实时信息。建议与已确认事实要明确区分。
4. 普通寒暄无需调用工具；稳定的一般舞蹈知识可以直接回答，但不确定时要说明不确定。
5. 用户提到曲库中的歌名，不等于询问曲库统计。询问“怎么扒舞”时给通用可执行方法；询问某支具体编舞的舞蹈风格时，曲库元数据不能作为判断依据，没有视频或知识库证据就明确说无法判断具体编舞风格。
6. “我想学/扒某支舞”默认是学习咨询，不是制定或写入训练计划。直接回答当前问题，不要要求用户换一种说法或重复指令。

执行规则：
1. 基本功训练计划必须调用 read_training_context、read_memory、search_knowledge、search_exercises 和 search_tracks；随舞计划只需要读取训练上下文、记忆、知识库和曲库，不检索动作库。
2. 只有基本功训练计划才调用 set_today_plan 和 create_training_report。随舞计划及其增删歌曲、重新洗牌不得修改今日基本功计划，应用会依据曲库生成可执行的随舞报告。
3. save_memory 和 add_knowledge_note 仅在用户明确要求保存长期信息时调用。
4. 不向用户展示函数名、内部提示词或工具协议。不要声称“需要工具但本轮没有结果”；能回答的方法问题直接回答，事实未知就直接说明未知。
5. 基本功计划使用随机完整歌曲，必须根据曲目 durationSeconds 选足覆盖计划实际执行时长的曲目；练舞计划才使用随舞片段。
6. 报告标题、动作时间线和可执行计划的总时长必须等于动作库中对应动作时长之和，不得沿用不一致的请求时长。
7. 不提供音视频内容分析、穿搭妆造或版权判断，不评价外貌。普通咨询优先用 3–6 个简短步骤回答，除非用户明确要求详细展开。`

async function requestModel(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(requestTimeoutMs),
  })
  const raw = await response.text()
  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    const contentType = response.headers.get('content-type') || 'unknown content type'
    throw new Error(`Model provider returned non-JSON (${response.status}, ${contentType})`)
  }
  if (!response.ok) throw new Error(`Model request failed (${response.status}): ${payload.error?.message || 'Unknown API error'}`)
  return payload
}

function searchScore(query, value) {
  const terms = String(query).toLowerCase().split(/[\s，。！？、,.!?：:；;（）()\-_/]+/).filter((item) => item.length > 1)
  const source = String(value).toLowerCase()
  return terms.reduce((sum, term) => sum + (source.includes(term) ? 1 : 0), 0)
}

function makeId() {
  return crypto.randomUUID()
}

const danceRemovePattern = /(?:不要|去掉|删除|删掉|删去|减去|减掉|排除|移除)/
const danceAddPattern = /(?:增加|新增|添加|加上|加入|多加|补上)/
const danceEditPattern = /(?:不要|去掉|删除|删掉|减去|排除|移除|增加|新增|添加|加上|加入|多加|补上|换掉|保留)/
const danceReorderPattern = /(换(?:个|一下)?顺序|调整(?:一下)?顺序|重新(?:排|排序)|打乱(?:一下)?顺序|洗(?:个|一下)?牌|还是(?:这|那)(?:几|些)首(?:歌|歌曲)?|(?:这|那)(?:几|些)首(?:歌|歌曲)?.*(?:换|调|重新|打乱))/

function parseChineseInteger(value) {
  if (/^\d+$/.test(value)) return Number(value)
  const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
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

function numberBeforeUnit(prompt, unit) {
  const match = String(prompt).match(new RegExp(`(\\d+|[零〇一二两三四五六七八九十百]+)\\s*${unit}`))
  return match ? parseChineseInteger(match[1]) : undefined
}

function numberAfterAction(prompt, action) {
  const match = String(prompt).match(new RegExp(`${action.source}\\s*(?:随机)?\\s*(\\d+|[零〇一二两三四五六七八九十百]+)\\s*首`))
  return match ? parseChineseInteger(match[1]) : undefined
}

function isPlanningRequest(prompt, context = {}) {
  const text = String(prompt)
  const danceFollowUp = context.latestResult?.plan?.mode === 'dance' && (danceEditPattern.test(text) || danceReorderPattern.test(text) || /(再生成|重新)/.test(text))
  const asksForDance = /(随舞|随机舞蹈)/.test(text) && (
    /(计划|方案|安排|排序|生成|练习|训练|开始|开跳)/.test(text)
    || /(想|要|来|做|练|开始|帮我|给我).*(随舞|随机舞蹈)/.test(text)
    || /\d+\s*分钟.*(随舞|随机舞蹈)/.test(text)
  )
  return danceFollowUp || asksForDance || /(安排|制定|生成|创建|修改|更新|恢复|推荐|帮我).*(训练|计划|报告)|(训练|计划).*(安排|生成|制定|更新|推荐)|练什么|\d+\s*分钟.*(训练|基本功)/.test(text)
}

function planModeForPrompt(prompt, context = {}) {
  const text = String(prompt)
  if (context.latestResult?.plan?.mode === 'dance' && (danceEditPattern.test(text) || danceReorderPattern.test(text) || /(再生成|重新)/.test(text))) return 'dance'
  if (/(基本功|分离|isolation|热身|体能|控制训练)/i.test(text)) return 'fundamentals'
  if (/(随舞|跳舞|练舞|扒舞|副歌|整支舞|编舞|舞蹈练习)/.test(text)) return 'dance'
  return 'fundamentals'
}

function timeLabel(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60)
  return `${minutes}:${String(Math.round(totalSeconds % 60)).padStart(2, '0')}`
}

function seededTrackQueue(tracks, targetSeconds, seed, preferredId) {
  const eligible = (tracks || []).filter((track) => Number.isFinite(track.durationSeconds) && track.durationSeconds > 0)
  const score = (value) => {
    let hash = 2166136261
    for (const character of `${seed}:${value}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
    return hash >>> 0
  }
  const ordered = [...eligible].sort((a, b) => score(a.id) - score(b.id))
  if (preferredId) {
    const preferredIndex = ordered.findIndex((track) => track.id === preferredId)
    if (preferredIndex > 0) ordered.unshift(...ordered.splice(preferredIndex, 1))
  }
  const trackIds = []
  let durationSeconds = 0
  let index = 0
  while (ordered.length && durationSeconds < targetSeconds && index < 100) {
    const track = ordered[index % ordered.length]
    trackIds.push(track.id)
    durationSeconds += track.durationSeconds
    index += 1
  }
  return { trackIds, durationSeconds }
}

function allocateExerciseMinutes(exercises, targetMinutes) {
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

function buildDancePlan(prompt, context, seed) {
  const tracks = (context.tracks || []).filter((track) => track.audioUrl || track.blobKey)
  const previousIds = context.latestResult?.plan?.mode === 'dance' ? (context.latestResult.plan.trackIds || []) : []
  const modifying = previousIds.length > 0 && danceEditPattern.test(prompt)
  const requestedCount = numberBeforeUnit(prompt, '首')
  const requestedMinutes = numberBeforeUnit(prompt, '分钟')
  const reorderOnly = previousIds.length > 0 && danceReorderPattern.test(prompt)
  const reshufflingPrevious = previousIds.length > 0 && (reorderOnly || (/(再生成|重新)/.test(prompt) && !requestedCount && !requestedMinutes))
  const wantsRemoval = previousIds.length > 0 && danceRemovePattern.test(prompt)
  const wantsAddition = previousIds.length > 0 && danceAddPattern.test(prompt)
  const negativeWords = /(不要|去掉|删除|删掉|删去|减去|减掉|排除|移除|不放)/
  const addWords = /(增加|新增|添加|加上|加入|多加|补上|放入|保留|要有)/
  const named = (track) => {
    const index = prompt.toLowerCase().indexOf(String(track.title).toLowerCase())
    if (index < 0) return { mentioned: false, excluded: false, added: false }
    const prefix = prompt.slice(Math.max(0, index - 10), index)
    return { mentioned: true, excluded: negativeWords.test(prefix), added: addWords.test(prefix) }
  }
  const excludedIds = new Set(tracks.filter((track) => named(track).excluded).map((track) => track.id))
  const namedAdditions = tracks.filter((track) => named(track).added && !excludedIds.has(track.id)).map((track) => track.id)
  let ids = modifying || reshufflingPrevious ? previousIds.filter((id) => tracks.some((track) => track.id === id) && !excludedIds.has(id)) : tracks.filter((track) => !excludedIds.has(track.id)).map((track) => track.id)
  for (const id of namedAdditions) if (!ids.includes(id)) ids.push(id)
  const score = (value) => {
    let hash = 2166136261
    for (const character of `${seed}:${value}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
    return hash >>> 0
  }
  const removalDelta = wantsRemoval && !excludedIds.size
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
    const candidates = tracks.filter((track) => !ids.includes(track.id) && !excludedIds.has(track.id)).sort((a, b) => score(`add:${a.id}`) - score(`add:${b.id}`))
    ids.push(...candidates.slice(0, additionDelta).map((track) => track.id))
  }
  const ordered = ids.map((id) => tracks.find((track) => track.id === id)).filter(Boolean)
  if (!modifying || reorderOnly || /(再生成|重新)/.test(prompt)) {
    const shuffled = ordered
      .map((track, index) => ({ track, rank: score(`${track.id}:${index}`) }))
      .sort((a, b) => a.rank - b.rank)
      .map((item) => item.track)
    ordered.splice(0, ordered.length, ...shuffled)
  }
  const previousOrder = previousIds.join(',')
  const shouldChangeOrder = reorderOnly || reshufflingPrevious || (!modifying && previousIds.length > 0)
  if (shouldChangeOrder && ordered.length > 1 && ordered.map((track) => track.id).join(',') === previousOrder) ordered.push(ordered.shift())
  const clipSeconds = (track) => Math.max(8, (track.chorusEnd ?? ((track.chorusStart ?? 45) + 32)) - (track.chorusStart ?? 45))
  const selected = []
  if (requestedMinutes && ordered.length) {
    const targetSeconds = Math.min(60, Math.max(1, Number(requestedMinutes))) * 60
    let sessionSeconds = 0
    while (sessionSeconds < targetSeconds && selected.length < 120) {
      const track = ordered[selected.length % ordered.length]
      selected.push(track)
      sessionSeconds += clipSeconds(track) + 5
    }
  } else {
    const count = wantsRemoval || wantsAddition ? ordered.length : requestedCount || ordered.length
    selected.push(...ordered.slice(0, Math.max(1, Math.min(count, ordered.length))))
  }
  const musicDurationSeconds = selected.reduce((sum, track) => sum + clipSeconds(track), 0)
  const countdownSeconds = selected.length * 5
  return { selected, musicDurationSeconds, countdownSeconds, sessionDurationSeconds: musicDurationSeconds + countdownSeconds, requestedMinutes }
}

function isTrackLibraryFactRequest(prompt, context = {}) {
  const text = String(prompt).toLowerCase()
  const namesLibrary = /(曲库|歌单|音乐库)/.test(text)
  const asksQuantity = /(多少|几首|数量|总共|一共)/.test(text)
  const asksList = /(有哪些|有哪|哪几首|列出|都有什么|分别是|歌曲列表|曲目列表)/.test(text)
  const asksReview = /待复习/.test(text) && /(多少|几首|哪些|哪几|歌曲|曲目|歌)/.test(text)
  const asksExistence = /(有没有|是否有|存在吗|在不在|有这首|有.*吗)/.test(text)
  const mentionsTrack = (context.tracks || []).some((track) => {
    const title = String(track.title || '').trim().toLowerCase()
    return title.length >= 2 && text.includes(title)
  })
  return (namesLibrary && (asksQuantity || asksList || asksExistence))
    || asksReview
    || (namesLibrary && mentionsTrack && /[吗么？?]/.test(text))
    || /(多少|几)\s*首\s*(歌|歌曲|曲目)/.test(text)
}

function callableToolsFor(prompt, context = {}) {
  const text = String(prompt)
  if (isPlanningRequest(text, context)) {
    if (planModeForPrompt(text, context) === 'dance') {
      const danceTools = new Set(['read_training_context', 'read_memory', 'search_knowledge', 'search_tracks'])
      return agentTools.filter((tool) => danceTools.has(tool.name))
    }
    return agentTools
  }
  if (/(记住|以后|我喜欢|我不喜欢|不舒服|旧伤|目标是)/.test(text)) return agentTools.filter((tool) => tool.name === 'save_memory')
  if (/(加入知识库|保存为笔记|记到知识库)/.test(text)) return agentTools.filter((tool) => tool.name === 'add_knowledge_note')
  return []
}

function intentInstruction(prompt) {
  const text = String(prompt)
  if (/(什么风格|风格是什么|属于.*风格)/.test(text)) {
    return '本轮是在询问一支具体编舞的风格。若只有歌曲元数据而没有编舞视频或知识库证据，开门见山说不知道具体编舞风格，并简短说明缺少什么证据；不要转成训练计划。'
  }
  if (/(扒舞|自己学舞|自学.*舞|想.*扒|想.*学.*舞)/i.test(text)) {
    return '本轮是普通的扒舞或自学方法咨询，不是制定训练计划。直接给出针对当前问题的可执行建议；不要提读取上下文、内部工具或工作台规则，不要让用户重复或改写请求。'
  }
  return ''
}

function workspaceFactTool(prompt, context = {}) {
  const text = String(prompt)
  const planning = isPlanningRequest(text, context)
  if (planning) return null
  if (isTrackLibraryFactRequest(text, context)) return 'search_tracks'
  if (/(长期记忆|记得我|我的记忆|记录了我)/.test(text)) return 'read_memory'
  if (/(知识库|知识条目|笔记)/.test(text)) return 'search_knowledge'
  if (/(动作库|基本功动作|有哪些动作)/.test(text)) return 'search_exercises'
  if (/(今日计划|今天的计划|当前计划|完成记录|完成了|Agent 设置|训练上下文)/.test(text)) return 'read_training_context'
  if (/(上周|昨天|之前|历史).*(练|训练)/.test(text)) return 'read_training_context'
  return null
}

function trackMetadata(track) {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    tag: track.tag,
    status: track.status,
    durationSeconds: track.durationSeconds,
    chorusStart: track.chorusStart,
    chorusEnd: track.chorusEnd,
    lastPlayed: track.lastPlayed,
  }
}

function referencedTrackMetadata(prompt, context = {}) {
  const text = String(prompt).toLowerCase()
  return (context.tracks || [])
    .filter((track) => String(track.title || '').length >= 3 && text.includes(String(track.title).toLowerCase()))
    .map(trackMetadata)
}

function addReferencedTrackRun(runs, tracks) {
  if (!tracks.length) return
  runs.push({
    id: makeId(),
    name: 'search_tracks',
    label: toolLabels.search_tracks,
    summary: `匹配到 ${tracks.map((track) => `${track.title} · ${track.artist}`).join('、')}`,
    status: 'done',
  })
}

function executeAgentTool(call, context, effects, runs) {
  const args = JSON.parse(call.arguments || '{}')
  let result
  if (call.name === 'read_training_context') {
    result = {
      counts: {
        tracks: (context.tracks || []).length,
        reviewTracks: (context.tracks || []).filter((track) => track.status === 'review').length,
        exercises: (context.exercises || []).length,
        memories: (context.memories || []).length,
        knowledge: (context.knowledge || []).length,
        todayPlan: (context.todayIds || []).length,
        completed: (context.completedIds || []).length,
      },
      todayPlan: (context.todayIds || []).map((id) => (context.exercises || []).find((exercise) => exercise.id === id)).filter(Boolean),
      completed: (context.completedIds || []).map((id) => (context.exercises || []).find((exercise) => exercise.id === id)).filter(Boolean),
      settings: context.settings || {},
    }
  } else if (call.name === 'read_memory') {
    const matches = [...(context.memories || [])].sort((a, b) => searchScore(args.query, `${b.category} ${b.content}`) - searchScore(args.query, `${a.category} ${a.content}`)).slice(0, 6)
    result = matches
  } else if (call.name === 'search_knowledge') {
    const knowledge = context.knowledge || []
    const matches = knowledge.map((note) => ({ note, score: searchScore(args.query, `${note.title} ${note.content} ${(note.tags || []).join(' ')}`) })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 8).map((item) => item.note)
    result = { totalCount: knowledge.length, matches }
  } else if (call.name === 'search_exercises') {
    const exercises = context.exercises || []
    const matches = exercises.map((exercise) => ({ exercise, score: searchScore(args.query, `${exercise.name} ${exercise.category} ${exercise.cue}`) })).sort((a, b) => b.score - a.score).slice(0, args.limit).map((item) => item.exercise)
    result = { totalCount: exercises.length, matches }
  } else if (call.name === 'search_tracks') {
    const tracks = context.tracks || []
    const pool = args.status === 'all' ? tracks : tracks.filter((track) => track.status === args.status)
    const scored = pool.map((track) => ({ track, score: searchScore(args.query, `${track.title} ${track.artist} ${track.tag}`) })).sort((a, b) => b.score - a.score)
    result = {
      totalCount: tracks.length,
      status: args.status,
      statusCount: pool.length,
      reviewCount: tracks.filter((track) => track.status === 'review').length,
      tracks: scored.slice(0, 50).map((item) => trackMetadata(item.track)),
    }
  } else if (call.name === 'set_today_plan') {
    const validIds = args.exercise_ids.filter((id) => (context.exercises || []).some((exercise) => exercise.id === id))
    effects.push({ type: 'set_today_plan', exerciseIds: validIds })
    result = { updated: true, exerciseIds: validIds }
  } else if (call.name === 'save_memory') {
    const memory = { id: makeId(), category: args.category, content: args.content, createdAt: new Date().toISOString() }
    effects.push({ type: 'save_memory', memory })
    result = memory
  } else if (call.name === 'add_knowledge_note') {
    const note = { id: makeId(), title: args.title, content: args.content, tags: args.tags, createdAt: new Date().toISOString() }
    effects.push({ type: 'add_knowledge', note })
    result = note
  } else if (call.name === 'create_training_report') {
    const exercises = args.exercise_ids.map((id) => (context.exercises || []).find((exercise) => exercise.id === id)).filter(Boolean)
    const track = (context.tracks || []).find((item) => item.id === args.track_id)
    const focus = String(args.focus).slice(0, 20)
    const intensity = String(args.intensity).slice(0, 12)
    let cursor = 0
    const items = exercises.map((exercise) => { const start = cursor; cursor += exercise.minutes; return `${start}:00–${cursor}:00 ${exercise.name}` })
    const totalMinutes = exercises.reduce((sum, exercise) => sum + exercise.minutes, 0)
    const report = { id: makeId(), kind: 'training', title: `${totalMinutes} 分钟 ${focus}训练`, summary: `${intensity}强度，由 Agent 根据曲库、当前进度、记忆和知识库生成。`, source: 'live', createdAt: new Date().toISOString(), plan: { mode: 'fundamentals', exerciseIds: exercises.map((exercise) => exercise.id), trackId: track?.id, totalMinutes }, blocks: [{ title: '训练顺序', detail: `${exercises.length} 组动作`, items }, { title: '动作要求', detail: '每组一个质量点', items: exercises.map((exercise) => `${exercise.name}：${exercise.cue}`) }, { title: '音乐安排', detail: track ? `${track.title} · ${track.artist}` : '未指定歌曲', items: ['执行前校验计划与歌曲时长', '基本功使用完整歌曲'] }, { title: '完成标准', detail: '质量优先于遍数', items: ['每组连续两遍动作落点稳定', '结束后记录最需要复习的一组动作'] }] }
    effects.push({ type: 'save_assistant_result', result: report })
    result = report
  } else {
    result = { error: 'Unknown tool' }
  }
  const count = Array.isArray(result) ? result.length : 1
  const summary = call.name === 'search_tracks'
    ? `曲库共 ${result.totalCount} 首 · ${result.reviewCount} 首待复习`
    : call.name === 'search_knowledge'
      ? `知识库共 ${result.totalCount} 条 · 命中 ${result.matches.length} 条`
      : call.name === 'search_exercises'
        ? `动作库共 ${result.totalCount} 项 · 返回 ${result.matches.length} 项`
        : call.name === 'read_training_context'
          ? `今日 ${result.counts.todayPlan} 项 · 已完成 ${result.counts.completed} 项`
          : Array.isArray(result) ? `返回 ${count} 条结果` : '执行完成'
  runs.push({ id: makeId(), name: call.name, label: toolLabels[call.name] || call.name, summary, status: count ? 'done' : 'skipped' })
  return result
}

function ensureExecutablePlan(input, runs, effects) {
  if (!isPlanningRequest(input.prompt, input.context || {})) return
  const context = input.context || {}
  const mode = planModeForPrompt(input.prompt, context)
  const requestedMinutes = Math.min(30, Math.max(5, Number(String(input.prompt).match(/(\d{1,2})\s*分钟/)?.[1] || 10)))
  if (mode === 'dance') {
    const dance = buildDancePlan(input.prompt, context, makeId())
    if (!dance.selected.length) return
    for (let index = effects.length - 1; index >= 0; index -= 1) {
      if (effects[index].type === 'save_assistant_result' || effects[index].type === 'set_today_plan') effects.splice(index, 1)
    }
    for (let index = runs.length - 1; index >= 0; index -= 1) {
      if (runs[index].name === 'set_today_plan' || runs[index].name === 'search_exercises' || runs[index].name === 'create_training_report') runs.splice(index, 1)
    }
    const planId = makeId()
    const report = {
      id: planId,
      kind: 'training',
      title: dance.requestedMinutes ? `${dance.requestedMinutes} 分钟随舞计划` : `${dance.selected.length} 首随舞计划`,
      summary: `由 Agent 根据当前曲库生成随机歌曲顺序，预计执行 ${timeLabel(dance.sessionDurationSeconds)}，可确认后直接进入随舞模式。`,
      source: 'live',
      createdAt: new Date().toISOString(),
      plan: { mode: 'dance', exerciseIds: [], trackId: dance.selected[0].id, trackIds: dance.selected.map((track) => track.id), musicDurationSeconds: dance.musicDurationSeconds, totalMinutes: Math.ceil(dance.sessionDurationSeconds / 60) },
      blocks: [
        { title: '随舞顺序', detail: `${dance.selected.length} 首 · 预计 ${timeLabel(dance.sessionDurationSeconds)}（含倒计时）`, items: dance.selected.map((track, index) => `${String(index + 1).padStart(2, '0')} ${track.title} · ${track.artist} · ${timeLabel(Math.max(8, (track.chorusEnd ?? ((track.chorusStart ?? 45) + 32)) - (track.chorusStart ?? 45)))}`) },
        { title: '播放规则', detail: `音乐 ${timeLabel(dance.musicDurationSeconds)} + 倒计时 ${timeLabel(dance.countdownSeconds)}`, items: ['进入随舞页面后自动开始第一首', '每首片段结束后按计划顺序倒计时并播放下一首', '最后一首结束后停止，不自动追加曲目'] },
        { title: '计划调整', detail: '可以继续和 Agent 对话调整', items: ['说“删除两首歌”会随机移除两首', '说“增加两首歌”会从曲库随机补入两首', '说“还是这几首歌，换个顺序”会保留歌曲并重新排序'] },
      ],
    }
    effects.push({ type: 'save_assistant_result', result: report })
    runs.push({ id: makeId(), name: 'create_training_report', label: toolLabels.create_training_report, summary: `${dance.selected.length} 首歌曲 · 随机顺序`, status: 'done' })
    return
  }
  const existing = effects.find((effect) => effect.type === 'save_assistant_result' && effect.result?.plan?.exerciseIds?.length)
  if (existing) {
    const planExercises = existing.result.plan.exerciseIds.map((id) => (context.exercises || []).find((exercise) => exercise.id === id)).filter(Boolean)
    const allocation = allocateExerciseMinutes(planExercises, requestedMinutes)
    const totalMinutes = allocation.totalMinutes
    existing.result.plan.mode = mode
    existing.result.plan.exerciseMinutes = allocation.exerciseMinutes
    existing.result.plan.totalMinutes = totalMinutes
    existing.result.title = /^\d+\s*分钟/.test(existing.result.title) ? existing.result.title.replace(/^\d+\s*分钟/, `${totalMinutes} 分钟`) : `${totalMinutes} 分钟 ${existing.result.title}`
    const orderBlock = existing.result.blocks?.find((block) => block.title === '训练顺序')
    if (orderBlock) {
      let cursor = 0
      orderBlock.detail = `${planExercises.length} 组动作 · 共 ${totalMinutes} 分钟`
      orderBlock.items = planExercises.map((exercise) => {
        const start = cursor
        cursor += allocation.exerciseMinutes[exercise.id]
        return `${start}:00–${cursor}:00 ${exercise.name}`
      })
    }
    if (mode === 'fundamentals') {
      const queue = seededTrackQueue(context.tracks, totalMinutes * 60, existing.result.id)
      const queueTracks = queue.trackIds.map((id) => (context.tracks || []).find((track) => track.id === id)).filter(Boolean)
      existing.result.plan.trackId = queue.trackIds[0]
      existing.result.plan.trackIds = queue.trackIds
      existing.result.plan.musicDurationSeconds = queue.durationSeconds
      const musicBlock = existing.result.blocks?.find((block) => block.title === '音乐安排')
      if (musicBlock) {
        musicBlock.detail = `${queueTracks.length} 首完整歌曲 · 覆盖 ${timeLabel(queue.durationSeconds)}`
        musicBlock.items = queueTracks.map((track) => `${track.title} · ${track.artist}（${timeLabel(track.durationSeconds)}）`)
      }
    }
    return
  }
  const plannedIds = effects.find((effect) => effect.type === 'set_today_plan')?.exerciseIds || []
  const fallbackIds = plannedIds.length ? plannedIds : (context.todayIds || [])
  const selected = (fallbackIds.length ? fallbackIds : (context.exercises || []).map((exercise) => exercise.id))
    .map((id) => (context.exercises || []).find((exercise) => exercise.id === id))
    .filter(Boolean)
    .reduce((items, exercise) => {
      const used = items.reduce((sum, item) => sum + item.minutes, 0)
      if (items.length >= 6 || (items.length && used + exercise.minutes > requestedMinutes)) return items
      return [...items, exercise]
    }, [])
  if (!selected.length) return
  const prompt = String(input.prompt).toLowerCase()
  const track = (context.tracks || []).find((item) => prompt.includes(String(item.title || '').toLowerCase()))
    || (context.tracks || []).find((item) => item.status === 'review')
    || (context.tracks || [])[0]
  const allocation = allocateExerciseMinutes(selected, requestedMinutes)
  const totalMinutes = allocation.totalMinutes
  const focus = /手脚|协调/.test(prompt) ? '手脚协调' : /力度|爆发/.test(prompt) ? 'Jazz 力度' : /律动|groove/i.test(prompt) ? 'K-pop 律动' : '基本功控制'
  let cursor = 0
  const timeline = selected.map((exercise) => {
    const start = cursor
    cursor += allocation.exerciseMinutes[exercise.id]
    return `${start}:00–${cursor}:00 ${exercise.name}`
  })
  const reportId = makeId()
  const musicQueue = mode === 'fundamentals' ? seededTrackQueue(context.tracks, totalMinutes * 60, reportId) : { trackIds: track ? [track.id] : [], durationSeconds: track?.durationSeconds || 0 }
  const queuedTracks = musicQueue.trackIds.map((id) => (context.tracks || []).find((item) => item.id === id)).filter(Boolean)
  const report = {
    id: reportId,
    kind: 'training',
    title: `${totalMinutes} 分钟 ${focus}训练`,
    summary: '由 Agent 根据当前动作、曲库和训练上下文生成，可直接开始执行。',
    source: 'live',
    createdAt: new Date().toISOString(),
    plan: { mode, exerciseIds: selected.map((exercise) => exercise.id), exerciseMinutes: allocation.exerciseMinutes, trackId: mode === 'dance' ? track?.id : musicQueue.trackIds[0], trackIds: mode === 'fundamentals' ? musicQueue.trackIds : undefined, musicDurationSeconds: musicQueue.durationSeconds || undefined, totalMinutes },
    blocks: [
      { title: '训练顺序', detail: `${selected.length} 组动作`, items: timeline },
      { title: '动作要求', detail: '每组一个质量点', items: selected.map((exercise) => `${exercise.name}：${exercise.cue}`) },
      { title: '音乐安排', detail: mode === 'fundamentals' ? `${queuedTracks.length} 首完整歌曲 · 覆盖 ${timeLabel(musicQueue.durationSeconds)}` : track ? `${track.title} · ${track.artist}` : '未指定歌曲', items: mode === 'fundamentals' ? queuedTracks.map((item) => `${item.title} · ${item.artist}（${timeLabel(item.durationSeconds)}）`) : track ? ['执行计划时进入随舞模式', '使用已设置的随舞片段'] : ['执行时仅显示动作与倒计时'] },
      { title: '完成标准', detail: '质量优先于遍数', items: ['每组跟随提示完成规定时间', '完成后自动记录本轮动作'] },
    ],
  }
  if (!plannedIds.length) {
    effects.push({ type: 'set_today_plan', exerciseIds: report.plan.exerciseIds })
    runs.push({ id: makeId(), name: 'set_today_plan', label: toolLabels.set_today_plan, summary: `${selected.length} 组动作`, status: 'done' })
  }
  effects.push({ type: 'save_assistant_result', result: report })
  if (!runs.some((run) => run.name === 'create_training_report')) runs.push({ id: makeId(), name: 'create_training_report', label: toolLabels.create_training_report, summary: `${totalMinutes} 分钟 · 可直接执行`, status: 'done' })
}

function finishAgentRun(input, answer, source, runs, effects) {
  ensureExecutablePlan(input, runs, effects)
  const report = effects.find((effect) => effect.type === 'save_assistant_result' && effect.result?.plan)?.result
  if (!report?.plan || !isPlanningRequest(input.prompt, input.context || {})) return { answer, source, tools: runs, effects }
  if (report.plan.mode === 'dance') {
    const trackCount = report.plan.trackIds?.length || 0
    const sessionSeconds = (report.plan.musicDurationSeconds || 0) + trackCount * 5
    const reorderedSameTracks = input.context?.latestResult?.plan?.mode === 'dance' && danceReorderPattern.test(String(input.prompt))
    const previousIds = input.context?.latestResult?.plan?.mode === 'dance' ? (input.context.latestResult.plan.trackIds || []) : []
    const nextIds = report.plan.trackIds || []
    const removedCount = previousIds.filter((id) => !nextIds.includes(id)).length
    const addedCount = nextIds.filter((id) => !previousIds.includes(id)).length
    const adjustsTracks = previousIds.length && (danceRemovePattern.test(String(input.prompt)) || danceAddPattern.test(String(input.prompt)))
    const adjustment = [removedCount ? `移除 ${removedCount} 首` : '', addedCount ? `增加 ${addedCount} 首` : ''].filter(Boolean).join('、')
    const answer = adjustsTracks
      ? `已调整当前随舞计划：${adjustment || '曲库中没有更多可增删的歌曲'}，现在共 ${trackCount} 首。预计 ${timeLabel(sessionSeconds)}（已计入倒计时），确认后会按新计划播放。`
      : reorderedSameTracks
        ? `已保留当前随舞计划中的 ${trackCount} 首歌曲，只重新调整了播放顺序。预计 ${timeLabel(sessionSeconds)}（已计入每首前 5 秒倒计时），确认后会按新顺序播放。`
        : `已生成 ${trackCount} 首歌曲的随舞计划，预计 ${timeLabel(sessionSeconds)}（已计入每首前 5 秒倒计时）。确认后会进入随舞页面，并按报告中的顺序播放。`
    return { answer, source, tools: runs, effects }
  }
  const requestedMinutes = Number(String(input.prompt).match(/(\d{1,2})\s*分钟/)?.[1] || report.plan.totalMinutes)
  const durationNote = requestedMinutes === report.plan.totalMinutes
    ? `计划时长已按动作逐项核对为 ${report.plan.totalMinutes} 分钟。`
    : `当前动作组合最多可执行 ${report.plan.totalMinutes} 分钟，报告和计时器均按这个实际时长运行。`
  const musicNote = report.plan.mode === 'fundamentals'
    ? `已随机安排 ${report.plan.trackIds?.length || 0} 首完整歌曲，共覆盖 ${timeLabel(report.plan.musicDurationSeconds || 0)}。`
    : '确认后会进入随舞模式播放计划歌曲。'
  return { answer: `${durationNote}${musicNote}`, source, tools: runs, effects }
}

async function runAgentResponses(input) {
  const effects = []
  const runs = []
  const referencedTracks = referencedTrackMetadata(input.prompt, input.context)
  const callableTools = callableToolsFor(input.prompt, input.context || {})
  const intent = intentInstruction(input.prompt)
  addReferencedTrackRun(runs, referencedTracks)
  const history = (input.history || []).slice(-8).map((message) => `${message.role === 'user' ? '用户' : 'Agent'}：${message.content}`).join('\n')
  const request = {
    model,
    instructions: agentInstructions,
    input: `${history ? `最近对话：\n${history}\n\n` : ''}${referencedTracks.length ? `本轮从曲库匹配到的元数据（不是音频或编舞分析）：${JSON.stringify(referencedTracks)}\n\n` : ''}${intent ? `本轮回答约束：${intent}\n\n` : ''}用户当前任务：${input.prompt}`,
  }
  if (callableTools.length) Object.assign(request, { tools: callableTools, tool_choice: 'auto' })
  let payload = await requestModel('/responses', request)
  for (let round = 0; round < 6; round += 1) {
    const calls = (payload.output || []).filter((item) => item.type === 'function_call')
    if (!calls.length) return finishAgentRun(input, outputText(payload) || '任务已完成。', 'live', runs, effects)
    const outputs = calls.map((call) => ({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(executeAgentTool(call, input.context || {}, effects, runs)) }))
    payload = await requestModel('/responses', { model, previous_response_id: payload.id, input: outputs, tools: callableTools })
  }
  return finishAgentRun(input, outputText(payload) || '工具执行已达到本轮上限，请把任务拆成两步继续。', 'live', runs, effects)
}

async function runAgentChatCompletions(input) {
  const effects = []
  const runs = []
  const referencedTracks = referencedTrackMetadata(input.prompt, input.context)
  const callableTools = callableToolsFor(input.prompt, input.context || {})
  const intent = intentInstruction(input.prompt)
  addReferencedTrackRun(runs, referencedTracks)
  const messages = [
    { role: 'system', content: agentInstructions },
    ...(referencedTracks.length ? [{ role: 'system', content: `本轮从本地曲库匹配到以下元数据：${JSON.stringify(referencedTracks)}。这些数据不能证明歌曲音频或具体编舞风格。` }] : []),
    ...(intent ? [{ role: 'system', content: intent }] : []),
    ...(input.history || []).slice(-8).map((message) => ({ role: message.role === 'user' ? 'user' : 'assistant', content: message.content })),
    { role: 'user', content: input.prompt },
  ]
  let finalAnswer = ''
  for (let round = 0; round < 6; round += 1) {
    const request = { model, messages }
    if (callableTools.length) Object.assign(request, { tools: callableTools.map(({ type, ...definition }) => ({ type, function: definition })), tool_choice: 'auto' })
    const payload = await requestModel('/chat/completions', request)
    const message = payload.choices?.[0]?.message
    if (!message) throw new Error('Model returned no chat message')
    const calls = message.tool_calls || []
    finalAnswer = typeof message.content === 'string' ? message.content : ''
    if (!calls.length) return finishAgentRun(input, finalAnswer || '任务已完成。', 'live', runs, effects)
    messages.push(message)
    for (const call of calls) {
      const functionCall = call.function || {}
      const result = executeAgentTool({ name: functionCall.name, arguments: functionCall.arguments }, input.context || {}, effects, runs)
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) })
    }
  }
  return finishAgentRun(input, finalAnswer || '工具执行已达到本轮上限，请把任务拆成两步继续。', 'live', runs, effects)
}

function runWorkspaceFact(input, toolName) {
  const context = input.context || {}
  const runs = []
  const effects = []
  const prompt = String(input.prompt || '')
  let answer

  if (toolName === 'search_tracks') {
    const status = /待复习/.test(prompt) ? 'review' : 'all'
    const result = executeAgentTool({ name: toolName, arguments: JSON.stringify({ query: prompt, status }) }, context, effects, runs)
    const mentioned = (context.tracks || []).find((track) => prompt.toLowerCase().includes(String(track.title).toLowerCase()))
    const asksExistence = /(有|有没有|存在|在不在).*(吗|么|曲库|歌单)/.test(prompt)
    const asksList = /(有哪些|有哪|列出|歌单|分别是|都有什么)/.test(prompt)
    if (mentioned && asksExistence) {
      const statusLabel = mentioned.status === 'review' ? '待复习' : mentioned.status === 'remembered' ? '记得' : '新加入'
      answer = `有，${mentioned.title} · ${mentioned.artist} 在当前曲库中，状态是${statusLabel}。`
    } else if (asksExistence && !mentioned) {
      answer = '当前曲库中没有找到你问的这首歌。'
    } else if (asksList) {
      answer = result.totalCount
        ? status === 'review'
          ? `待复习歌曲有 ${result.statusCount} 首：${result.tracks.map((track) => `${track.title}（${track.artist}）`).join('、')}。曲库总计 ${result.totalCount} 首。`
          : `曲库现在有 ${result.totalCount} 首歌：${result.tracks.map((track) => `${track.title}（${track.artist}）`).join('、')}。其中 ${result.reviewCount} 首待复习。`
        : '曲库现在是空的。'
    } else {
      answer = `曲库现在有 ${result.totalCount} 首歌，其中 ${result.reviewCount} 首待复习。`
    }
  } else if (toolName === 'read_memory') {
    const result = executeAgentTool({ name: toolName, arguments: JSON.stringify({ query: prompt }) }, context, effects, runs)
    answer = result.length ? `当前有 ${result.length} 条长期记忆：${result.map((item) => item.content).join('；')}。` : '当前没有记录任何长期记忆。'
  } else if (toolName === 'search_knowledge') {
    const result = executeAgentTool({ name: toolName, arguments: JSON.stringify({ query: prompt }) }, context, effects, runs)
    const knowledge = context.knowledge || []
    answer = result.totalCount ? `知识库当前有 ${result.totalCount} 条内容：${knowledge.map((item) => item.title).join('、')}。` : '知识库当前是空的。'
  } else if (toolName === 'search_exercises') {
    const result = executeAgentTool({ name: toolName, arguments: JSON.stringify({ query: prompt, limit: 8 }) }, context, effects, runs)
    answer = result.totalCount ? `动作库当前有 ${result.totalCount} 项：${(context.exercises || []).map((item) => item.name).join('、')}。` : '动作库当前是空的。'
  } else {
    const result = executeAgentTool({ name: 'read_training_context', arguments: '{}' }, context, effects, runs)
    if (/(上周|昨天|之前|历史)/.test(prompt)) {
      answer = '我不知道。当前工作台没有这段时间的训练历史记录。'
    } else {
      const todayNames = result.todayPlan.map((item) => item.name)
      answer = `今日计划有 ${result.counts.todayPlan} 项${todayNames.length ? `：${todayNames.join('、')}` : ''}，目前完成 ${result.counts.completed} 项。`
    }
  }
  return { answer, source: 'tool', tools: runs, effects }
}

function runAgent(input) {
  const factTool = workspaceFactTool(input.prompt, input.context)
  if (factTool) return runWorkspaceFact(input, factTool)
  return apiMode === 'chat-completions' ? runAgentChatCompletions(input) : runAgentResponses(input)
}

function send(response, status, payload, origin) {
  if (origin && allowedOrigins.has(origin)) response.setHeader('Access-Control-Allow-Origin', origin)
  response.setHeader('Vary', 'Origin')
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.statusCode = status
  response.end(JSON.stringify(payload))
}

function outputText(payload) {
  if (typeof payload.output_text === 'string') return payload.output_text
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (content.type === 'output_text' && typeof content.text === 'string') return content.text
    }
  }
  return ''
}

createServer(async (request, response) => {
  const origin = request.headers.origin || ''
  if (request.method === 'OPTIONS') {
    if (allowedOrigins.has(origin)) {
      response.setHeader('Access-Control-Allow-Origin', origin)
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    }
    response.statusCode = 204
    response.end()
    return
  }
  if (request.method !== 'POST' || request.url !== '/api/agent') return send(response, 404, { error: 'Not found' }, origin)
  if (origin && !allowedOrigins.has(origin)) return send(response, 403, { error: 'Origin not allowed' }, origin)
  if (!apiKey) return send(response, 503, { error: 'OPENAI_API_KEY is not configured' }, origin)

  const client = request.socket.remoteAddress || 'unknown'
  const now = Date.now()
  const recent = (hits.get(client) || []).filter((time) => now - time < 60_000)
  if (recent.length >= 20) return send(response, 429, { error: 'Too many requests' }, origin)
  recent.push(now)
  hits.set(client, recent)

  let raw = ''
  for await (const chunk of request) {
    raw += chunk
    if (raw.length > 1_000_000) return send(response, 413, { error: 'Request too large' }, origin)
  }

  let input
  try {
    input = JSON.parse(raw)
  } catch {
    return send(response, 400, { error: 'Invalid JSON request' }, origin)
  }

  try {
    return send(response, 200, await runAgent(input), origin)
  } catch (error) {
    console.error('Dance API request failed:', error instanceof Error ? error.message : 'Unknown error')
    return send(response, 502, { error: 'AI provider request failed' }, origin)
  }
}).listen(port, () => {
  console.log(`Dance AI proxy listening on http://localhost:${port}`)
})
