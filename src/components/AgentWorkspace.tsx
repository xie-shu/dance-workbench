import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Bot, BrainCircuit, Check, Database, LoaderCircle, Play, Search, Send, Trash2, Wrench } from 'lucide-react'
import { INITIAL_AGENT_KNOWLEDGE, runDanceAgent } from '../services/agentService'
import { readLocal, writeLocal } from '../services/storage'
import type { AssistantSettings } from '../services/assistantSettings'
import type { AgentEffect, AgentMemory, AgentMessage, AssistantResult, Exercise, KnowledgeNote, MusicTrack } from '../types'

const welcomeMessage: AgentMessage = {
  id: 'agent-welcome',
  role: 'assistant',
  content: '可以自然聊舞感、动作理解和练舞方法，也可以问曲库、计划、记忆与知识库。需要执行时，告诉我“生成 5 首随舞计划”或“安排 10 分钟基本功”就好。',
  createdAt: '2026-08-14T00:00:00.000Z',
}

const messageStorageKey = 'training-agent-messages-v4'

function isPlanConfirmation(prompt: string, hasPlan: boolean) {
  if (/(确认|开始|执行|就按|按这个|按它).*(计划|训练)|(开始|执行)(这个|该)?计划|好[，, ]*(开始|就按这个)/.test(prompt)) return true
  return hasPlan && /^(好|好的|可以|确认|开始|执行|就按这个|按这个来|按它来)[吧了！!。,.，\s]*$/.test(prompt)
}

function hasExecutablePlan(result: AssistantResult | null) {
  if (!result?.plan) return false
  return result.plan.mode === 'dance' ? Boolean(result.plan.trackIds?.length || result.plan.trackId) : Boolean(result.plan.exerciseIds.length)
}

function restoreAgentKnowledge() {
  const saved = readLocal<KnowledgeNote[]>('agent-knowledge', INITIAL_AGENT_KNOWLEDGE)
  const retiredKnowledgeIds = new Set(['knowledge-eight-count', 'knowledge-camera-check'])
  const retained = saved.filter((note) => !retiredKnowledgeIds.has(note.id))
  const additions = INITIAL_AGENT_KNOWLEDGE.filter((note) => !retained.some((item) => item.id === note.id))
  return [...retained, ...additions]
}

