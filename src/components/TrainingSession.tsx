import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronLeft, ChevronRight, Music2, Pause, Play, RotateCcw, X } from 'lucide-react'
import { getMedia } from '../services/storage'
import type { AssistantResult, Exercise, MusicTrack } from '../types'

type SessionPhase = 'countdown' | 'running' | 'paused' | 'complete'

function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.max(0, totalSeconds % 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function stableTrackOrder(tracks: MusicTrack[], seed: string) {
  const score = (value: string) => {
    let hash = 2166136261
    for (const character of `${seed}:${value}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
    return hash >>> 0
  }
  return [...tracks].sort((a, b) => score(a.id) - score(b.id))
}

export function TrainingSession({ result, exercises, tracks, onClose, onComplete, notify }: {
  result: AssistantResult
  exercises: Exercise[]
  tracks: MusicTrack[]
  onClose: () => void
  onComplete: (exerciseIds: string[]) => void
  notify: (message: string) => void
}) {
  const steps = useMemo(() => (result.plan?.exerciseIds ?? [])
    .map((id) => exercises.find((exercise) => exercise.id === id))
    .filter((exercise): exercise is Exercise => Boolean(exercise))
    .map((exercise) => ({ ...exercise, minutes: result.plan?.exerciseMinutes?.[exercise.id] ?? exercise.minutes })), [exercises, result.plan?.exerciseIds, result.plan?.exerciseMinutes])
  const planSeconds = steps.reduce((sum, step) => sum + step.minutes * 60, 0)
  const trackQueue = useMemo(() => {
    const planned = (result.plan?.trackIds ?? [])
      .map((id) => tracks.find((track) => track.id === id))
      .filter(Boolean) as MusicTrack[]
    if (planned.length) return planned
    const available = stableTrackOrder(tracks.filter((track) => track.audioUrl || track.blobKey), result.id)
    const queue: MusicTrack[] = []
    let coverage = 0
    let index = 0
    while (available.length && coverage < planSeconds && index < 100) {
      const track = available[index % available.length]
      queue.push(track)
      coverage += track.durationSeconds ?? 0
      index += 1
      if (!track.durationSeconds) break
    }
    return queue
  }, [planSeconds, result.id, result.plan?.trackIds, tracks])
  const [stepIndex, setStepIndex] = useState(0)
  const [pendingStepIndex, setPendingStepIndex] = useState(0)
  const [secondsLeft, setSecondsLeft] = useState(() => (steps[0]?.minutes ?? 0) * 60)
  const [phase, setPhase] = useState<SessionPhase>('countdown')
  const [countdown, setCountdown] = useState(5)
  const [trackIndex, setTrackIndex] = useState(0)
  const track = trackQueue[trackIndex] ?? null
  const [blobAudio, setBlobAudio] = useState<{ trackId: string; url: string } | null>(null)
  const soundUrl = track?.audioUrl ?? (blobAudio?.trackId === track?.id ? blobAudio.url : null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const countdownAudioRef = useRef<HTMLAudioElement>(null)
  const completedRef = useRef(false)
  const current = steps[stepIndex]
  const next = steps[stepIndex + 1]
  const currentTotal = (current?.minutes ?? 0) * 60
  const completedSeconds = steps.slice(0, stepIndex).reduce((sum, step) => sum + step.minutes * 60, 0)
  const musicCoverageSeconds = trackQueue.reduce((sum, item) => sum + (item.durationSeconds ?? 0), 0)
  const elapsedSeconds = completedSeconds + Math.max(0, currentTotal - secondsLeft)
  const overallProgress = planSeconds ? Math.min(100, elapsedSeconds / planSeconds * 100) : 0

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [])

  useEffect(() => {
    let active = true
    let objectUrl: string | null = null
    if (track?.blobKey) {
      getMedia(track.blobKey).then((media) => {
        if (!active || !media) return
        objectUrl = URL.createObjectURL(media.blob)
        setBlobAudio({ trackId: track.id, url: objectUrl })
      })
    }
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [track?.audioUrl, track?.blobKey, track?.id])

  useEffect(() => {
    const audio = countdownAudioRef.current
    if (!audio) return
    audio.playbackRate = 1.28
    void audio.play().catch(() => undefined)
  }, [])

  useEffect(() => {
    if (phase !== 'countdown' || !steps.length) return
    const timer = window.setTimeout(async () => {
      if (countdown > 1) {
        setCountdown(countdown - 1)
        return
      }
      setStepIndex(pendingStepIndex)
      setSecondsLeft(steps[pendingStepIndex].minutes * 60)
      if (track && soundUrl && audioRef.current) {
        try {
          if (pendingStepIndex === 0 && stepIndex === 0) audioRef.current.currentTime = 0
          await audioRef.current.play()
        } catch {
          setPhase('paused')
          notify('浏览器阻止了自动播放，请点击继续按钮')
          return
        }
      } else if (track) {
        setPhase('paused')
        notify('计划歌曲不可用，请点击继续或检查音频文件')
        return
      }
      setPhase('running')
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [countdown, notify, pendingStepIndex, phase, soundUrl, stepIndex, steps, track])

  useEffect(() => {
    if (phase !== 'running' || !steps.length) return
    const timer = window.setTimeout(() => {
      if (secondsLeft > 1) {
        setSecondsLeft(secondsLeft - 1)
        return
      }
      if (stepIndex < steps.length - 1) {
        const nextIndex = stepIndex + 1
        audioRef.current?.pause()
        setPendingStepIndex(nextIndex)
        setCountdown(5)
        setPhase('countdown')
        if (countdownAudioRef.current) {
          countdownAudioRef.current.currentTime = 0
          countdownAudioRef.current.playbackRate = 1.28
          void countdownAudioRef.current.play().catch(() => undefined)
        }
        return
      }
      audioRef.current?.pause()
      setPhase('complete')
      if (!completedRef.current) {
        completedRef.current = true
        onComplete(steps.map((step) => step.id))
      }
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [onComplete, phase, secondsLeft, stepIndex, steps])

  const handleTrackEnded = () => {
    if (phase !== 'running') return
    if (trackIndex < trackQueue.length - 1) {
      setTrackIndex((index) => index + 1)
      return
    }
    if (audioRef.current) {
      audioRef.current.currentTime = 0
      void audioRef.current.play().catch(() => notify('下一首歌曲无法自动播放，请点击继续'))
    }
  }

  const close = () => {
    audioRef.current?.pause()
    countdownAudioRef.current?.pause()
    onClose()
  }

  const togglePlayback = async () => {
    if (phase === 'running') {
      audioRef.current?.pause()
      setPhase('paused')
      return
    }
    if (track && soundUrl && audioRef.current) {
      try {
        await audioRef.current.play()
      } catch {
        notify('歌曲仍无法播放，请检查浏览器声音权限')
        return
      }
    }
    setPhase('running')
  }

  const moveTo = (index: number) => {
    const safeIndex = Math.min(steps.length - 1, Math.max(0, index))
    audioRef.current?.pause()
    setPendingStepIndex(safeIndex)
    setCountdown(5)
    setPhase('countdown')
    if (countdownAudioRef.current) {
      countdownAudioRef.current.currentTime = 0
      countdownAudioRef.current.playbackRate = 1.28
      void countdownAudioRef.current.play().catch(() => undefined)
    }
  }

  const restart = () => {
    completedRef.current = false
    setTrackIndex(0)
    if (audioRef.current) audioRef.current.currentTime = 0
    moveTo(0)
  }

  return createPortal(<div className="training-session-layer" role="dialog" aria-modal="true" aria-label="执行训练计划">
    <audio ref={audioRef} src={soundUrl ?? undefined} preload="auto" onCanPlay={() => { if (phase === 'running') void audioRef.current?.play().catch(() => undefined) }} onEnded={handleTrackEnded}/>
    <audio ref={countdownAudioRef} src={`${import.meta.env.BASE_URL}assets/music/countdown-5s.mp3?v=2`} preload="auto"/>
    <header className="session-topbar">
      <div><span>Agent live session</span><strong>{result.title}</strong></div>
      <button onClick={close} aria-label="退出训练" title="退出训练"><X/></button>
    </header>

    {phase === 'complete' ? <main className="session-complete">
      <span><Check/></span>
      <small>TRAINING COMPLETE</small>
      <h2>这一轮完成了</h2>
      <p>{steps.length} 组动作 · {result.plan?.totalMinutes ?? Math.round(planSeconds / 60)} 分钟</p>
      <button className="session-primary" onClick={close}><Check/>完成并返回</button>
    </main> : <main className="session-stage">
      <section className="session-music">
        <span className={phase === 'running' ? 'playing' : ''}><Music2/></span>
        <div><small>完整歌曲 {trackQueue.length ? `${trackIndex + 1} / ${trackQueue.length}` : ''}</small><strong>{track?.title ?? '无可用歌曲'}</strong><em>{track ? `${track.artist} · ${formatTime(track.durationSeconds ?? 0)}` : '仅显示动作提示'} · 计划 {formatTime(planSeconds)} / 歌曲覆盖 {formatTime(musicCoverageSeconds)}</em></div>
      </section>

      {phase === 'countdown' ? <section className="session-focus session-countdown" aria-live="assertive" key={`countdown-${pendingStepIndex}`}>
        <div className="session-step-label"><span>{pendingStepIndex === 0 ? '计划即将开始' : '准备下一组'}</span><em>第 {pendingStepIndex + 1} / {steps.length} 组</em></div>
        <strong className="session-countdown-number" key={countdown}>{countdown}</strong>
        <h1>{steps[pendingStepIndex]?.name}</h1>
        <p>听倒计时准备，结束后自动开始这一组。</p>
        <div className="session-beats countdown-beats" aria-hidden="true">{Array.from({ length: 8 }, (_, index) => <i key={index}>{index + 1}</i>)}</div>
      </section> : <section className="session-focus" aria-live="polite" key={current?.id}>
        <div className="session-step-label"><span>第 {stepIndex + 1} / {steps.length} 组</span><em>{current?.category}</em></div>
        <h1>{current?.name ?? '计划中没有可执行动作'}</h1>
        <p>{current?.cue}</p>
        <div className="session-beats" aria-hidden="true">{Array.from({ length: 8 }, (_, index) => <i key={index}>{index + 1}</i>)}</div>
        <strong className="session-clock">{formatTime(secondsLeft)}</strong>
        <small className="session-state">{phase === 'paused' ? '已暂停' : '保持节奏，完成这一组'}</small>
      </section>}

      <section className="session-next">
        <span>下一组</span><strong>{next?.name ?? '完成训练'}</strong><small>{next ? `${next.minutes} 分钟` : '结束后自动记录完成'}</small>
      </section>

      <div className="session-progress"><i style={{ width: `${overallProgress}%` }}/></div>
      <div className="session-step-dots" aria-label="计划进度">{steps.map((step, index) => <span key={step.id} className={index < stepIndex ? 'done' : index === stepIndex ? 'active' : ''}>{index + 1}</span>)}</div>

      <footer className="session-controls">
        <button onClick={() => moveTo(stepIndex - 1)} disabled={phase === 'countdown' || stepIndex === 0} aria-label="上一组" title="上一组"><ChevronLeft/></button>
        <button className="session-play" onClick={() => void togglePlayback()} disabled={phase === 'countdown'}>{phase === 'running' ? <Pause/> : <Play/>}<span>{phase === 'countdown' ? '准备' : phase === 'running' ? '暂停' : '继续'}</span></button>
        <button onClick={() => moveTo(stepIndex + 1)} disabled={phase === 'countdown' || stepIndex === steps.length - 1} aria-label="下一组" title="下一组"><ChevronRight/></button>
        <button onClick={restart} aria-label="重新开始" title="重新开始"><RotateCcw/></button>
      </footer>
    </main>}
  </div>, document.body)
}
