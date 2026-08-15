import { useEffect, useEffectEvent, useRef, useState, type FormEvent } from 'react'
import { motion } from 'motion/react'
import { createPortal } from 'react-dom'
import {
  Check,
  ChevronDown,
  Clock3,
  Dumbbell,
  Home,
  ListMusic,
  Music2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Repeat1,
  Save,
  Shuffle,
  SkipBack,
  SkipForward,
  Sparkles,
  Trash2,
  Upload,
  WandSparkles,
  X,
} from 'lucide-react'
import { initialExercises, initialTracks } from './data'
import { getMedia, listMedia, readLocal, removeMedia, saveMedia, writeLocal } from './services/storage'
import { DANCE_AGENT_SYSTEM_PROMPT, PERSONAL_STYLE_KNOWLEDGE_TEMPLATE, type AssistantSettings } from './services/assistantSettings'
import { AgentWorkspace } from './components/AgentWorkspace'
import { TrainingSession } from './components/TrainingSession'
import type { AssistantResult, Exercise, MusicTrack, TabId } from './types'

const ASSET = `${import.meta.env.BASE_URL}assets`
const dateLabel = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date())
const dayKey = new Date().toISOString().slice(0, 10)
const MUSIC_LIBRARY_VERSION = 'local-mp3-v3'

function chorusWindow(track: MusicTrack) {
  const start = Math.max(0, track.chorusStart ?? 45)
  const end = Math.max(start + 8, track.chorusEnd ?? start + 32)
  return { start, end }
}

function formatSeconds(value: number) {
  const minutes = Math.floor(value / 60)
  const seconds = Math.round(value % 60).toString().padStart(2, '0')
  return `${minutes}:${seconds}`
}

function randomIndex(length: number) {
  const value = crypto.getRandomValues(new Uint32Array(1))[0]
  return value % length
}

type Toast = { id: number; message: string }
type PlayerMode = 'dance' | 'listen'
type ListenMode = 'shuffle' | 'sequential' | 'single'
type DanceLaunchRequest = { id: string; trackIds: string[] }
function restoreAssistantResults() {
  return readLocal<AssistantResult[]>('assistant-results', [])
    .filter((item) => item.kind === 'training')
}

function restoreAssistantSettings(): AssistantSettings {
  const saved = readLocal<Partial<AssistantSettings>>('assistant-settings', readLocal('analysis-settings', {}))
  return {
    systemPrompt: saved.systemPrompt || DANCE_AGENT_SYSTEM_PROMPT,
    knowledge: {
      bodyProfile: saved.knowledge?.bodyProfile || PERSONAL_STYLE_KNOWLEDGE_TEMPLATE.bodyProfile,
      preferences: saved.knowledge?.preferences || PERSONAL_STYLE_KNOWLEDGE_TEMPLATE.preferences,
      constraints: saved.knowledge?.constraints || PERSONAL_STYLE_KNOWLEDGE_TEMPLATE.constraints,
    },
  }
}

function App() {
  const [tab, setTab] = useState<TabId>('today')
  const [exercises, setExercises] = useState<Exercise[]>(() => {
    const saved = readLocal<Exercise[]>('exercises', initialExercises)
    return saved.map((item) => ({ ...item, minutes: initialExercises.find((seed) => seed.id === item.id)?.minutes ?? Math.min(3, Math.max(1, item.minutes)) }))
  })
  const [todayIds, setTodayIds] = useState<string[]>(() => readLocal(`today-plan-${dayKey}`, ['head', 'chest', 'combo', 'walk', 'groove']))
  const [completed, setCompleted] = useState<string[]>(() => readLocal(`completed-${dayKey}`, []))
  const [tracks, setTracks] = useState<MusicTrack[]>(() => {
    const version = readLocal<string>('music-library-version', '')
    if (version !== MUSIC_LIBRARY_VERSION) {
      writeLocal('music-library-version', MUSIC_LIBRARY_VERSION)
      return initialTracks
    }
    const saved = readLocal<MusicTrack[]>('music-tracks', [])
    return saved.length ? saved.map((track) => {
      const seed = initialTracks.find((item) => item.id === track.id)
      return { ...seed, ...track, audioUrl: seed?.audioUrl ?? track.audioUrl, durationSeconds: track.durationSeconds ?? seed?.durationSeconds }
    }) : initialTracks
  })
  const [assistantResults, setAssistantResults] = useState<AssistantResult[]>(restoreAssistantResults)
  const [assistantSettings, setAssistantSettings] = useState<AssistantSettings>(restoreAssistantSettings)
  const [danceLaunch, setDanceLaunch] = useState<DanceLaunchRequest | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)

  useEffect(() => {
    if (readLocal('old-audio-library-cleared', false)) return
    listMedia('audio').then((items) => Promise.all(items.map((item) => removeMedia(item.id)))).then(() => writeLocal('old-audio-library-cleared', true))
  }, [])
  useEffect(() => writeLocal('exercises', exercises), [exercises])
  useEffect(() => writeLocal(`today-plan-${dayKey}`, todayIds), [todayIds])
  useEffect(() => writeLocal(`completed-${dayKey}`, completed), [completed])
  useEffect(() => writeLocal('music-tracks', tracks), [tracks])
  useEffect(() => writeLocal('assistant-results', assistantResults), [assistantResults])
  useEffect(() => writeLocal('assistant-settings', assistantSettings), [assistantSettings])

  const notify = (message: string) => {
    const next = { id: Date.now(), message }
    setToast(next)
    window.setTimeout(() => setToast((current) => current?.id === next.id ? null : current), 2600)
  }

  const todayPlan = todayIds.map((id) => exercises.find((item) => item.id === id)).filter(Boolean) as Exercise[]
  const todayMinutes = todayPlan.reduce((sum, item) => sum + item.minutes, 0)
  const completeExercise = (id: string) => setCompleted((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id])

  const regeneratePlan = () => {
    const foundational = exercises.filter((item) => item.level === '基础').sort(() => Math.random() - .5).slice(0, 3)
    const advanced = exercises.filter((item) => item.level === '进阶').sort(() => Math.random() - .5).slice(0, 2)
    setTodayIds([...foundational, ...advanced].map((item) => item.id))
    setCompleted([])
    notify('已换成新的 10 分钟训练组合')
  }

  const tabs = [
    { id: 'today' as const, label: '今日', icon: Home },
    { id: 'training' as const, label: '训练', icon: Dumbbell },
    { id: 'analysis' as const, label: '训练Agent', icon: WandSparkles },
    { id: 'music' as const, label: '随机舞蹈', icon: Music2 },
  ]

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="主导航">
        <div className="brand-mark"><Music2 size={23}/></div>
        <div className="desktop-profile">
          <img src={`${ASSET}/avatar.jpg`} alt="蟹堡王头像" />
          <div><strong>蟹堡王🦀</strong><small>Dance desk</small></div>
        </div>
        <nav>
          {tabs.map(({ id, label, icon: Icon }) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined}>
              <Icon size={20}/><span>{label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="main-content">
        {tab === 'today' && (
          <TodayPage
            exercises={todayPlan}
            completed={completed}
            minutes={todayMinutes}
            onComplete={completeExercise}
            onRegenerate={regeneratePlan}
            onNavigate={setTab}
            trackCount={tracks.length}
            assistantCount={assistantResults.length}
          />
        )}
        {tab === 'training' && (
          <TrainingPage exercises={exercises} completed={completed} tracks={tracks} onComplete={completeExercise} onAdd={(item) => { setExercises((all) => [...all, item]); setTodayIds((ids) => [...ids, item.id]); notify('训练动作已加入今日计划') }} onRegenerate={regeneratePlan} notify={notify}/>
        )}
        {tab === 'analysis' && (
          <AnalysisPage
            settings={assistantSettings}
            exercises={exercises}
            completedIds={completed}
            tracks={tracks}
            todayIds={todayIds}
            results={assistantResults}
            onSettingsChange={setAssistantSettings}
            onResult={(next) => setAssistantResults((items) => [next, ...items.filter((item) => item.kind !== next.kind)])}
            onTodayPlanChange={setTodayIds}
            onCompletePlan={(ids) => {
              setCompleted((items) => Array.from(new Set([...items, ...ids])))
              notify('训练计划已完成并记录')
            }}
            onLaunchDance={(trackIds) => {
              setDanceLaunch({ id: crypto.randomUUID(), trackIds })
              setTab('music')
            }}
            notify={notify}
          />
        )}
        {tab === 'music' && <MusicPage tracks={tracks} setTracks={setTracks} launchRequest={danceLaunch} onLaunchConsumed={() => setDanceLaunch(null)} notify={notify}/>}
      </main>

      <nav className="mobile-nav" aria-label="主导航">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined}>
            <Icon size={21}/><span>{label}</span>
          </button>
        ))}
      </nav>
      {toast && <div className="toast" role="status"><Check size={17}/>{toast.message}</div>}
    </div>
  )
}

