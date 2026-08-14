import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { motion } from 'motion/react'
import {
  Check,
  ChevronDown,
  Clock3,
  Dumbbell,
  FileVideo,
  LoaderCircle,
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
import { analyzeDanceVideo, type AnalysisSettings } from './services/analysisService'
import { DANCE_ANALYSIS_SYSTEM_PROMPT, PERSONAL_STYLE_KNOWLEDGE_TEMPLATE } from './services/analysisPrompt'
import type { AnalysisReport, Exercise, MusicTrack, StoredMedia, TabId } from './types'

const ASSET = `${import.meta.env.BASE_URL}assets`
const dateLabel = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date())
const dayKey = new Date().toISOString().slice(0, 10)
const MUSIC_LIBRARY_VERSION = 'local-mp3-v2'

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
    return saved.length ? saved : initialTracks
  })
  const [reports, setReports] = useState<AnalysisReport[]>(() => readLocal('analysis-reports', []))
  const [analysisSettings, setAnalysisSettings] = useState<AnalysisSettings>(() => readLocal('analysis-settings', { systemPrompt: DANCE_ANALYSIS_SYSTEM_PROMPT, knowledge: PERSONAL_STYLE_KNOWLEDGE_TEMPLATE }))
  const [customVideos, setCustomVideos] = useState<StoredMedia[]>([])
  const [toast, setToast] = useState<Toast | null>(null)

  useEffect(() => { listMedia('video').then(setCustomVideos) }, [])
  useEffect(() => {
    if (readLocal('old-audio-library-cleared', false)) return
    listMedia('audio').then((items) => Promise.all(items.map((item) => removeMedia(item.id)))).then(() => writeLocal('old-audio-library-cleared', true))
  }, [])
  useEffect(() => writeLocal('exercises', exercises), [exercises])
  useEffect(() => writeLocal(`today-plan-${dayKey}`, todayIds), [todayIds])
  useEffect(() => writeLocal(`completed-${dayKey}`, completed), [completed])
  useEffect(() => writeLocal('music-tracks', tracks), [tracks])
  useEffect(() => writeLocal('analysis-reports', reports), [reports])
  useEffect(() => writeLocal('analysis-settings', analysisSettings), [analysisSettings])

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
    { id: 'analysis' as const, label: 'AI分析', icon: WandSparkles },
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
            reportCount={reports.length}
          />
        )}
        {tab === 'training' && (
          <TrainingPage exercises={exercises} completed={completed} tracks={tracks} onComplete={completeExercise} onAdd={(item) => { setExercises((all) => [...all, item]); setTodayIds((ids) => [...ids, item.id]); notify('训练动作已加入今日计划') }} onRegenerate={regeneratePlan} notify={notify}/>
        )}
        {tab === 'analysis' && (
          <AnalysisPage
            videos={customVideos}
            reports={reports}
            settings={analysisSettings}
            onSettingsChange={setAnalysisSettings}
            onUpload={async (file) => { try { const media = await saveMedia(file); setCustomVideos((items) => [media, ...items]); notify('视频已保存到当前设备') } catch { notify('视频保存失败，请检查浏览器存储空间') } }}
            onRemoveVideo={async (id) => { await removeMedia(id); setCustomVideos((items) => items.filter((item) => item.id !== id)); notify('视频已删除') }}
            onReport={(report) => { setReports((items) => [report, ...items.filter((item) => item.videoName !== report.videoName)]); notify('演示分析已完成') }}
          />
        )}
        {tab === 'music' && <MusicPage tracks={tracks} setTracks={setTracks} notify={notify}/>} 
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