export function AgentWorkspace({
  exercises,
  tracks,
  completedIds,
  todayIds,
  settings,
  onSetTodayPlan,
  onResult,
  latestResult,
  onStartPlan,
  notify,
}: {
  exercises: Exercise[]
  tracks: MusicTrack[]
  completedIds: string[]
  todayIds: string[]
  settings: AssistantSettings
  onSetTodayPlan: (ids: string[]) => void
  onResult: (result: AssistantResult) => void
  latestResult: AssistantResult | null
  onStartPlan: (result: AssistantResult) => void
  notify: (message: string) => void
}) {
  const [messages, setMessages] = useState<AgentMessage[]>(() => readLocal(messageStorageKey, [welcomeMessage]))
  const [memories, setMemories] = useState<AgentMemory[]>(() => readLocal('agent-memories', []))
  const [knowledge, setKnowledge] = useState<KnowledgeNote[]>(restoreAgentKnowledge)
  const [prompt, setPrompt] = useState('')
  const [running, setRunning] = useState(false)
  const threadRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    writeLocal(messageStorageKey, messages.slice(-40))
    localStorage.removeItem('training-agent-messages-v1')
    localStorage.removeItem('training-agent-messages-v2')
    localStorage.removeItem('training-agent-messages-v3')
  }, [messages])
  useEffect(() => writeLocal('agent-memories', memories), [memories])
  useEffect(() => writeLocal('agent-knowledge', knowledge), [knowledge])
  useEffect(() => { threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' }) }, [messages, running])

  const applyEffect = (effect: AgentEffect) => {
    if (effect.type === 'set_today_plan') {
      onSetTodayPlan(effect.exerciseIds)
      notify('Agent 已更新今日训练计划')
    }
    if (effect.type === 'save_memory') {
      setMemories((items) => [effect.memory, ...items.filter((item) => item.id !== effect.memory.id)])
      notify('Agent 已写入长期记忆')
    }
    if (effect.type === 'add_knowledge') {
      setKnowledge((items) => [effect.note, ...items.filter((item) => item.id !== effect.note.id)])
      notify('Agent 已更新知识库')
    }
    if (effect.type === 'save_assistant_result') onResult(effect.result)
  }

  const confirmPlan = (userText = '确认执行这个计划') => {
    const userMessage: AgentMessage = { id: crypto.randomUUID(), role: 'user', content: userText, createdAt: new Date().toISOString() }
    if (!hasExecutablePlan(latestResult)) {
      setMessages((items) => [...items, userMessage, { id: crypto.randomUUID(), role: 'assistant', content: '当前没有可执行的训练计划。先让我安排一份训练计划，再确认开始。', createdAt: new Date().toISOString(), source: 'tool' }])
      return
    }
    const plan = latestResult!.plan!
    const danceMode = plan.mode === 'dance'
    setMessages((items) => [...items, userMessage, {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: danceMode ? `随舞计划已启动，正在进入随舞模式，将按计划顺序播放 ${plan.trackIds?.length ?? 1} 首歌曲。` : `计划已启动。开场和每次换动作前都会先进行 5 秒倒计时，训练中会按队列播放完整歌曲。`,
      createdAt: new Date().toISOString(),
      source: 'tool',
      tools: [{ id: crypto.randomUUID(), name: 'start_training_plan', label: danceMode ? '进入随舞模式' : '启动训练计划', summary: danceMode ? `${plan.trackIds?.length ?? 1} 首歌曲 · 按计划顺序播放` : `${plan.exerciseIds.length} 组动作 · ${plan.trackIds?.length ?? 0} 首完整歌曲`, status: 'done' }],
    }])
    onStartPlan(latestResult!)
  }

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    const task = prompt.trim()
    if (!task || running) return
    const userMessage: AgentMessage = { id: crypto.randomUUID(), role: 'user', content: task, createdAt: new Date().toISOString() }
    const nextHistory = [...messages, userMessage]
    if (isPlanConfirmation(task, hasExecutablePlan(latestResult))) {
      confirmPlan(task)
      setPrompt('')
      return
    }
    setMessages(nextHistory)
    setPrompt('')
    setRunning(true)
    try {
      const result = await runDanceAgent(task, { exercises, tracks, completedIds, todayIds, memories, knowledge, settings, latestResult }, messages)
      result.effects.forEach(applyEffect)
      setMessages((items) => [...items, { id: crypto.randomUUID(), role: 'assistant', content: result.answer, createdAt: new Date().toISOString(), source: result.source, tools: result.tools }])
    } catch {
      setMessages((items) => [...items, { id: crypto.randomUUID(), role: 'assistant', content: '这次任务没有执行完成。请保留当前页面后再试一次。', createdAt: new Date().toISOString(), source: 'local' }])
    } finally {
      setRunning(false)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void submit()
    }
  }

  return <section className="agent-desk">
    <div className="agent-chat">
      <header className="agent-chat-header">
        <div className="agent-identity"><span><Bot/></span><div><strong>舞蹈成长 Agent</strong><small>{running ? '正在理解问题与调用工具' : '对话与训练工具已就绪'}</small></div></div>
        <button className="icon-btn" onClick={() => setMessages([welcomeMessage])} aria-label="清空对话" title="清空对话"><Trash2/></button>
      </header>
      <div className="agent-thread" ref={threadRef} aria-live="polite">
        {messages.map((message) => <article key={message.id} className={`agent-message ${message.role}`}>
          <span className="agent-avatar">{message.role === 'assistant' ? <Bot/> : '蟹'}</span>
          <div className="agent-bubble">
            <p>{message.content}</p>
            {message.tools?.length ? <div className="agent-tool-runs">{message.tools.map((item) => <div key={item.id} className={item.status}><span>{item.name.includes('search') || item.name.includes('read') ? <Search/> : item.status === 'done' ? <Check/> : <Wrench/>}</span><div><strong>{item.label}</strong><small>{item.summary}</small></div></div>)}</div> : null}
            {message.role === 'assistant' && <small className="agent-source">{message.source === 'live' ? 'GPT Agent' : message.source === 'tool' ? '工作台数据' : message.source === 'local' ? '离线工作台' : '系统引导'}</small>}
          </div>
        </article>)}
        {running && <article className="agent-message assistant"><span className="agent-avatar"><Bot/></span><div className="agent-bubble thinking"><div className="agent-count-run">{Array.from({ length: 8 }, (_, index) => <i key={index}>{index + 1}</i>)}</div><span><LoaderCircle/>正在读取上下文并编排训练</span></div></article>}
      </div>
      {hasExecutablePlan(latestResult) ? <div className="agent-plan-launch">
        <div><span>可执行计划</span><strong>{latestResult!.title}</strong><small>{latestResult!.plan!.mode === 'dance' ? `${latestResult!.plan!.trackIds?.length ?? 1} 首 · 按计划顺序随舞` : `${latestResult!.plan!.exerciseIds.length} 组 · ${latestResult!.plan!.totalMinutes} 分钟`}</small></div>
        <button onClick={() => confirmPlan()}><Play/>{latestResult!.plan!.mode === 'dance' ? '确认并随舞' : '确认并开始'}</button>
      </div> : null}
      <form className="agent-composer" onSubmit={submit}>
        <textarea rows={2} value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={handleKeyDown} placeholder="安排 10 分钟基本功，或生成 5 首随舞计划" aria-label="给训练计划 Agent 的任务"/>
        <button type="submit" disabled={!prompt.trim() || running} aria-label="发送任务" title="发送任务"><Send/></button>
      </form>
    </div>

    <aside className="agent-context-panel">
      <header><span className="eyebrow">Agent context</span><h2>可调用上下文</h2></header>
      <div className="agent-context-stats">
        <div><BrainCircuit/><strong>{memories.length}</strong><small>长期记忆</small></div>
        <div><Database/><strong>{knowledge.length}</strong><small>知识条目</small></div>
        <div><Wrench/><strong>13</strong><small>Agent Skills</small></div>
      </div>
      <section className="agent-context-list">
        <div className="agent-context-heading"><BrainCircuit/><strong>最近记忆</strong></div>
        {memories.length ? memories.slice(0, 4).map((memory) => <div className="context-row" key={memory.id}><span>{memory.content}</span><button onClick={() => setMemories((items) => items.filter((item) => item.id !== memory.id))} aria-label="删除记忆" title="删除记忆"><Trash2/></button></div>) : <p>暂无长期记忆</p>}
      </section>
      <section className="agent-context-list">
        <div className="agent-context-heading"><Database/><strong>知识库</strong></div>
        {knowledge.slice(0, 4).map((note) => <div className="context-row" key={note.id}><span><b>{note.title}</b><small>{note.tags.join(' · ')}</small></span><button onClick={() => setKnowledge((items) => items.filter((item) => item.id !== note.id))} aria-label="删除知识条目" title="删除知识条目"><Trash2/></button></div>)}
      </section>
    </aside>
  </section>
}