function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <header className="page-header"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action}</header>
}

function TodayPage({ exercises, completed, minutes, onComplete, onRegenerate, onNavigate, trackCount, assistantCount }: {
  exercises: Exercise[]; completed: string[]; minutes: number; onComplete: (id: string) => void; onRegenerate: () => void; onNavigate: (tab: TabId) => void; trackCount: number; assistantCount: number
}) {
  const percent = exercises.length ? Math.round(completed.filter((id) => exercises.some((item) => item.id === id)).length / exercises.length * 100) : 0
  const doneCount = completed.filter((id) => exercises.some((item) => item.id === id)).length
  const primary = exercises[0]
  return <div className="page today-page">
    <motion.section className="welcome" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .55 }}>
      <div className="rhythm-lines" aria-hidden="true">{[1, 2, 3, 4, 5, 6, 7, 8].map((beat) => <i key={beat} style={{ '--beat': beat } as React.CSSProperties}/>)}</div>
      <motion.div className="welcome-copy" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .5, delay: .12 }}>
        <span className="eyebrow">{dateLabel}</span>
        <h1>早上好呀，<br/><em>蟹堡王</em></h1>
        <p>今天也把喜欢的节拍，稳稳跳进身体里。</p>
      </motion.div>
      <motion.div className="profile-sticker" initial={{ opacity: 0, scale: .88, rotate: -4 }} animate={{ opacity: 1, scale: 1, rotate: 3 }} transition={{ type: 'spring', stiffness: 120, damping: 14, delay: .2 }}>
        <div className="profile-pulse" aria-hidden="true"/>
        <div className="sticker-orbit"><span>5·6·7·8</span></div>
        <img src={`${ASSET}/avatar.jpg`} alt="蟹堡王头像" />
        <span className="beat-badge">ON BEAT</span>
      </motion.div>
      <div className="welcome-sparkles" aria-hidden="true"><span>✦</span><span>♡</span><span>·</span></div>
      <div className="light-sweep" aria-hidden="true"/>
    </motion.section>

    <section className="daily-note">
      <span><Sparkles size={14}/> 今日一句</span>
      <p>每一个干净的落点，<br/>都来自你认真练过的那一遍。</p>
      <div className="note-decor" aria-hidden="true"><i>♡</i><i>✦</i><i>·</i></div>
    </section>

    <section className="overview-panel" aria-label="今日概览">
      <div className="panel-label"><Sparkles size={15}/> 今日概览</div>
      <div className="overview-grid">
        <div className="overview-item blush"><div className="progress-ring" style={{ '--value': `${percent * 3.6}deg` } as React.CSSProperties}><span><Dumbbell/><strong>{percent}%</strong></span></div><small>训练完成</small><em>{doneCount}/{exercises.length} 项</em></div>
        <div className="overview-item mauve"><div className="progress-ring" style={{ '--value': `${Math.min(360, minutes / 15 * 360)}deg` } as React.CSSProperties}><span><Clock3/><strong>{minutes}</strong></span></div><small>今日分钟</small><em>目标 15 分钟</em></div>
        <div className="overview-item rose"><div className="progress-ring" style={{ '--value': `${Math.min(360, trackCount / 20 * 360)}deg` } as React.CSSProperties}><span><Music2/><strong>{trackCount}</strong></span></div><small>随机曲库</small><em>{assistantCount} 份训练报告</em></div>
      </div>
    </section>

    {primary && <section className="main-task">
      <div className="task-heading"><span><span className="heart-dot">♡</span> 今日主任务</span><button className="icon-btn" onClick={onRegenerate} title="换一组训练"><RefreshCw size={17}/></button></div>
      <div className="task-body"><div><h2>{primary.name}</h2><p>{primary.cue}</p><div className="soft-progress"><i style={{ width: `${Math.max(8, percent)}%` }}/><span>{primary.minutes} 分钟</span></div></div><button className={`focus-btn ${completed.includes(primary.id) ? 'done' : ''}`} onClick={() => onComplete(primary.id)}>{completed.includes(primary.id) ? <Check/> : <Play/>}{completed.includes(primary.id) ? '已完成' : '开始专注'}</button></div>
    </section>}

    <section className="support-block"><div className="support-heading"><div><span>♡</span><h2>今日支持任务</h2></div><button className="text-btn" onClick={() => onNavigate('training')}>查看全部</button></div>
      <div className="support-grid">
        <button className="support-card" onClick={() => onNavigate('analysis')}><span className="support-icon"><WandSparkles/></span><strong>AI 训练 Agent</strong><small>{assistantCount ? `${assistantCount} 份报告已保存` : '根据曲库和记忆安排训练'}</small><i><ChevronDown/></i></button>
        <button className="support-card" onClick={() => onNavigate('music')}><span className="support-icon"><Shuffle/></span><strong>随机开跳</strong><small>从 {trackCount} 首歌中抽查</small><i><ChevronDown/></i></button>
      </div>
    </section>
  </div>
}