function TodayPage({ exercises, completed, minutes, onComplete, onRegenerate, onNavigate, trackCount, reportCount }: {
  exercises: Exercise[]; completed: string[]; minutes: number; onComplete: (id: string) => void; onRegenerate: () => void; onNavigate: (tab: TabId) => void; trackCount: number; reportCount: number
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
        <div className="overview-item rose"><div className="progress-ring" style={{ '--value': `${Math.min(360, trackCount / 20 * 360)}deg` } as React.CSSProperties}><span><Music2/><strong>{trackCount}</strong></span></div><small>随机曲库</small><em>{reportCount} 份分析</em></div>
      </div>
    </section>

    {primary && <section className="main-task">
      <div className="task-heading"><span><span className="heart-dot">♡</span> 今日主任务</span><button className="icon-btn" onClick={onRegenerate} title="换一组训练"><RefreshCw size={17}/></button></div>
      <div className="task-body"><div><h2>{primary.name}</h2><p>{primary.cue}</p><div className="soft-progress"><i style={{ width: `${Math.max(8, percent)}%` }}/><span>{primary.minutes} 分钟</span></div></div><button className={`focus-btn ${completed.includes(primary.id) ? 'done' : ''}`} onClick={() => onComplete(primary.id)}>{completed.includes(primary.id) ? <Check/> : <Play/>}{completed.includes(primary.id) ? '已完成' : '开始专注'}</button></div>
    </section>}

    <section className="support-block"><div className="support-heading"><div><span>♡</span><h2>今日支持任务</h2></div><button className="text-btn" onClick={() => onNavigate('training')}>查看全部</button></div>
      <div className="support-grid">
        <button className="support-card" onClick={() => onNavigate('analysis')}><span className="support-icon"><WandSparkles/></span><strong>AI 拆舞</strong><small>{reportCount ? `${reportCount} 份报告已保存` : '分析一段参考视频'}</small><i><ChevronDown/></i></button>
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
    <section className="training-player"><div className="training-player-icon"><Music2/></div><div><span className="eyebrow">Training soundtrack</span><strong>{trainingTrack?.title ?? '等待添加音乐'}</strong><small>{trainingTrack ? `${trainingTrack.artist} · 第一段副歌自动播放` : '曲库歌曲会随机出现'}</small></div><button className="icon-btn" onClick={pickTrack} title="换一首训练音乐"><Shuffle size={17}/></button></section>
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
    if (running && soundUrl) {
      const { start } = track ? chorusWindow(track) : { start: 0 }
      audioRef.current.currentTime = start
      audioRef.current.play().catch(() => notify('浏览器阻止了自动播放，请点击计时器中的播放按钮'))
    }
    if (!running) audioRef.current.pause()
  }, [running, soundUrl, track, notify])
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !track || track.source !== 'local') return
    const { start, end } = chorusWindow(track)
    const stopAtChorusEnd = () => { if (audio.currentTime >= end) { audio.pause(); audio.currentTime = start } }
    audio.addEventListener('timeupdate', stopAtChorusEnd)
    return () => audio.removeEventListener('timeupdate', stopAtChorusEnd)
  }, [track, soundUrl])
  const mins = String(Math.floor(left / 60)).padStart(2, '0')
  const secs = String(left % 60).padStart(2, '0')
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><div className="timer-modal">
    <button className="modal-close" onClick={onClose} aria-label="关闭"><X/></button><span className="eyebrow">Focus timer</span><h2>{exercise.name}</h2><p>{exercise.cue}</p>
    <div className="timer-sound"><Music2 size={14}/><span>{track ? `训练音乐 · ${track.title}` : '未选择训练音乐'}</span>{track && <small>第一段副歌 · {formatSeconds(chorusWindow(track).start)}–{formatSeconds(chorusWindow(track).end)}</small>}</div>
    <div className="timer-ring" style={{ '--progress': `${(total - left) / total * 360}deg` } as React.CSSProperties}><div><strong>{mins}:{secs}</strong><small>{running ? '保持呼吸，继续' : '准备好了就开始'}</small></div></div>
    <div className="timer-actions"><button className="secondary-btn" onClick={() => { setLeft(total); setRunning(false) }}><RotateCcw/>重置</button><button className="primary-btn" onClick={() => setRunning(!running)}>{running ? <Pause/> : <Play/>}{running ? '暂停' : '开始'}</button></div>
    <button className="finish-link" onClick={onDone}><Check size={17}/>完成这组训练</button>
    <audio ref={audioRef} src={soundUrl ?? undefined} loop preload="metadata"/>
  </div></div>
}

