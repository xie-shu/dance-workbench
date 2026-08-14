import type { Exercise, MusicTrack } from './types'

export const initialExercises: Exercise[] = [
  { id: 'head', name: '头部四向平移与绕圈', category: '基本动作与分离', minutes: 1, level: '基础', cue: '肩膀锁住，视线保持水平，动作走满。' },
  { id: 'shoulder', name: '提肩、绕肩与 rolling', category: '基本动作与分离', minutes: 2, level: '基础', cue: '先做单侧控制，再连接成流畅圆周。' },
  { id: 'chest', name: '胸部平移与 wave', category: '基本动作与分离', minutes: 2, level: '基础', cue: '核心稳定，胸口画十字后再画圆。' },
  { id: 'hip', name: '胯部八字与 rolling', category: '基本动作与分离', minutes: 2, level: '基础', cue: '膝盖保持弹性，避免用腰硬甩。' },
  { id: 'combo', name: '肩 + 胸 + 胯 isolation 组合', category: '身体协调组合', minutes: 3, level: '进阶', cue: '慢速拆分，再跟随 90–110 BPM 连接。' },
  { id: 'coordination', name: '手脚协调训练', category: '身体协调组合', minutes: 3, level: '进阶', cue: '先脚后手，最后加入头部方向和视线。' },
  { id: 'walk', name: '站姿、爵士步与胯部摆动', category: '爵士舞基本步伐', minutes: 2, level: '基础', cue: '膝盖微屈、核心收紧，行走保持流畅。' },
  { id: 'kick', name: '前踢与旁踢控制', category: '爵士舞基本步伐', minutes: 2, level: '基础', cue: '控制落腿，不甩腿，脚背和膝盖方向清楚。' },
  { id: 'pivot', name: 'Pivot 转胯步', category: '爵士舞基本步伐', minutes: 2, level: '基础', cue: '先完成重心转换，再加入胯部转动。' },
  { id: 'turn', name: '平转与爵士转', category: '旋转与平衡', minutes: 3, level: '进阶', cue: '定点留头，收紧核心，结束位置站稳。' },
  { id: 'balance', name: '单脚平衡', category: '旋转与平衡', minutes: 1, level: '基础', cue: '足底三点着力，视线定点，骨盆保持中立。' },
  { id: 'groove', name: '身体 Wave 与 Groove', category: 'Wave 与律动', minutes: 3, level: '基础', cue: '跟随重拍上下弹动，再加入前 wave 和侧 wave。' },
]

const localTrack = (id: string, title: string, artist: string, fileName: string, durationSeconds: number, chorusStart: number, chorusEnd: number, review = false): MusicTrack => ({
  id: `local-${id}`,
  title,
  artist,
  tag: '本地曲库',
  source: 'local',
  audioUrl: `${import.meta.env.BASE_URL}assets/music/${fileName}`,
  durationSeconds,
  chorusStart,
  chorusEnd,
  status: review ? 'review' : 'new',
})

export const initialTracks: MusicTrack[] = [
  localTrack('dreams-come-true', 'Dreams Come True', 'aespa', 'dreams-come-true.mp3', 203, 52, 84, true),
  localTrack('style', 'STYLE', 'Hearts2Hearts', 'style.mp3', 211, 48, 80),
  localTrack('whiplash', 'Whiplash', 'aespa', 'whiplash.mp3', 191, 43, 75, true),
  localTrack('thirsty', 'Thirsty', 'aespa', 'thirsty.mp3', 192, 48, 80, true),
  localTrack('what-is-love', 'What is Love?', 'TWICE', 'what-is-love.mp3', 73, 40, 70, true),
  localTrack('yes-or-yes', 'YES or YES', 'TWICE', 'yes-or-yes.mp3', 240, 52, 84),
  localTrack('moonlight-sunrise', 'MOONLIGHT SUNRISE', 'TWICE', 'moonlight-sunrise.mp3', 181, 42, 74, true),
]