function TrainingPage({ exercises, completed, tracks, onComplete, onAdd, onRegenerate, notify }: {
  exercises: Exercise[]; completed: string[]; tracks: MusicTrack[]; onComplete: (id: string) => void; onAdd: (item: Exercise) => void; onRegenerate: () => void; notify: (message: string) => void
}) {
  const [category, setCategory] = useState('全部')
  const [active, setActive] = useState<Exercise | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [trainingTrack, setTrainingTrack] = useState<MusicTrack | null>(() => tracks[Math.floor(Math.random() * tracks.length)] ?? null)
  const trainingPreloadRef = useRef<HTMLAudioElement | null>(null)
  useEffect(() => {
    trainingPreloadRef.current?.pause()
    trainingPreloadRef.current = null
    if (!trainingTrack?.audioUrl) return
    const preloader = new Audio()
    preloader.preload = 'auto'
    preloader.src = trainingTrack.audioUrl
    preloader.load()
    trainingPreloadRef.current = preloader
    return () => {
      preloader.pause()
      preloader.removeAttribute('src')
      preloader.load()
    }
  }, [trainingTrack?.audioUrl])
  const categories = ['全部', ...new Set(exercises.map((item) => item.category))]
  const shown = category === '全部' ? exercises : exercises.filter((item) => item.category === category)
  const pickTrack = () => {
    if (!tracks.length) { setTrainingTrack(null); notify('曲库为空，训练计时仍可正常使用'); return }
    const candidates = tracks.length > 1 ? tracks.filter((item) => item.id !== trainingTrack?.id) : tracks
    setTrainingTrack(candidates[Math.floor(Math.random() * candidates.length)])
  }
  return <div className="page">
    <PageHeader eyebrow="Training library" title="基本功训练" description="从分离度到律动，按身体的学习顺序慢慢累积。" action={<button className="icon-btn bordered" onClick={() => setShowAdd(true)} title="添加训练"><Plus/></button>}/>
    <div className="plan-banner"><div><Sparkles/><span><strong>AI 今日推荐</strong><small>基于 Jazz / K-pop · 每项 1–3 分钟</small></span></div><button onClick={onRegenerate}><RefreshCw size={16}/>换一组</button></div>
    <section className="training-player"><div className="training-player-icon"><Music2/></div><div><span className="eyebrow">Training soundtrack</span><strong>{trainingTrack?.title ?? '等待添加音乐'}</strong><small>{trainingTrack ? `${trainingTrack.artist} · 完整歌曲自动播放` : '曲库歌曲会随机出现'}</small></div><button className="icon-btn" onClick={pickTrack} title="换一首训练音乐"><Shuffle size={17}/></button></section>
    <div className="chip-row" role="tablist" aria-label="动作分类">{categories.map((item) => <button key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div>
    <section className="exercise-list">
      {shown.map((item) => <article key={item.id} className="exercise-row">
        <button className={`exercise-check ${completed.includes(item.id) ? 'done' : ''}`} onClick={() => onComplete(item.id)} aria-label={`${completed.includes(item.id) ? '取消完成' : '标记完成'} ${item.name}`}>{completed.includes(item.id) && <Check size={16}/>}</button>
        <div className="exercise-main"><div className="exercise-title"><h3>{item.name}</h3><span>{item.level}</span></div><p>{item.cue}</p><small>{item.category} · {item.minutes} 分钟</small></div>
        <button className="start-btn" onClick={() => setActive(item)} title={`开始 ${item.name}`}><Play size={17}/></button>
      </article>)}
    </section>
    {active && <TimerModal exercise={active} track={trainingTrack} onClose={() => setActive(null)} onDone={() => { onComplete(active.id); setActive(null) }} notify={notify}/>} 
    {showAdd && <AddExerciseModal onClose={() => setShowAdd(false)} onAdd={(item) => { onAdd(item); setShowAdd(false) }}/>} 
  </div>
}

function TimerModal({ exercise, track, onClose, onDone, notify }: { exercise: Exercise; track: MusicTrack | null; onClose: () => void; onDone: () => void; notify: (message: string) => void }) {
  const total = exercise.minutes * 60
  const [left, setLeft] = useState(total)
  const [running, setRunning] = useState(false)
  const [soundUrl, setSoundUrl] = useState<string | null>(() => track?.audioUrl ?? null)
  const audioRef = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [])
  useEffect(() => {
    let active = true
    let loadedUrl: string | null = null
    if (track?.blobKey) getMedia(track.blobKey).then((media) => { if (active && media) { loadedUrl = URL.createObjectURL(media.blob); setSoundUrl(loadedUrl) } })
    return () => { active = false; if (loadedUrl?.startsWith('blob:')) URL.revokeObjectURL(loadedUrl) }
  }, [track?.blobKey])
  useEffect(() => {
    if (!running || left <= 0) return
    const timer = window.setInterval(() => setLeft((value) => value - 1), 1000)
    return () => window.clearInterval(timer)
  }, [running, left])
  useEffect(() => {
    if (!audioRef.current) return
    if (!running) audioRef.current.pause()
  }, [running, soundUrl, track, notify])
  const toggleRunning = () => {
    const audio = audioRef.current
    if (running) {
      audio?.pause()
      setRunning(false)
      return
    }
    setRunning(true)
    if (audio && soundUrl) {
      if (audio.ended) audio.currentTime = 0
      void audio.play().catch(() => {
        setRunning(false)
        notify('浏览器阻止了播放，请再点击一次“开始”')
      })
    }
  }
  const mins = String(Math.floor(left / 60)).padStart(2, '0')
  const secs = String(left % 60).padStart(2, '0')
  return createPortal(<div className="modal-backdrop timer-backdrop" role="dialog" aria-modal="true" aria-label={`${exercise.name}训练计时器`}><div className="timer-modal">
    <button className="modal-close" onClick={onClose} aria-label="关闭"><X/></button><span className="eyebrow">Focus timer</span><h2>{exercise.name}</h2><p>{exercise.cue}</p>
    <div className="timer-sound"><Music2 size={14}/><span>{track ? `训练音乐 · ${track.title}` : '未选择训练音乐'}</span>{track && <small>完整歌曲循环播放</small>}</div>
    <div className="timer-ring" style={{ '--progress': `${(total - left) / total * 360}deg` } as React.CSSProperties}><div><strong>{mins}:{secs}</strong><small>{running ? '保持呼吸，继续' : '准备好了就开始'}</small></div></div>
    <div className="timer-actions"><button className="secondary-btn" onClick={() => { audioRef.current?.pause(); setLeft(total); setRunning(false) }}><RotateCcw/>重置</button><button className="primary-btn" onClick={toggleRunning}>{running ? <Pause/> : <Play/>}{running ? '暂停' : '开始'}</button></div>
    <button className="finish-link" onClick={onDone}><Check size={17}/>完成这组训练</button>
    <audio ref={audioRef} src={soundUrl ?? undefined} loop preload="auto"/>
  </div></div>, document.body)
}

function AddExerciseModal({ onClose, onAdd }: { onClose: () => void; onAdd: (item: Exercise) => void }) {
  const [name, setName] = useState('')
  const [minutes, setMinutes] = useState(2)
  const submit = (event: FormEvent) => { event.preventDefault(); if (!name.trim()) return; onAdd({ id: crypto.randomUUID(), name: name.trim(), category: '我的训练', minutes, level: '基础', cue: '按自己的练习重点完成这组动作。' }) }
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><form className="form-modal" onSubmit={submit}><button className="modal-close" type="button" onClick={onClose}><X/></button><span className="eyebrow">Custom set</span><h2>添加训练动作</h2><label>动作名称<input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：副歌手部细节" autoFocus/></label><label>训练时长<div className="stepper"><button type="button" onClick={() => setMinutes(Math.max(1, minutes - 1))}>−</button><strong>{minutes} 分钟</strong><button type="button" onClick={() => setMinutes(Math.min(3, minutes + 1))}>+</button></div></label><button className="primary-btn full" type="submit"><Plus/>加入今日计划</button></form></div>
}

function AnalysisPage({ settings, exercises, completedIds, tracks, todayIds, results, onSettingsChange, onResult, onTodayPlanChange, onCompletePlan, onLaunchDance, notify }: {
  settings: AssistantSettings; exercises: Exercise[]; completedIds: string[]; tracks: MusicTrack[]; todayIds: string[]; results: AssistantResult[]; onSettingsChange: (settings: AssistantSettings) => void; onResult: (result: AssistantResult) => void; onTodayPlanChange: (ids: string[]) => void; onCompletePlan: (ids: string[]) => void; onLaunchDance: (trackIds: string[]) => void; notify: (message: string) => void
}) {
  const [showSettings, setShowSettings] = useState(false)
  const [activePlan, setActivePlan] = useState<AssistantResult | null>(null)
  const latestReport = results.find((item) => item.kind === 'training') ?? null
  const startPlan = (result: AssistantResult) => {
    if (result.plan?.mode === 'dance') {
      const trackIds = (result.plan.trackIds?.length ? result.plan.trackIds : result.plan.trackId ? [result.plan.trackId] : []).filter((id) => tracks.some((track) => track.id === id))
      if (!trackIds.length) { notify('这份随舞计划没有可播放的歌曲，请重新生成'); return }
      onLaunchDance(trackIds)
      notify(`已进入随舞模式，将按计划播放 ${trackIds.length} 首歌曲`)
      return
    }
    setActivePlan(result)
  }

  return <div className="page ai-page">
    <PageHeader eyebrow="Personal training agent" title="AI 训练计划 Agent" description="可以聊练舞、查询当前工作台，也能根据曲库、记忆和知识库安排训练。" action={<button className="secondary-btn compact" onClick={() => setShowSettings(true)}><Sparkles size={15}/>Agent 设置</button>}/>
    <div className="assistant-scope-note"><Dumbbell/><span><strong>工作台事实先查询，无法确认就明确说不知道</strong> 训练安排会读取当前进度，再检索动作和本地曲目，生成可以直接执行的计划与报告。</span></div>
    <AgentWorkspace exercises={exercises} tracks={tracks} completedIds={completedIds} todayIds={todayIds} settings={settings} onSetTodayPlan={onTodayPlanChange} onResult={onResult} latestResult={latestReport} onStartPlan={startPlan} notify={notify}/>
    {latestReport && <section className="agent-report-panel" aria-label="最新训练报告"><AssistantResultView result={latestReport} action={latestReport.plan && (latestReport.plan.mode === 'dance' ? latestReport.plan.trackIds?.length : latestReport.plan.exerciseIds.length) ? <button className="secondary-btn compact" onClick={() => startPlan(latestReport)}><Play size={15}/>{latestReport.plan.mode === 'dance' ? '进入随舞' : '开始训练'}</button> : undefined}/></section>}
    {showSettings && (
      <AssistantSettingsModal settings={settings} onClose={() => setShowSettings(false)} onSave={(next) => { onSettingsChange(next); setShowSettings(false) }}/>
    )}
    {activePlan && <TrainingSession key={activePlan.id} result={activePlan} exercises={exercises} tracks={tracks} onClose={() => setActivePlan(null)} onComplete={onCompletePlan} notify={notify}/>}
  </div>
}

function AssistantSettingsModal({ settings, onClose, onSave }: { settings: AssistantSettings; onClose: () => void; onSave: (settings: AssistantSettings) => void }) {
  const [draft, setDraft] = useState(settings)
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [])
  const updateKnowledge = (key: keyof AssistantSettings['knowledge'], value: string) => setDraft((current) => ({ ...current, knowledge: { ...current.knowledge, [key]: value } }))
  const fields: Array<{ key: keyof AssistantSettings['knowledge']; label: string }> = [
    { key: 'bodyProfile', label: '身体状态与旧伤' },
    { key: 'preferences', label: '训练偏好与目标' },
    { key: 'constraints', label: '场地、设备与时间限制' },
  ]
  return createPortal(<div className="modal-backdrop settings-backdrop" role="dialog" aria-modal="true"><form className="form-modal settings-modal" onSubmit={(event) => { event.preventDefault(); onSave(draft) }}><button className="modal-close" type="button" onClick={onClose}><X/></button><span className="eyebrow">Agent preferences</span><h2>训练 Agent 设置</h2><p className="form-note">这些上下文会影响选曲、动作顺序和训练报告；本地音频不会上传。</p><label>训练规划提示词<textarea rows={7} value={draft.systemPrompt} onChange={(event) => setDraft((current) => ({ ...current, systemPrompt: event.target.value }))}/></label><div className="settings-grid">{fields.map(({ key, label }) => <label key={key}>{label}<textarea rows={2} value={draft.knowledge[key]} onChange={(event) => updateKnowledge(key, event.target.value)}/></label>)}</div><button className="primary-btn full" type="submit"><Check/>保存设置</button></form></div>, document.body)
}

