import type { AnalysisReport, Exercise, MusicTrack } from './types'

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

const localTrack = (id: string, title: string, artist: string, fileName: string, chorusStart: number, chorusEnd: number, review = false): MusicTrack => ({
  id: `local-${id}`,
  title,
  artist,
  tag: '本地曲库',
  source: 'local',
  audioUrl: `${import.meta.env.BASE_URL}assets/music/${fileName}`,
  chorusStart,
  chorusEnd,
  status: review ? 'review' : 'new',
})

export const initialTracks: MusicTrack[] = [
  localTrack('dreams-come-true', 'Dreams Come True', 'aespa', 'dreams-come-true.mp3', 52, 84, true),
  localTrack('style', 'STYLE', 'Hearts2Hearts', 'style.mp3', 48, 80),
  localTrack('whiplash', 'Whiplash', 'aespa', 'whiplash.mp3', 43, 75, true),
  localTrack('thirsty', 'Thirsty', 'aespa', 'thirsty.mp3', 48, 80, true),
  localTrack('what-is-love', 'What is Love?', 'TWICE', 'what-is-love.mp3', 40, 70, true),
  localTrack('yes-or-yes', 'YES or YES', 'TWICE', 'yes-or-yes.mp3', 52, 84),
  localTrack('moonlight-sunrise', 'MOONLIGHT SUNRISE', 'TWICE', 'moonlight-sunrise.mp3', 42, 74, true),
]

const sharedSections = [
  {
    id: 'expression',
    title: '表情与神态管理',
    summary: '表情跟随段落能量变化，而不是从头到尾保持同一个笑容。',
    bullets: ['主歌收住下巴，用眼神跟随手部方向', '副歌重拍前半拍锁定镜头，动作落点再释放表情', '避免频繁看地面、抿嘴和无意识皱眉'],
  },
  {
    id: 'camera',
    title: '镜头、灯光与背景',
    summary: '机位略低于胸口，给腿部动作留足空间。',
    bullets: ['使用正面主机位，副歌可加入一次轻微推近', '柔光放在正前方偏 30°，避免顶光压眼窝', '背景减少杂物，人物与背景至少拉开 1.5 米'],
  },
  {
    id: 'viral',
    title: '爆款逻辑与翻拍策略',
    summary: '记忆动作清晰、造型对比强，前 3 秒即可识别歌曲。',
    bullets: ['还原版：保留开头定格、原版手势和副歌第一组走位', '个人版：增加工科研究生日常切入，副歌切换完整舞台造型', '标题先写歌名与舞蹈挑战，再补个人特色关键词'],
  },
  {
    id: 'practice',
    title: '练习与发布清单',
    summary: '先解决节拍和重心，再叠加表情、服装与镜头。',
    bullets: ['0.5 倍速练段落连接，每段连续成功 3 次再提速', '录一遍固定机位检查动作边界和表情', '标签建议：#KPOP随机舞蹈 #练舞日记 #舞蹈翻跳'],
  },
]

export function createDemoReport(kind: 'jazz' | 'kpop' | 'custom', videoName: string): AnalysisReport {
  const jazz = kind !== 'kpop'
  return {
    id: crypto.randomUUID(),
    videoName,
    videoKind: kind,
    createdAt: new Date().toISOString(),
    bpm: jazz ? '约 104 BPM' : '约 118 BPM',
    style: jazz ? 'Jazz Choreography · 甜酷律动' : 'K-pop · 强节拍女团编舞',
    sections: [
      {
        id: 'dance',
        title: '音乐风格特征',
        summary: jazz ? '中速律动、切分重拍和带有 R&B 质感的低频，决定了这支舞的松弛甜酷。' : '强重拍、电子音色和逐段抬升的能量，决定了这支舞的女团冲击力。',
        bullets: jazz
          ? ['约 104 BPM；重拍清晰但不急，适合做延迟半拍的律动', '主歌留白较多，副歌通过低频与鼓点把动作幅度推高', '听感关键词：甜酷、松弛、切分、低频弹性；不能只按满拍跳']
          : ['约 118 BPM；四拍重心明确，副歌前有明显能量抬升', '电子鼓点与短促音色制造切点，适合定格、方向切换和齐舞感', '听感关键词：强势、利落、舞台感；优先抓副歌第一拍'],
      },
      {
        id: 'dance',
        title: '舞蹈风格特征',
        summary: jazz ? '重心压低、胯部律动与干净手线是这支舞的辨识点。' : '动作依靠强重拍、快速方向切换和副歌记忆手势建立冲击力。',
        bullets: jazz
          ? ['动作语言：isolation、groove 和延迟落点，身体像被低频牵引', '发力顺序：先重心和胸胯，再补手线、眼神与停顿', '不能改：副歌第一拍定格与标志性手势；转身可先简化']
          : ['动作语言：清晰手势、快速换向、重拍定格和副歌记忆点', '发力顺序：先脚下重心，再叠上身角度与队形方向', '不能改：手势方向、重拍落点和副歌记忆动作'],
      },
      {
        id: 'music-dance-fit',
        title: '音乐 × 舞蹈如何配合',
        summary: jazz ? '音乐的松弛切分对应身体的延迟和回弹，动作不需要每一拍都打满。' : '音乐的强拍与动作定格形成同步冲击，副歌需要把幅度和速度同时拉满。',
        bullets: jazz
          ? ['练习先听鼓点：在 2、4 拍找到落点，再加入胸胯和手部细节', '镜头前保留半拍呼吸，才能让 groove 看起来有弹性', '如果跳得太满，会失去原曲的留白和甜酷质感']
          : ['练习先数 1-8：把副歌第一拍、切点和方向变化标成记号', '动作落点要短而清楚，结束后马上收回准备下一次重拍', '如果只做上身，会丢掉 K-pop 的脚下推进和队形感'],
      },
      {
        id: 'styling',
        title: '穿搭与妆造方案',
        summary: jazz ? '用短款上装和高腰下装强调胸胯线条。' : '清晰肩线和金属细节更能接住女团舞的力度。',
        bullets: jazz
          ? ['复刻版：莓粉短上衣、深色阔腿裤、银色耳饰、半扎高马尾', '改良平替：修身背心叠轻薄衬衫、高腰工装裤、运动鞋', '避雷：上下装同时宽松，会吃掉 isolation 和腰线']
          : ['复刻版：短款夹克、百褶短裙、安全裤、银色配饰', '改良平替：合身短 T、高腰直筒裤、厚底运动鞋', '避雷：反光面料面积过大，补光后容易过曝'],
      },
      ...sharedSections,
    ],
  }
}