function AddExerciseModal({ onClose, onAdd }: { onClose: () => void; onAdd: (item: Exercise) => void }) {
  const [name, setName] = useState('')
  const [minutes, setMinutes] = useState(2)
  const submit = (event: FormEvent) => { event.preventDefault(); if (!name.trim()) return; onAdd({ id: crypto.randomUUID(), name: name.trim(), category: '我的训练', minutes, level: '基础', cue: '按自己的练习重点完成这组动作。' }) }
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><form className="form-modal" onSubmit={submit}><button className="modal-close" type="button" onClick={onClose}><X/></button><span className="eyebrow">Custom set</span><h2>添加训练动作</h2><label>动作名称<input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：副歌手部细节" autoFocus/></label><label>训练时长<div className="stepper"><button type="button" onClick={() => setMinutes(Math.max(1, minutes - 1))}>−</button><strong>{minutes} 分钟</strong><button type="button" onClick={() => setMinutes(Math.min(3, minutes + 1))}>+</button></div></label><button className="primary-btn full" type="submit"><Plus/>加入今日计划</button></form></div>
}

type VideoSelection = { name: string; kind: 'jazz' | 'kpop' | 'custom'; src: string; storedId?: string }

function AnalysisPage({ videos, reports, settings, onSettingsChange, onUpload, onRemoveVideo, onReport }: {
  videos: StoredMedia[]; reports: AnalysisReport[]; settings: AnalysisSettings; onSettingsChange: (settings: AnalysisSettings) => void; onUpload: (file: File) => Promise<void>; onRemoveVideo: (id: string) => Promise<void>; onReport: (report: AnalysisReport) => void
}) {
  const [selection, setSelection] = useState<VideoSelection | null>(null)
  const [stage, setStage] = useState<'idle' | 'loading' | 'done'>('idle')
  const [currentReport, setCurrentReport] = useState<AnalysisReport | null>(reports[0] ?? null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const chooseStored = async (media: StoredMedia) => {
    const fresh = await getMedia(media.id)
    if (!fresh) return
    if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl)
    const url = URL.createObjectURL(fresh.blob)
    setPreviewUrl(url); setSelection({ name: media.name, kind: 'custom', src: url, storedId: media.id }); setStage('idle'); setCurrentReport(null)
  }
  const chooseBuiltIn = (kind: 'jazz' | 'kpop') => { if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl); const src = `${ASSET}/${kind}.mp4`; setPreviewUrl(src); setSelection({ name: `${kind.toUpperCase()} 测试视频`, kind, src }); setStage('idle'); setCurrentReport(null) }
  const upload = async (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file) return; if (!file.type.startsWith('video/')) { event.target.value = ''; return } await onUpload(file); const url = URL.createObjectURL(file); setPreviewUrl(url); setSelection({ name: file.name, kind: 'custom', src: url }); event.target.value = '' }
  const analyze = async () => { if (!selection) return; setStage('loading'); const report = await analyzeDanceVideo({ kind: selection.kind, videoName: selection.name, settings }); setCurrentReport(report); onReport(report); setStage('done') }

  return <div className="page">
    <PageHeader eyebrow="Music + dance analysis" title="AI 拆舞室" description="先听懂音乐，再看懂舞蹈：拆出曲风、动作语言，以及两者如何卡在一起。" action={<button className="secondary-btn compact" onClick={() => setShowSettings(true)}><Sparkles size={15}/>分析设置</button>}/>
    <div className="demo-notice"><Sparkles size={18}/><p><strong>演示分析</strong> 当前结果由结构化模板生成，不代表真实模型判断。上传的视频只保存在此设备。</p></div>
    <section className="analysis-method" aria-label="分析依据"><div className="method-heading"><span className="eyebrow">Analysis order</span><strong>音乐和舞蹈是主结果</strong></div><div className="method-steps"><span><Music2/><b>听音乐</b><small>曲风 / BPM / 重拍</small></span><span><Dumbbell/><b>看舞蹈</b><small>动作语言 / 发力</small></span><span><Sparkles/><b>找对应</b><small>切点 / 留白 / 放大</small></span><span><WandSparkles/><b>给建议</b><small>造型 / 镜头 / 练习</small></span></div></section>
    <section className="analysis-studio">
      <div className="video-stage">
        {selection && previewUrl ? <video key={previewUrl} src={previewUrl} controls playsInline/> : <div className="video-empty"><FileVideo/><strong>选择一段参考视频</strong><span>试看素材或上传你自己的视频</span></div>}
      </div>
      <div className="video-picker">
        <button onClick={() => chooseBuiltIn('jazz')} className={selection?.kind === 'jazz' ? 'selected' : ''}><span className="video-thumb jazz">JAZZ</span><span><strong>Jazz 测试视频</strong><small>甜酷编舞参考</small></span></button>
        <button onClick={() => chooseBuiltIn('kpop')} className={selection?.kind === 'kpop' ? 'selected' : ''}><span className="video-thumb kpop">K-POP</span><span><strong>K-pop 测试视频</strong><small>女团编舞参考</small></span></button>
        {videos.map((video) => <button key={video.id} onClick={() => chooseStored(video)} className={selection?.storedId === video.id ? 'selected' : ''}><span className="video-thumb custom"><FileVideo/></span><span><strong>{video.name}</strong><small>{(video.size / 1024 / 1024).toFixed(1)} MB · 本机视频</small></span><span className="remove-mini" role="button" tabIndex={0} onClick={(event) => { event.stopPropagation(); onRemoveVideo(video.id) }}><Trash2 size={15}/></span></button>)}
      </div>
      <input ref={inputRef} className="visually-hidden" type="file" accept="video/mp4,video/quicktime,video/webm" onChange={upload}/>
      <div className="analysis-actions"><button className="secondary-btn" onClick={() => inputRef.current?.click()}><Upload/>上传视频</button><button className="primary-btn" disabled={!selection || stage === 'loading'} onClick={analyze}>{stage === 'loading' ? <LoaderCircle className="spin"/> : <WandSparkles/>}{stage === 'loading' ? '正在拆解…' : '开始演示分析'}</button></div>
    </section>
    {currentReport && <ReportView report={currentReport}/>} 
    {showSettings && <AnalysisSettingsModal settings={settings} onClose={() => setShowSettings(false)} onSave={(next) => { onSettingsChange(next); setShowSettings(false) }}/>} 
  </div>
}