function AssistantResultView({ result, action }: { result: AssistantResult; action?: React.ReactNode }) {
  return <div className="assistant-result"><header><div><span className="eyebrow">Training report</span><h2>{result.title}</h2><p>{result.summary}</p></div><div className="assistant-result-actions"><span className={`ai-source ${result.source}`}>{result.source === 'live' ? '真实 AI' : '本地生成'}</span>{action}</div></header><div className="assistant-result-list">{result.blocks.map((block, index) => <article key={`${block.title}-${index}`}><span>{String(index + 1).padStart(2, '0')}</span><div><h3>{block.title}</h3><small>{block.detail}</small><ul>{block.items.map((item) => <li key={item}>{item}</li>)}</ul></div></article>)}</div></div>
}

function MusicPage({ tracks, setTracks, launchRequest, onLaunchConsumed, notify }: { tracks: MusicTrack[]; setTracks: React.Dispatch<React.SetStateAction<MusicTrack[]>>; launchRequest: DanceLaunchRequest | null; onLaunchConsumed: () => void; notify: (message: string) => void }) {
  const [showAdd, setShowAdd] = useState(false)
  const [playerMode, setPlayerMode] = useState<PlayerMode>(() => launchRequest ? 'dance' : readLocal('music-player-mode', 'dance'))
  const [listenMode, setListenMode] = useState<ListenMode>(() => readLocal('music-listen-mode', 'shuffle'))
  const [current, setCurrent] = useState<MusicTrack | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [playbackPosition, setPlaybackPosition] = useState(0)
  const [trackDuration, setTrackDuration] = useState(0)
  const [sessionActive, setSessionActive] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'countdown' | 'playing' | 'paused'>('idle')
  const [countdown, setCountdown] = useState(5)
  const audioRef = useRef<HTMLAudioElement>(null)
  const countdownAudioRef = useRef<HTMLAudioElement>(null)
  const autoplayRef = useRef<MusicTrack | null>(null)
  const currentRef = useRef<MusicTrack | null>(null)
  const countdownTargetRef = useRef<MusicTrack | null>(null)
  const plannedDanceQueueRef = useRef<MusicTrack[]>([])
  const plannedDanceActiveRef = useRef(false)
  const [plannedCountdownTrack, setPlannedCountdownTrack] = useState<MusicTrack | null>(null)
  const [plannedDanceProgress, setPlannedDanceProgress] = useState<{ index: number; total: number } | null>(null)
  const countdownIntervalRef = useRef<number | null>(null)
  const countdownRunRef = useRef(0)
  const plannedTrackPreloadsRef = useRef<Map<string, HTMLAudioElement>>(new Map())
  const countdownBlockedRef = useRef(false)
  const [filter, setFilter] = useState<'all' | 'review'>('all')
  const filtered = filter === 'review' ? tracks.filter((item) => item.status === 'review') : tracks

  useEffect(() => writeLocal('music-player-mode', playerMode), [playerMode])
  useEffect(() => writeLocal('music-listen-mode', listenMode), [listenMode])

  const clearCountdownTimers = () => {
    if (countdownIntervalRef.current) window.clearInterval(countdownIntervalRef.current)
    countdownIntervalRef.current = null
  }
  const stopCountdownAudio = () => {
    if (!countdownAudioRef.current) return
    countdownAudioRef.current.onplaying = null
    countdownAudioRef.current.ontimeupdate = null
    countdownAudioRef.current.onended = null
    countdownAudioRef.current.onerror = null
    countdownAudioRef.current.pause()
    countdownAudioRef.current.currentTime = 0
    countdownAudioRef.current.playbackRate = 1
  }
  const preloadPlannedTrack = (track: MusicTrack) => {
    if (!track.audioUrl || plannedTrackPreloadsRef.current.has(track.id)) return
    const preloader = new Audio()
    preloader.preload = 'auto'
    preloader.src = track.audioUrl
    preloader.load()
    plannedTrackPreloadsRef.current.set(track.id, preloader)
  }
  const waitForMediaReady = (audio: HTMLAudioElement, timeout = 8000) => {
    if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return Promise.resolve()
    return new Promise<void>((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        audio.removeEventListener('canplay', finish)
        audio.removeEventListener('error', finish)
        resolve()
      }
      const timer = window.setTimeout(finish, timeout)
      audio.addEventListener('canplay', finish, { once: true })
      audio.addEventListener('error', finish, { once: true })
    })
  }
  const loadTrack = async (track: MusicTrack, autoplay = false, startAt = 0) => {
    if (audioUrl?.startsWith('blob:')) URL.revokeObjectURL(audioUrl)
    currentRef.current = track
    setCurrent(track); setPlaying(false); setPlaybackPosition(0); setTrackDuration(0); setTracks((items) => items.map((item) => item.id === track.id ? { ...item, lastPlayed: new Date().toISOString() } : item))
    let nextUrl: string | null = track.audioUrl ?? null
    if (!nextUrl && track.blobKey) { const media = await getMedia(track.blobKey); nextUrl = media ? URL.createObjectURL(media.blob) : null }
    if (autoplay) autoplayRef.current = track
    setAudioUrl(nextUrl)
    if (audioRef.current && nextUrl) { audioRef.current.playbackRate = 1; audioRef.current.src = nextUrl; audioRef.current.load() }
    if (autoplay) {
      window.setTimeout(() => {
        if (audioRef.current?.readyState && audioRef.current.readyState >= 2) void playPendingTrack(startAt)
      }, 0)
    }
  }
  const cancelPlannedDance = () => {
    plannedDanceActiveRef.current = false
    plannedDanceQueueRef.current = []
    setPlannedDanceProgress(null)
  }
  const beginRandomDance = () => {
    cancelPlannedDance()
    startCountdown()
  }
  const startCountdown = (plannedTrack?: MusicTrack) => {
    if (!tracks.length) { notify('先添加一首歌曲，再开始随机舞蹈'); return }
    clearCountdownTimers()
    stopCountdownAudio()
    const runId = ++countdownRunRef.current
    countdownBlockedRef.current = false
    const candidates = tracks.length > 1 ? tracks.filter((item) => item.id !== currentRef.current?.id) : tracks
    const target = plannedTrack ?? candidates[randomIndex(candidates.length)]
    preloadPlannedTrack(target)
    countdownTargetRef.current = target
    setPlannedCountdownTrack(plannedTrack ?? null)
    autoplayRef.current = null
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.muted = false }
    setPlaying(false)
    setSessionActive(true)
    setPhase('countdown')
    setCountdown(5)
    const preparePromise = loadTrack(target).then(async () => {
      const musicAudio = audioRef.current
      if (!musicAudio || countdownRunRef.current !== runId || countdownTargetRef.current?.id !== target.id) return
      musicAudio.pause()
      musicAudio.muted = false
      musicAudio.currentTime = chorusWindow(target).start
      await waitForMediaReady(musicAudio)
    })
    const audio = countdownAudioRef.current
    if (!audio) return
    let finished = false
    const syncCountdownNumber = () => {
      if (countdownRunRef.current !== runId || audio.paused) return
      const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 5
      const digitDuration = duration / 5
      setCountdown(Math.max(1, 5 - Math.floor(audio.currentTime / digitDuration)))
    }
    const finishCountdown = async () => {
      if (finished || countdownRunRef.current !== runId) return
      finished = true
      const activeTarget = countdownTargetRef.current
      if (!activeTarget || activeTarget.id !== target.id) return
      clearCountdownTimers()
      stopCountdownAudio()
      await preparePromise
      if (countdownRunRef.current !== runId) return
      countdownTargetRef.current = null
      setPlannedCountdownTrack(null)
      autoplayRef.current = activeTarget
      await playPendingTrack()
      const nextTrack = plannedDanceQueueRef.current[0]
      if (nextTrack) preloadPlannedTrack(nextTrack)
    }
    audio.currentTime = 0
    audio.playbackRate = 1
    audio.onplaying = () => {
      if (countdownRunRef.current !== runId) return
      syncCountdownNumber()
      if (countdownIntervalRef.current === null) countdownIntervalRef.current = window.setInterval(syncCountdownNumber, 100)
    }
    audio.ontimeupdate = syncCountdownNumber
    audio.onended = () => void finishCountdown()
    audio.onerror = () => {
      if (countdownRunRef.current !== runId) return
      clearCountdownTimers()
      countdownBlockedRef.current = true
      setPhase('paused')
      notify('倒计时音频加载失败，请检查网络后再试')
    }
    void audio.play().catch(() => {
      if (countdownRunRef.current === runId) {
        countdownBlockedRef.current = true
        setPhase('paused')
        notify('请点击“开始或继续”，浏览器才能播放倒计时声音')
      }
    })
  }
  const playPendingTrack = async (startAt?: number) => {
    const track = autoplayRef.current
    const audio = audioRef.current
    if (!track || !audio) return
    autoplayRef.current = null
    const nextStart = startAt ?? (playerMode === 'dance' ? chorusWindow(track).start : 0)
    try { audio.currentTime = nextStart; audio.muted = false; await audio.play(); setPlaying(true); setPhase('playing'); setSessionActive(true) }
    catch { setPhase('paused'); notify('浏览器阻止了自动播放，请点一下中间的播放键') }
  }
  const toggleSession = async () => {
    if (playerMode === 'dance' && countdownBlockedRef.current) {
      const target = countdownTargetRef.current
      if (target) startCountdown(target)
      else beginRandomDance()
      return
    }
    if (playerMode === 'listen') {
      if (playing && audioRef.current) { audioRef.current.pause(); setSessionActive(false); setPhase('paused'); return }
      if (current && audioUrl && audioRef.current) {
        try { await audioRef.current.play(); setSessionActive(true); setPhase('playing') }
        catch { notify('浏览器阻止了播放，请再点一次播放键') }
        return
      }
      if (!tracks.length) { notify('先添加一首歌曲，再开始听歌'); return }
      const first = listenMode === 'shuffle' ? tracks[randomIndex(tracks.length)] : tracks[0]
      await loadTrack(first, true, 0)
      return
    }
    if (phase === 'countdown') {
      countdownRunRef.current += 1; clearCountdownTimers(); stopCountdownAudio(); countdownTargetRef.current = null; setPlannedCountdownTrack(null); cancelPlannedDance()
      if (audioRef.current) { audioRef.current.pause(); audioRef.current.muted = false }
      setSessionActive(false); setPhase(current ? 'paused' : 'idle'); return
    }
    if (playing && audioRef.current) {
      audioRef.current.pause(); setSessionActive(false); setPhase('paused'); return
    }
    if (current && audioUrl && audioRef.current) {
      try { await audioRef.current.play(); setSessionActive(true); setPhase('playing') }
      catch { notify('浏览器阻止了播放，请再点一次播放键') }
      return
    }
    beginRandomDance()
  }
  const selectTrack = async (track: MusicTrack) => {
    cancelPlannedDance(); countdownRunRef.current += 1; clearCountdownTimers(); stopCountdownAudio(); audioRef.current?.pause()
    if (audioRef.current) audioRef.current.muted = false
    setSessionActive(false); setPhase('idle'); autoplayRef.current = null
    await loadTrack(track, playerMode === 'listen', 0)
  }
  const continueDanceSession = () => {
    if (!plannedDanceActiveRef.current) {
      startCountdown()
      return
    }
    const next = plannedDanceQueueRef.current.shift()
    if (next) {
      setPlannedDanceProgress((progress) => progress ? { ...progress, index: progress.index + 1 } : progress)
      startCountdown(next)
      return
    }
    plannedDanceActiveRef.current = false
    setPlannedDanceProgress(null)
    setSessionActive(false)
    setPhase('paused')
    notify('随舞计划已完成')
  }
  const skipDanceTrack = () => {
    countdownRunRef.current += 1
    clearCountdownTimers()
    stopCountdownAudio()
    autoplayRef.current = null
    countdownTargetRef.current = null
    setPlannedCountdownTrack(null)
    audioRef.current?.pause()
    if (audioRef.current) audioRef.current.muted = false
    setPlaying(false)
    if (plannedDanceActiveRef.current) {
      continueDanceSession()
      return
    }
    startCountdown()
  }
  const handleTimeUpdate = () => {
    const audio = audioRef.current
    if (!audio || !current) return
    if (playerMode === 'listen') {
      setPlaybackPosition(audio.currentTime)
      if (Number.isFinite(audio.duration)) setTrackDuration(audio.duration)
      return
    }
    const { start, end } = chorusWindow(current)
    if (audio.currentTime < end) return
    audio.pause(); audio.currentTime = start; setPlaying(false)
    if (sessionActive) continueDanceSession()
    else setPhase('paused')
  }
  const nextListenTrack = async (forceAdvance = false) => {
    if (!tracks.length) return
    if (listenMode === 'single' && current && !forceAdvance) { if (audioRef.current) { audioRef.current.currentTime = 0; await audioRef.current.play() }; return }
    let next: MusicTrack
    if (listenMode === 'shuffle') {
      const candidates = tracks.length > 1 ? tracks.filter((item) => item.id !== currentRef.current?.id) : tracks
      next = candidates[randomIndex(candidates.length)]
    } else {
      const currentIndex = tracks.findIndex((item) => item.id === currentRef.current?.id)
      next = tracks[(currentIndex + 1 + tracks.length) % tracks.length]
    }
    await loadTrack(next, true, 0)
  }
  const previousListenTrack = async () => {
    if (!tracks.length) return
    if (audioRef.current && audioRef.current.currentTime > 3) { audioRef.current.currentTime = 0; return }
    const currentIndex = tracks.findIndex((item) => item.id === currentRef.current?.id)
    const previous = tracks[(currentIndex - 1 + tracks.length) % tracks.length]
    await loadTrack(previous, true, 0)
  }
  const switchPlayerMode = (next: PlayerMode) => {
    cancelPlannedDance(); countdownRunRef.current += 1; clearCountdownTimers(); stopCountdownAudio(); autoplayRef.current = null; countdownTargetRef.current = null; setPlannedCountdownTrack(null)
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.muted = false }
    setPlaying(false); setSessionActive(false); setPhase(current ? 'paused' : 'idle'); setPlayerMode(next)
  }
  const handleEnded = () => {
    setPlaying(false)
    if (playerMode === 'listen') { void nextListenTrack(); return }
    if (sessionActive) continueDanceSession()
  }
  const handleMetadata = () => {
    const audio = audioRef.current
    if (!audio || !Number.isFinite(audio.duration)) return
    setTrackDuration(audio.duration)
    setPlaybackPosition(audio.currentTime)
  }
  const seekListening = (value: number) => {
    const audio = audioRef.current
    if (!audio || playerMode !== 'listen') return
    audio.currentTime = value
    setPlaybackPosition(value)
    audio.play().then(() => { setPlaying(true); setSessionActive(true); setPhase('playing') }).catch(() => undefined)
  }
  const startPlannedDance = useEffectEvent((request: DanceLaunchRequest) => {
    const plannedTracks = request.trackIds.map((id) => tracks.find((track) => track.id === id)).filter(Boolean) as MusicTrack[]
    onLaunchConsumed()
    if (!plannedTracks.length) { notify('随舞计划中的歌曲已不存在，请重新生成计划'); return }
    preloadPlannedTrack(plannedTracks[0])
    plannedDanceActiveRef.current = true
    plannedDanceQueueRef.current = plannedTracks.slice(1)
    setPlannedDanceProgress({ index: 1, total: plannedTracks.length })
    startCountdown(plannedTracks[0])
  })
  useEffect(() => {
    if (!launchRequest?.id) return
    const timer = window.setTimeout(() => {
      startPlannedDance(launchRequest)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [launchRequest])
  useEffect(() => () => {
    countdownRunRef.current += 1
    clearCountdownTimers()
    stopCountdownAudio()
    audioRef.current?.pause()
    plannedTrackPreloadsRef.current.forEach((audio) => { audio.pause(); audio.removeAttribute('src'); audio.load() })
    plannedTrackPreloadsRef.current.clear()
  }, [])
  const mark = (status: MusicTrack['status']) => { if (!current) return; setTracks((items) => items.map((item) => item.id === current.id ? { ...item, status } : item)); setCurrent({ ...current, status }); notify(status === 'remembered' ? '记住啦，继续保持' : '已加入复习清单') }
  const updateClip = (updated: MusicTrack) => {
    setTracks((items) => items.map((item) => item.id === updated.id ? updated : item))
    if (current?.id === updated.id) { currentRef.current = updated; setCurrent(updated) }
    notify(`已保存 ${updated.title} 的随机播放片段`)
  }
  const deleteTrack = async (track: MusicTrack) => {
    if (track.blobKey) await removeMedia(track.blobKey)
    setTracks((items) => items.filter((item) => item.id !== track.id))
    if (current?.id === track.id) { clearCountdownTimers(); stopCountdownAudio(); if (audioRef.current) audioRef.current.pause(); currentRef.current = null; setCurrent(null); setAudioUrl(null); setPlaying(false); setSessionActive(false); setPhase('idle') }
    notify('歌曲已从曲库删除')
  }
  return <div className="page music-page">
    <PageHeader eyebrow="Dance + listening" title="K-pop 音乐工作台" description="随舞练习播放片段，听歌模式完整播放整首。" action={<button className="icon-btn bordered" onClick={() => setShowAdd(true)} title="添加歌曲"><Plus/></button>}/>
    <div className="music-mode-toolbar"><div className="mode-switch" role="tablist" aria-label="播放模式"><button className={playerMode === 'dance' ? 'active' : ''} onClick={() => switchPlayerMode('dance')}><Dumbbell/>随舞模式</button><button className={playerMode === 'listen' ? 'active' : ''} onClick={() => switchPlayerMode('listen')}><Music2/>听歌模式</button></div>{playerMode === 'listen' && <div className="listen-modes" role="group" aria-label="听歌播放顺序"><button className={listenMode === 'shuffle' ? 'active' : ''} onClick={() => setListenMode('shuffle')} title="随机播放"><Shuffle/>随机</button><button className={listenMode === 'sequential' ? 'active' : ''} onClick={() => setListenMode('sequential')} title="顺序播放"><ListMusic/>顺序</button><button className={listenMode === 'single' ? 'active' : ''} onClick={() => setListenMode('single')} title="单曲循环"><Repeat1/>单曲循环</button></div>}</div>
    <section className={`player-deck ${phase === 'countdown' || playing ? 'is-active' : ''}`}>
      <div className="vinyl-wrap"><div className={`stage-orbit ${playing ? 'music-active' : ''}`}>{phase === 'countdown' ? <><span className="countdown-number" key={countdown} aria-live="assertive">{countdown}</span><small>GET READY</small></> : <div className={`vinyl ${playing ? 'playing' : ''}`}><div className="vinyl-label"><Music2/></div></div>}<i/><i/><i/><i/><i/></div>{phase !== 'countdown' && <span className="tone-arm"/>}</div>
      <div className="now-playing"><span className="eyebrow">{phase === 'countdown' ? plannedCountdownTrack ? 'Planned dance' : 'Next dance' : playerMode === 'listen' ? 'Now listening' : 'Now dancing'}</span><h2>{phase === 'countdown' ? plannedCountdownTrack ? `准备开始 ${plannedCountdownTrack.title}` : '准备，下一首马上开始' : current?.title ?? (playerMode === 'listen' ? '选择一种方式开始听歌' : '开启连续随机舞蹈')}</h2><p>{phase === 'countdown' ? plannedCountdownTrack ? '倒计时结束后自动播放计划歌曲' : '倒计时结束后自动抽取并播放' : current ? playerMode === 'listen' ? `${current.artist} · 完整播放` : `${current.artist} · 随舞片段 ${formatSeconds(chorusWindow(current).start)}–${formatSeconds(chorusWindow(current).end)}` : playerMode === 'listen' ? '完整播放曲库中的每一首歌' : '每首片段结束后，倒数 5 秒自动进入下一首'}</p>{playerMode === 'listen' && current && phase !== 'countdown' && <div className="listen-progress"><span>{formatSeconds(playbackPosition)}</span><input aria-label="调整当前歌曲播放位置" type="range" min="0" max={Math.max(trackDuration, 1)} step="0.1" value={Math.min(playbackPosition, Math.max(trackDuration, 1))} onChange={(event) => seekListening(Number(event.target.value))}/><span>{formatSeconds(trackDuration)}</span></div>}<div className="player-controls">{playerMode === 'listen' ? <button className="icon-btn" onClick={() => void previousListenTrack()} title="上一首"><SkipBack/></button> : <button className="icon-btn" onClick={beginRandomDance} title="退出当前计划并开始随机随舞"><Shuffle/></button>}<button className="play-main" onClick={() => void toggleSession()} title={playing || phase === 'countdown' ? '暂停' : '开始或继续'}>{phase === 'countdown' || playing ? <Pause/> : <Play/>}</button>{playerMode === 'listen' ? <button className="icon-btn" onClick={() => void nextListenTrack(true)} title="下一首"><SkipForward/></button> : <button className="icon-btn" onClick={skipDanceTrack} title={plannedDanceProgress ? '跳到计划下一首' : '跳过并倒计时下一首'}><RefreshCw/></button>}<span className={`session-status ${sessionActive ? 'active' : ''}`}><i/>{plannedDanceProgress ? `计划 ${plannedDanceProgress.index}/${plannedDanceProgress.total}` : sessionActive ? phase === 'countdown' ? '倒计时中' : playerMode === 'listen' ? listenMode === 'shuffle' ? '随机播放中' : listenMode === 'sequential' ? '顺序播放中' : '单曲循环中' : '连续随舞中' : '已暂停'}</span></div>{current && phase !== 'countdown' && playerMode === 'dance' && <div className="memory-actions"><button onClick={() => mark('remembered')} className={current.status === 'remembered' ? 'active' : ''}><Check/>记得</button><button onClick={() => mark('review')} className={current.status === 'review' ? 'active' : ''}><RotateCcw/>要复习</button></div>}</div>
      <audio ref={countdownAudioRef} src={`${ASSET}/music/countdown-5s.mp3?v=3`} preload="auto"/>
      <audio ref={audioRef} src={audioUrl ?? undefined} preload="auto" loop={playerMode === 'listen' && listenMode === 'single'} onCanPlay={() => void playPendingTrack()} onLoadedMetadata={handleMetadata} onTimeUpdate={handleTimeUpdate} onEnded={handleEnded} onPause={() => setPlaying(false)} onPlay={() => { if (!countdownTargetRef.current) setPlaying(true) }}/>
    </section>
    <div className="library-toolbar"><div><h2>我的曲库</h2><span>{tracks.length} 首 · {tracks.filter((item) => item.status === 'review').length} 首待复习</span></div><div className="segmented"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>全部</button><button className={filter === 'review' ? 'active' : ''} onClick={() => setFilter('review')}>待复习</button></div></div>
    {filtered.length ? <section className="track-list">{filtered.map((track, index) => <TrackRow key={track.id} track={track} index={index} active={current?.id === track.id} onSelect={selectTrack} onDelete={deleteTrack} onSave={updateClip}/>)}</section> : <div className="empty-library"><div className="empty-disc"><Music2/></div><h3>{filter === 'review' ? '没有待复习的歌曲' : '曲库还是空的'}</h3><p>{filter === 'review' ? '忘记动作时标记“要复习”，它就会出现在这里。' : '上传 MP3 / M4A 添加可直接播放的音乐。'}</p>{filter === 'all' && <button className="primary-btn" onClick={() => setShowAdd(true)}><Plus/>添加第一首歌</button>}</div>}
    {showAdd && <AddTrackModal onClose={() => setShowAdd(false)} onAdd={(track) => { setTracks((items) => [track, ...items]); setShowAdd(false); notify('歌曲已加入随机舞蹈库') }}/>} 
  </div>
}

function TrackRow({ track, index, active, onSelect, onDelete, onSave }: { track: MusicTrack; index: number; active: boolean; onSelect: (track: MusicTrack) => Promise<void>; onDelete: (track: MusicTrack) => Promise<void>; onSave: (track: MusicTrack) => void }) {
  const [expanded, setExpanded] = useState(false)
  return <article className={`${active ? 'active ' : ''}${expanded ? 'expanded' : ''}`}>
    <button className="track-select" onClick={() => void onSelect(track)}><span className="track-number">{String(index + 1).padStart(2, '0')}</span><span className="track-copy"><strong>{track.title}</strong><small>{track.artist} · 随机播放 {formatSeconds(chorusWindow(track).start)}–{formatSeconds(chorusWindow(track).end)}</small></span><span className="source-dot local">音频</span><span className="track-status">{track.status === 'remembered' ? <Check/> : track.status === 'review' ? <RotateCcw/> : <Play/>}</span></button>
    <button className="track-expand" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} aria-label={`${expanded ? '收起' : '展开'} ${track.title} 音频截取`} title="设置随机播放片段"><ChevronDown/></button>
    <button className="track-delete" onClick={() => void onDelete(track)} aria-label={`删除 ${track.title}`} title="删除歌曲"><Trash2/></button>
    {expanded && <TrackClipEditor track={track} onSave={onSave}/>} 
  </article>
}

function TrackClipEditor({ track, onSave }: { track: MusicTrack; onSave: (track: MusicTrack) => void }) {
  const [previewUrl, setPreviewUrl] = useState(track.audioUrl ?? '')
  const [duration, setDuration] = useState(Math.max(chorusWindow(track).end + 8, 60))
  const [start, setStart] = useState(chorusWindow(track).start)
  const [end, setEnd] = useState(chorusWindow(track).end)
  const previewRef = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    if (track.audioUrl || !track.blobKey) return
    let objectUrl = ''
    let active = true
    getMedia(track.blobKey).then((media) => { if (active && media) { objectUrl = URL.createObjectURL(media.blob); setPreviewUrl(objectUrl) } })
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [track.audioUrl, track.blobKey])

  const previewClip = () => {
    if (!previewRef.current) return
    previewRef.current.currentTime = start
    previewRef.current.play().catch(() => undefined)
  }
  const updateStart = (value: number) => setStart(Math.min(value, end - 8))
  const updateEnd = (value: number) => setEnd(Math.max(value, start + 8))
  return <div className="clip-editor">
    <div className="clip-heading"><div><span className="eyebrow">Random clip</span><strong>选择每次随机播放的片段</strong></div><span>{formatSeconds(start)}–{formatSeconds(end)} · {Math.round(end - start)} 秒</span></div>
    <audio ref={previewRef} src={previewUrl || undefined} controls preload="metadata" onLoadedMetadata={(event) => { const value = event.currentTarget.duration; if (Number.isFinite(value)) { setDuration(value); setEnd((current) => Math.min(current, value)) } }} onTimeUpdate={(event) => { if (event.currentTarget.currentTime >= end) event.currentTarget.pause() }}/>
    <div className="clip-range"><label><span>片段开始 <b>{formatSeconds(start)}</b></span><input type="range" min={0} max={Math.max(8, duration - 8)} step={1} value={Math.min(start, Math.max(8, duration - 8))} onChange={(event) => updateStart(Number(event.target.value))}/></label><label><span>片段结束 <b>{formatSeconds(end)}</b></span><input type="range" min={8} max={duration} step={1} value={Math.min(end, duration)} onChange={(event) => updateEnd(Number(event.target.value))}/></label></div>
    <div className="clip-actions"><button className="secondary-btn compact" type="button" onClick={previewClip}><Play/>试听片段</button><button className="primary-btn compact" type="button" onClick={() => onSave({ ...track, durationSeconds: Math.round(duration), chorusStart: Math.round(start), chorusEnd: Math.round(end) })}><Save/>保存片段</button></div>
  </div>
}

