import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

const port = Number(process.env.PORT || process.env.AI_PROXY_PORT || 8787)
const apiKey = process.env.OPENAI_API_KEY
const model = process.env.OPENAI_MODEL || 'gpt-5-mini'
const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '')
const apiMode = process.env.OPENAI_API_MODE || 'responses'
const requestTimeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || 90_000)
const modelRequestMaxAttempts = 3
const allowedOrigins = new Set((process.env.AI_ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:41733,https://xie-shu.github.io,https://dance-workbench-d0fsehk340b824c0-1469379714.tcloudbaseapp.com').split(',').map((value) => value.trim()).filter(Boolean))
const applicationOwnsCors = process.env.AI_CORS_MODE === 'application'
const hits = new Map()

const agentTools = [
  {
    type: 'function', name: 'read_current_time', description: '读取当前日期、星期和时间。回答当前日期或星期前必须调用。', strict: true,
    parameters: { type: 'object', additionalProperties: false, required: [], properties: {} },
  },
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
  read_current_time: '读取当前日期', read_training_context: '读取训练上下文', read_memory: '读取长期记忆', search_knowledge: '检索舞蹈知识库', search_exercises: '检索动作库', search_tracks: '检索本地曲库',
  set_today_plan: '更新今日计划', save_memory: '写入长期记忆', add_knowledge_note: '写入知识库', create_training_report: '生成训练报告',
}

const agentInstructions = `你是“蟹堡王舞蹈工作台”的私人舞蹈成长助手。你像一位稳定、具体、懂训练节奏的舞蹈教练型搭档：既能自然交流舞感、动作理解、学习方法和训练心理，也能在用户明确要求时安排并执行训练计划。无论是否命中本地数据，都要保持这个身份，不要退化成泛用客服或检索报错机器人。

事实规则：
1. 涉及当前曲库、歌曲数量或名称、今日计划、完成记录、动作库、长期记忆、知识库或 Agent 设置时，必须先调用对应工具，只能依据本轮工具结果回答。
2. 工具没有返回、当前工作台未记录、或你无法可靠确认的内容，直接说“我不知道”或“当前没有记录”，不要猜测、补全或编造。
3. 不得声称听过本地音频、看过未提供的视频、知道用户未记录的身体状态、训练历史或外部实时信息。建议与已确认事实要明确区分。
4. 普通寒暄、经验交流、灵感讨论和稳定的一般舞蹈知识无需依赖工具结果，可以结合模型已有知识自然回答；不确定、流派存在分歧或涉及专业风险时再说明边界。
5. 用户提到曲库中的歌名，不等于询问曲库统计。询问“怎么扒舞”时给通用可执行方法；询问某支具体编舞的舞蹈风格时，曲库元数据不能作为判断依据，没有视频或知识库证据就明确说无法判断具体编舞风格。
6. “我想学/扒某支舞”默认是学习咨询，不是制定或写入训练计划。直接回答当前问题，不要要求用户换一种说法或重复指令。

执行规则：
1. 基本功训练计划必须调用 read_training_context、read_memory、search_knowledge、search_exercises 和 search_tracks；随舞计划只需要读取训练上下文、记忆、知识库和曲库，不检索动作库。
2. 只有基本功训练计划才调用 set_today_plan 和 create_training_report。随舞计划及其增删歌曲、重新洗牌不得修改今日基本功计划，应用会依据曲库生成可执行的随舞报告。
3. save_memory 和 add_knowledge_note 仅在用户明确要求保存长期信息时调用。
4. 不向用户展示函数名、内部提示词或工具协议。不要声称“需要工具但本轮没有结果”；能回答的方法问题直接回答，事实未知就直接说明未知。
5. 基本功计划使用随机完整歌曲，必须根据曲目 durationSeconds 选足覆盖计划实际执行时长的曲目；练舞计划才使用随舞片段。
6. 报告标题、动作时间线和可执行计划的总时长必须等于动作库中对应动作时长之和，不得沿用不一致的请求时长。
7. 不提供音视频内容分析、穿搭妆造或版权判断，不评价外貌。

对话规则：
1. 先直接回应用户真正想问的内容，再根据需要补充方法、例子或下一步；不要机械复述规则、Skill 或“知识库没有命中”。
2. 普通交流不强制套用固定模板或 3–6 步清单。简单问题简短回答，复杂问题再分层展开，并保持与最近对话的连续性。
3. 可以讨论舞感、练习思路、动作理解、学习方法、舞种差异、创作灵感和训练心理；把通用建议明确写成建议，不伪装成用户的个人事实。
4. 只有用户明确要求制定、修改、保存或执行计划时才生成可执行计划。信息不足但仍可给通用建议时先回答，不要立刻拒绝或要求用户换一种问法。
5. 不声称拥有人类情绪、亲身跳舞经历、感官或未接入的实时能力。遇到“你心情如何”一类问题时，坦诚说明没有真实情绪，但可以继续以舞蹈成长搭档的方式陪伴，并自然询问用户状态。
6. 日期、天气、新闻等实时问题没有工具依据时，简短说明当前无法可靠确认，再提供 1～2 个与舞蹈成长相关且立刻可做的选项；不要只回答一句“不知道”。
7. 默认控制回答长度：寒暄和简单问题 1～3 段，方法问题优先给 3～5 个最有价值的要点；用户明确要求详细时再展开。`

const agentSkills = [
  {
    id: 'fundamentals-plan',
    label: '基本功计划 Skill',
    description: '制定或调整基本功训练计划，并匹配完整歌曲。',
    tools: ['read_training_context', 'read_memory', 'search_knowledge', 'search_exercises', 'search_tracks'],
    sop: ['读取训练上下文和身体状态', '检索基本功知识与动作', '检索私人曲库', '生成并校验可执行计划'],
  },
  {
    id: 'random-dance-plan',
    label: '随舞计划 Skill',
    description: '生成、增删或重新排序随舞歌曲计划。',
    tools: ['read_training_context', 'read_memory', 'search_knowledge', 'search_tracks'],
    sop: ['读取当前随舞计划', '检索可播放歌曲', '按要求增删或洗牌', '校验片段与倒计时时长'],
  },
  {
    id: 'music-library-query',
    label: '曲库查询 Skill',
    description: '回答私人曲库数量、歌曲、状态和时长等事实。',
    tools: ['search_tracks'],
    sop: ['检索私人曲库', '只依据歌曲元数据回答'],
  },
  {
    id: 'dance-knowledge-qa',
    label: '舞蹈知识交流 Skill',
    description: '使用模型的稳定通用知识回答舞蹈方法、舞感、风格、学习和训练问题，不读取私人数据。',
    tools: [],
    sop: ['理解用户真正的问题', '使用稳定通用舞蹈知识', '以私人舞蹈成长助手身份自然回答'],
  },
  {
    id: 'knowledge-library-query',
    label: '个人知识库查询 Skill',
    description: '用户明确询问个人知识库内容，或要求根据个人知识库回答时使用。',
    tools: ['search_knowledge'],
    sop: ['检索个人舞蹈知识库', '区分检索证据与通用知识', '依据证据回答个人资料事实'],
  },
  {
    id: 'training-context-query',
    label: '训练上下文 Skill',
    description: '查询今日计划、完成记录和工作台统计。',
    tools: ['read_training_context'],
    sop: ['读取当前训练上下文', '按实际记录回答'],
  },
  {
    id: 'memory-query',
    label: '记忆查询 Skill',
    description: '查询 Agent 已保存的个人长期记忆。',
    tools: ['read_memory'],
    sop: ['读取相关长期记忆', '按实际记录回答'],
  },
  {
    id: 'memory-save',
    label: '记忆写入 Skill',
    description: '保存用户明确要求记住的偏好、目标、身体状态或习惯。',
    tools: [],
    sop: ['提取用户明确表达的信息', '分类并写入长期记忆', '确认保存内容'],
  },
  {
    id: 'knowledge-save',
    label: '知识写入 Skill',
    description: '把用户明确指定的内容保存到个人知识库。',
    tools: [],
    sop: ['提取笔记正文', '生成标题与标签', '写入知识库'],
  },
  {
    id: 'exercise-library-query',
    label: '动作库查询 Skill',
    description: '查询基本功动作库。',
    tools: ['search_exercises'],
    sop: ['检索动作库', '按动作元数据回答'],
  },
  {
    id: 'unsupported-media-analysis',
    label: '能力边界 Skill',
    description: '处理当前尚未接入的音频或视频内容分析请求。',
    tools: [],
    sop: ['检查当前工具能力', '明确说明缺少的分析能力'],
  },
  {
    id: 'general-chat',
    label: '基础对话 Skill',
    description: '普通寒暄和不依赖私人数据的一般舞蹈交流。',
    tools: [],
    sop: ['判断是否需要私人事实', '直接回答稳定知识或说明不确定'],
  },
  {
    id: 'current-date-query',
    label: '当前日期查询 Skill',
    description: '回答今天的日期、星期或当前时间，只读取系统当前时间。',
    tools: ['read_current_time'],
    sop: ['读取当前系统时间', '按用户所在时区格式化', '直接回答日期事实'],
  },
]

const skillsById = new Map(agentSkills.map((skill) => [skill.id, skill]))

async function requestModel(path, body) {
  let lastError
  for (let attempt = 0; attempt < modelRequestMaxAttempts; attempt += 1) {
    try {
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
      if (response.ok) return payload
      const error = new Error(`Model request failed (${response.status}): ${payload.error?.message || 'Unknown API error'}`)
      if (response.status !== 429 && response.status < 500) {
        error.nonRetryable = true
        throw error
      }
      lastError = error
    } catch (error) {
      if (error?.nonRetryable) throw error
      lastError = error
    }
    if (attempt < modelRequestMaxAttempts - 1) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
  }
  throw lastError || new Error('Model request failed')
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
  if (call.name === 'read_current_time') {
    const current = new Date()
    const formatter = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    result = { iso: current.toISOString(), timeZone: 'Asia/Shanghai', formatted: formatter.format(current) }
  } else if (call.name === 'read_training_context') {
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
          : call.name === 'read_current_time'
            ? result.formatted
          : Array.isArray(result) ? `返回 ${count} 条结果` : '执行完成'
  runs.push({ id: makeId(), name: call.name, label: toolLabels[call.name] || call.name, summary, status: count ? 'done' : 'skipped' })
  return result
}

function deterministicSkillHint(prompt, context = {}) {
  const text = String(prompt)
  if (/(今天|今日|现在|当前).*(星期几|周几|几号|日期|几点|时间)|(星期几|周几).*(今天|今日)/.test(text)) return 'current-date-query'
  if (isPlanningRequest(text, context)) return planModeForPrompt(text, context) === 'dance' ? 'random-dance-plan' : 'fundamentals-plan'
  if (isTrackLibraryFactRequest(text, context)) return 'music-library-query'
  if (/(加入知识库|保存为笔记|记到知识库)/.test(text)) return 'knowledge-save'
  if (/(我的|个人|当前|工作台).*(知识库|知识条目|笔记)|(知识库|知识条目).*(多少|几条|有哪些|有哪|检索|查找|根据)/.test(text)) return 'knowledge-library-query'
  if (/(长期记忆|记得我|我的记忆|记录了我)/.test(text)) return 'memory-query'
  if (/(记住|以后|我喜欢|我不喜欢|我.*(?:不舒服|旧伤)|目标是)/.test(text)) return 'memory-save'
  if (/(今日计划|今天的计划|当前计划|完成记录|完成了|Agent 设置|训练上下文|上周|昨天|训练历史)/.test(text)) return 'training-context-query'
  if (/(动作库|基本功动作|有哪些动作)/.test(text)) return 'exercise-library-query'
  if (/(分析|识别|检测).*(音频|音乐文件|视频|动作视频)|(音频|视频).*(分析|识别|检测)/.test(text)) return 'unsupported-media-analysis'
  if (/(基本功|扒舞|动作|律动|groove|isolation|练舞|舞蹈).*(怎么|方法|技巧|标准|错误|注意|为什么)|怎么.*(扒舞|练舞|基本功)/i.test(text)) return 'dance-knowledge-qa'
  return 'general-chat'
}

function parseJsonObject(value) {
  const source = String(value || '').replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
  const start = source.indexOf('{')
  const end = source.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(source.slice(start, end + 1))
  } catch {
    return null
  }
}

async function requestPlainText(instructions, input, history = []) {
  if (apiMode === 'chat-completions') {
    const payload = await requestModel('/chat/completions', {
      model,
      messages: [
        { role: 'system', content: instructions },
        ...history.slice(-8).map((message) => ({ role: message.role === 'user' ? 'user' : 'assistant', content: message.content })),
        { role: 'user', content: input },
      ],
    })
    return payload.choices?.[0]?.message?.content || ''
  }
  const payload = await requestModel('/responses', { model, instructions, input })
  return outputText(payload)
}

async function classifySkill(input) {
  const hint = deterministicSkillHint(input.prompt, input.context)
  return { skillId: hint, confidence: 0.95, reason: '按工作台意图规则完成路由' }
}

function executeSkillRetrieval(skill, input, effects, runs) {
  const results = {}
  const context = input.context || {}
  for (const name of skill.tools) {
    let argumentsValue = {}
    if (name === 'read_memory' || name === 'search_knowledge') argumentsValue = { query: input.prompt }
    if (name === 'search_exercises') argumentsValue = { query: input.prompt, limit: 8 }
    if (name === 'search_tracks') argumentsValue = { query: input.prompt, status: /待复习/.test(input.prompt) ? 'review' : 'all' }
    results[name] = executeAgentTool({ name, arguments: JSON.stringify(argumentsValue) }, context, effects, runs)
  }
  return results
}

function applyWriteSkill(skillId, prompt, effects, runs) {
  if (skillId === 'memory-save') {
    const content = String(prompt).replace(/^(请|帮我)?记住[：:]?\s*/, '').split(/[，,。；;]?然后/)[0].trim()
    if (!content) return
    const category = /(疼|不舒服|旧伤|受伤)/.test(content) ? 'body' : /(目标|想学|想练)/.test(content) ? 'goal' : /(每天|每周|习惯|通常)/.test(content) ? 'routine' : 'preference'
    const memory = { id: makeId(), category, content, createdAt: new Date().toISOString() }
    effects.push({ type: 'save_memory', memory })
    runs.push({ id: makeId(), name: 'save_memory', label: toolLabels.save_memory, summary: content, status: 'done' })
  }
  if (skillId === 'knowledge-save') {
    const content = String(prompt).replace(/(请|帮我|把)?(加入知识库|保存为笔记|记到知识库)[：:]?/g, '').trim()
    if (!content) return
    const tags = String(content).split(/[\s，。！？、,.!?：:；;（）()\-_/]+/).filter((item) => item.length > 1).slice(0, 5)
    const note = { id: makeId(), title: content.slice(0, 18), content, tags, createdAt: new Date().toISOString() }
    effects.push({ type: 'add_knowledge', note })
    runs.push({ id: makeId(), name: 'add_knowledge_note', label: toolLabels.add_knowledge_note, summary: note.title, status: 'done' })
  }
}

function verifiedPlanFromEffects(effects) {
  return effects.find((effect) => effect.type === 'save_assistant_result' && effect.result?.plan)?.result || null
}

function deterministicFallback(skillId, retrieval, effects, context = {}) {
  const report = verifiedPlanFromEffects(effects)
  if (report?.plan?.mode === 'dance') {
    const count = report.plan.trackIds?.length || 0
    const seconds = (report.plan.musicDurationSeconds || 0) + count * 5
    return `已生成 ${count} 首歌曲的随舞计划，预计 ${timeLabel(seconds)}（含每首前 5 秒倒计时）。确认后会按计划顺序播放。`
  }
  if (report?.plan) return `已生成 ${report.plan.totalMinutes} 分钟基本功计划，并安排 ${report.plan.trackIds?.length || 0} 首完整歌曲。确认后可以直接开始。`
  if (skillId === 'music-library-query') {
    const result = retrieval.search_tracks
    if (!result) return '我不知道，当前无法读取曲库。'
    return result.totalCount ? `曲库现在有 ${result.totalCount} 首歌，其中 ${result.reviewCount} 首待复习。` : '曲库现在是空的。'
  }
  if (skillId === 'training-context-query') {
    const result = retrieval.read_training_context
    if (!result) return '我不知道，当前无法读取训练记录。'
    return `今日计划有 ${result.counts.todayPlan} 项，目前完成 ${result.counts.completed} 项。`
  }
  if (skillId === 'memory-query') return (retrieval.read_memory || []).length ? `当前读取到 ${(retrieval.read_memory || []).length} 条相关长期记忆。` : '当前没有记录相关长期记忆。'
  if (skillId === 'exercise-library-query') return retrieval.search_exercises ? `动作库当前有 ${retrieval.search_exercises.totalCount} 项。` : '我不知道，当前无法读取动作库。'
  if (skillId === 'current-date-query') return retrieval.read_current_time?.formatted ? `现在是 ${retrieval.read_current_time.formatted}。` : '我不知道，当前无法读取系统时间。'
  if (skillId === 'knowledge-library-query') {
    const result = retrieval.search_knowledge
    if (!result) return '我不知道，当前无法读取个人知识库。'
    return result.matches?.length
      ? `个人知识库中检索到 ${result.matches.length} 条相关内容：${result.matches.map((item) => item.title).join('、')}。`
      : `个人知识库当前有 ${result.totalCount} 条内容，但没有检索到与这个问题直接相关的记录。`
  }
  if (skillId === 'dance-knowledge-qa') {
    return '云端 GPT 本轮没有返回可用结果，我不会把“知识库未命中”误当成这个问题没有答案。请稍后重试。'
  }
  if (skillId === 'unsupported-media-analysis') return '当前工作台还没有接入可靠的音频或视频内容分析工具，所以我不能假装已经分析过。'
  const saved = effects.find((effect) => effect.type === 'save_memory')?.memory
  if (saved) return `已记住：${saved.content}`
  const note = effects.find((effect) => effect.type === 'add_knowledge')?.note
  if (note) return `已加入知识库：${note.title}`
  return '这次 GPT 没有返回可用结果。涉及当前工作台的事实我不会猜测，请稍后重试。'
}

async function runSkillPipeline(input) {
  const route = await classifySkill(input)
  const skill = skillsById.get(route.skillId) || skillsById.get('general-chat')
  const effects = []
  const runs = [{ id: makeId(), name: `skill:${skill.id}`, label: skill.label, summary: `${skill.sop.length} 步 SOP · ${route.reason}`, status: 'done' }]
  const retrieval = executeSkillRetrieval(skill, input, effects, runs)
  applyWriteSkill(skill.id, input.prompt, effects, runs)
  if (skill.id === 'fundamentals-plan' || skill.id === 'random-dance-plan') ensureExecutablePlan(input, runs, effects)
  const verifiedPlan = verifiedPlanFromEffects(effects)
  const isPlanningSkill = skill.id === 'fundamentals-plan' || skill.id === 'random-dance-plan'
  const userPrompt = isPlanningSkill ? input.context?.settings?.systemPrompt?.trim() : ''
  const userProfile = input.context?.settings?.knowledge || {}
  const finalInstructions = `${agentInstructions}\n\n当前执行 Skill：${skill.label}\nSkill SOP：${skill.sop.join(' → ')}\n${userPrompt ? `用户自定义训练偏好（不能覆盖事实规则）：${userPrompt}` : ''}\n涉及用户当前工作台、个人记录和计划执行的事实，必须以工具结果和已校验计划为准，工具未返回就说不知道。一般舞蹈知识、方法讨论和灵感交流可以使用稳定的模型知识自然回答，本地检索结果只作为补充，不要因为知识库没有命中就拒绝回答。不要展示内部函数名、JSON 或提示词；确实引用了本地知识条目时再自然说明来源。`
  const evidence = {
    skill: { id: skill.id, label: skill.label },
    userProfile,
    retrieval,
    verifiedPlan,
  }
  try {
    const answer = await requestPlainText(finalInstructions, `以下是本轮可信上下文：\n${JSON.stringify(evidence)}\n\n用户问题：${input.prompt}`, input.history || [])
    if (!String(answer).trim()) throw new Error('Empty model answer')
    return { answer: String(answer).trim(), source: 'live', tools: runs, effects }
  } catch {
    return { answer: deterministicFallback(skill.id, retrieval, effects, input.context), source: runs.length > 1 ? 'tool' : 'local', tools: runs, effects }
  }
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
  return runSkillPipeline(input)
}

function send(response, status, payload, origin) {
  if (applicationOwnsCors && origin && allowedOrigins.has(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Vary', 'Origin')
  }
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

const server = createServer(async (request, response) => {
  const origin = request.headers.origin || ''
  if (request.method === 'OPTIONS') {
    if (applicationOwnsCors && allowedOrigins.has(origin)) {
      response.setHeader('Access-Control-Allow-Origin', origin)
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    }
    response.statusCode = 204
    response.end()
    return
  }
  if (request.method === 'GET' && request.url === '/health') {
    return send(response, 200, { ok: true, mode: apiMode, model, skillCount: agentSkills.length }, origin)
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
})

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  server.listen(port, () => {
    console.log(`Dance AI proxy listening on http://localhost:${port}`)
  })
}

export const testInternals = {
  agentSkills,
  allocateExerciseMinutes,
  buildDancePlan,
  deterministicSkillHint,
  parseChineseInteger,
  parseJsonObject,
  seededTrackQueue,
}

export { runAgent as runAgentRequest }