function AnalysisSettingsModal({ settings, onClose, onSave }: { settings: AnalysisSettings; onClose: () => void; onSave: (settings: AnalysisSettings) => void }) {
  const [draft, setDraft] = useState(settings)
  const updateKnowledge = (key: keyof AnalysisSettings['knowledge'], value: string) => setDraft((current) => ({ ...current, knowledge: { ...current.knowledge, [key]: value } }))
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><form className="form-modal settings-modal" onSubmit={(event) => { event.preventDefault(); onSave(draft) }}><button className="modal-close" type="button" onClick={onClose}><X/></button><span className="eyebrow">Prompt + knowledge</span><h2>分析设置</h2><p className="form-note">这里的内容会随未来真实模型请求一起发送。当前仍是本地演示分析，不会假装已经调用模型。</p><label>主提示词<textarea rows={7} value={draft.systemPrompt} onChange={(event) => setDraft((current) => ({ ...current, systemPrompt: event.target.value }))}/></label><div className="settings-grid">{(Object.keys(draft.knowledge) as Array<keyof AnalysisSettings['knowledge']>).map((key) => <label key={key}>{({ bodyProfile: '身体与尺码', wardrobe: '衣橱单品', makeup: '妆发偏好', budget: '造型预算', preferences: '审美偏好', constraints: '拍摄限制' } as Record<string, string>)[key]}<textarea rows={2} value={draft.knowledge[key]} onChange={(event) => updateKnowledge(key, event.target.value)}/></label>)}</div><button className="primary-btn full" type="submit"><Check/>保存设置</button></form></div>
}