function AddTrackModal({ onClose, onAdd }: { onClose: () => void; onAdd: (track: MusicTrack) => void }) {
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [tag, setTag] = useState('K-pop')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (!title.trim() || !artist.trim() || !file) { setError('请填写歌名、艺人，并选择一份本地音频。'); return }
    if (!['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav'].includes(file.type)) { setError('暂时只支持 MP3、M4A 和 WAV 音频。'); return }
    try {
      const durationSeconds = await readAudioDuration(file)
      const blobKey = (await saveMedia(file)).id
      onAdd({ id: crypto.randomUUID(), title: title.trim(), artist: artist.trim(), tag, source: 'local', blobKey, durationSeconds, status: 'new' })
    } catch { setError('音频保存失败，请检查浏览器存储空间后重试。') }
  }
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><form className="form-modal track-form" onSubmit={submit}><button className="modal-close" type="button" onClick={onClose}><X/></button><span className="eyebrow">Add track</span><h2>添加到随机舞蹈库</h2><div className="form-grid"><label>歌曲名<input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：Supernova"/></label><label>艺人<input required value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="例如：aespa"/></label></div><label>舞蹈标签<select value={tag} onChange={(e) => setTag(e.target.value)}><option>K-pop</option><option>女团舞</option><option>男团舞</option><option>Jazz</option><option>Choreography</option></select></label><label>本地音频（MP3 / M4A / WAV）<span className="file-field"><Upload/>{file ? file.name : '选择可正常播放的音频'}<input required type="file" accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/wav" onChange={(e) => setFile(e.target.files?.[0] ?? null)}/></span></label><p className="form-note">音频仅保存在当前设备，用于训练和随机舞蹈直接播放。</p>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-btn full" type="submit"><Plus/>加入曲库</button></form></div>
}

function readAudioDuration(file: File) {
  return new Promise<number>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const audio = new Audio()
    const finish = (duration?: number) => {
      URL.revokeObjectURL(url)
      audio.removeAttribute('src')
      if (duration && Number.isFinite(duration)) resolve(Math.round(duration))
      else reject(new Error('Unable to read audio duration'))
    }
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => finish(audio.duration)
    audio.onerror = () => finish()
    audio.src = url
  })
}

export default App