function ReportView({ report }: { report: AnalysisReport }) {
  const [open, setOpen] = useState(report.sections[0]?.id)
  return <section className="report-section"><div className="report-heading"><div><span className="eyebrow">Analysis report</span><h2>{report.videoName}</h2></div><div className="report-tags"><span>{report.bpm}</span><span>{report.style}</span></div></div><div className="report-list">{report.sections.map((section, index) => <article key={section.id} className={open === section.id ? 'open' : ''}><button onClick={() => setOpen(open === section.id ? '' : section.id)}><span className="report-number">{String(index + 1).padStart(2, '0')}</span><span><strong>{section.title}</strong><small>{section.summary}</small></span><ChevronDown/></button>{open === section.id && <ul>{section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>}</article>)}</div></section>
}

function MusicPage({ tracks, setTracks, notify }: { tracks: MusicTrack[]; setTracks: React.Dispatch<React.SetStateAction<MusicTrack[]>>; notify: (message: string) => void }) {
  const [showAdd, setShowAdd] = useState(false)
  const [playerMode, setPlayerMode] = useState<PlayerMode>(() => readLocal('music-player-mode', 'dance'))
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
  const autoplayRef = useRef<MusicTrack | null>(null)
  const currentRef = useRef<MusicTrack | null>(null)
  const countdownIntervalRef = useRef<number | null>(null)
  const countdownTimeoutRef = useRef<number | null>(null)
  const [filter, setFilter] = useState<'all' | 'review'>('all')
  const filtered = filter === 'review' ? tracks.filter((item) => item.status === 'review') : tracks

  useEffect(() => writeLocal('music-player-mode', playerMode), [playerMode])
  useEffect(() => writeLocal('music-listen-mode', listenMode), [listenMode])

  const clearCountdownTimers = () => {
    if (countdownIntervalRef.current) window.clearInterval(countdownIntervalRef.current)
    if (countdownTimeoutRef.current) window.clearTimeout(countdownTimeoutRef.current)
    countdownIntervalRef.current = null
    countdownTimeoutRef.current = null
  }
  const stopCountdownAudio = () => {
    if (!audioRef.current) return
    audioRef.current.pause()
    audioRef.current.currentTime = 0
    audioRef.current.playbackRate = 1
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
  const pickAndPlay = async () => {
    const candidates = tracks.length > 1 ? tracks.filter((item) => item.id !== currentRef.current?.id) : tracks
    const next = candidates[randomIndex(candidates.length)]
    autoplayRef.current = next
    await loadTrack(next)
  }
  const startCountdown = () => {
    if (!tracks.length) { notify('先添加一首歌曲，再开始随机舞蹈'); return }
    clearCountdownTimers()
    autoplayRef.current = null
    audioRef.current?.pause()
    setPlaying(false)
    setSessionActive(true)
    setPhase('countdown')
    setCountdown(5)
    const audio = audioRef.current
    if (audio) {
      audio.src = `${ASSET}/music/countdown-5s.mp3?v=2`
      audio.currentTime = 0
      audio.playbackRate = 1.28
      audio.play().catch(() => notify('请再点一次播放，浏览器才能播放倒计时声音'))
    }
    countdownIntervalRef.current = window.setInterval(() => {
      setCountdown((value) => Math.max(1, value - 1))
    }, 1000)
    countdownTimeoutRef.current = window.setTimeout(() => {
      clearCountdownTimers()
      stopCountdownAudio()
      void pickAndPlay()
    }, 5000)
  }
  const playPendingTrack = async (startAt?: number) => {
    const track = autoplayRef.current
    const audio = audioRef.current
    if (!track || !audio) return
    autoplayRef.current = null
    const nextStart = startAt ?? (playerMode === 'dance' ? chorusWindow(track).start : 0)
    try { audio.currentTime = nextStart; await audio.play(); setPhase('playing'); setSessionActive(true) }
    catch { setPhase('paused'); notify('浏览器阻止了自动播放，请点一下中间的播放键') }
  }
  const toggleSession = async () => {
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
      clearCountdownTimers(); stopCountdownAudio()
      if (audioRef.current && audioUrl) { audioRef.current.src = audioUrl; audioRef.current.load() }
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
    startCountdown()
  }
  const selectTrack = async (track: MusicTrack) => {
    clearCountdownTimers(); stopCountdownAudio(); audioRef.current?.pause()
    setSessionActive(false); setPhase('idle'); autoplayRef.current = null
    await loadTrack(track, playerMode === 'listen', 0)
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
    if (sessionActive) startCountdown()
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
    clearCountdownTimers(); stopCountdownAudio(); autoplayRef.current = null
    if (audioRef.current && audioUrl) { audioRef.current.src = audioUrl; audioRef.current.load() }
    setPlaying(false); setSessionActive(false); setPhase(current ? 'paused' : 'idle'); setPlayerMode(next)
  }
  const handleEnded = () => {
    setPlaying(false)
    if (playerMode === 'listen') { void nextListenTrack(); return }
    if (sessionActive) startCountdown()
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
  useEffect(() => () => { clearCountdownTimers(); stopCountdownAudio() }, [])
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
      <div className="now-playing"><span className="eyebrow">{phase === 'countdown' ? 'Next dance' : playerMode === 'listen' ? 'Now listening' : 'Now dancing'}</span><h2>{phase === 'countdown' ? '准备，下一首马上开始' : current?.title ?? (playerMode === 'listen' ? '选择一种方式开始听歌' : '开启连续随机舞蹈')}</h2><p>{phase === 'countdown' ? '倒计时结束后自动抽取并播放' : current ? playerMode === 'listen' ? `${current.artist} · 完整播放` : `${current.artist} · 随舞片段 ${formatSeconds(chorusWindow(current).start)}–${formatSeconds(chorusWindow(current).end)}` : playerMode === 'listen' ? '完整播放曲库中的每一首歌' : '每首片段结束后，倒数 5 秒自动进入下一首'}</p>{playerMode === 'listen' && current && phase !== 'countdown' && <div className="listen-progress"><span>{formatSeconds(playbackPosition)}</span><input aria-label="调整当前歌曲播放位置" type="range" min="0" max={Math.max(trackDuration, 1)} step="0.1" value={Math.min(playbackPosition, Math.max(trackDuration, 1))} onChange={(event) => seekListening(Number(event.target.value))}/><span>{formatSeconds(trackDuration)}</span></div>}<div className="player-controls">{playerMode === 'listen' ? <button className="icon-btn" onClick={() => void previousListenTrack()} title="上一首"><SkipBack/></button> : <button className="icon-btn" onClick={startCountdown} title="开始连续随机舞蹈"><Shuffle/></button>}<button className="play-main" onClick={() => void toggleSession()} title={playing || phase === 'countdown' ? '暂停' : '开始或继续'}>{phase === 'countdown' || playing ? <Pause/> : <Play/>}</button>{playerMode === 'listen' ? <button className="icon-btn" onClick={() => void nextListenTrack(true)} title="下一首"><SkipForward/></button> : <button className="icon-btn" onClick={startCountdown} title="跳过并倒计时下一首"><RefreshCw/></button>}<span className={`session-status ${sessionActive ? 'active' : ''}`}><i/>{sessionActive ? phase === 'countdown' ? '倒计时中' : playerMode === 'listen' ? listenMode === 'shuffle' ? '随机播放中' : listenMode === 'sequential' ? '顺序播放中' : '单曲循环中' : '连续随舞中' : '已暂停'}</span></div>{current && phase !== 'countdown' && playerMode === 'dance' && <div className="memory-actions"><button onClick={() => mark('remembered')} className={current.status === 'remembered' ? 'active' : ''}><Check/>记得</button><button onClick={() => mark('review')} className={current.status === 'review' ? 'active' : ''}><RotateCcw/>要复习</button></div>}</div>
      <audio ref={audioRef} src={audioUrl ?? undefined} preload="auto" loop={playerMode === 'listen' && listenMode === 'single'} onCanPlay={() => void playPendingTrack()} onLoadedMetadata={handleMetadata} onTimeUpdate={handleTimeUpdate} onEnded={handleEnded} onPause={() => setPlaying(false)} onPlay={() => setPlaying(true)}/>
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
    <div className="clip-actions"><button className="secondary-btn compact" type="button" onClick={previewClip}><Play/>试听片段</button><button className="primary-btn compact" type="button" onClick={() => onSave({ ...track, chorusStart: Math.round(start), chorusEnd: Math.round(end) })}><Save/>保存片段</button></div>
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
      const blobKey = (await saveMedia(file)).id
      onAdd({ id: crypto.randomUUID(), title: title.trim(), artist: artist.trim(), tag, source: 'local', blobKey, status: 'new' })
    } catch { setError('音频保存失败，请检查浏览器存储空间后重试。') }
  }
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><form className="form-modal track-form" onSubmit={submit}><button className="modal-close" type="button" onClick={onClose}><X/></button><span className="eyebrow">Add track</span><h2>添加到随机舞蹈库</h2><div className="form-grid"><label>歌曲名<input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：Supernova"/></label><label>艺人<input required value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="例如：aespa"/></label></div><label>舞蹈标签<select value={tag} onChange={(e) => setTag(e.target.value)}><option>K-pop</option><option>女团舞</option><option>男团舞</option><option>Jazz</option><option>Choreography</option></select></label><label>本地音频（MP3 / M4A / WAV）<span className="file-field"><Upload/>{file ? file.name : '选择可正常播放的音频'}<input required type="file" accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/wav" onChange={(e) => setFile(e.target.files?.[0] ?? null)}/></span></label><p className="form-note">音频仅保存在当前设备，用于训练和随机舞蹈直接播放。</p>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-btn full" type="submit"><Plus/>加入曲库</button></form></div>
}

export default App
