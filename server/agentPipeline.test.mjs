import test from 'node:test'
import assert from 'node:assert/strict'
import { testInternals } from './index.mjs'

const tracks = [
  { id: 'style', title: 'STYLE', artist: 'Hearts2Hearts', status: 'new', durationSeconds: 211, chorusStart: 48, chorusEnd: 80, audioUrl: '/style.m4a' },
  { id: 'whiplash', title: 'Whiplash', artist: 'aespa', status: 'review', durationSeconds: 191, chorusStart: 43, chorusEnd: 75, audioUrl: '/whiplash.m4a' },
  { id: 'thirsty', title: 'Thirsty', artist: 'aespa', status: 'review', durationSeconds: 192, chorusStart: 48, chorusEnd: 80, audioUrl: '/thirsty.m4a' },
]

test('recognizes Chinese track counts and routes dance plans', () => {
  assert.equal(testInternals.parseChineseInteger('三'), 3)
  assert.equal(testInternals.deterministicSkillHint('给我生成三首随舞计划', { tracks }), 'random-dance-plan')
  const plan = testInternals.buildDancePlan('给我生成三首随舞计划', { tracks }, 'seed')
  assert.equal(plan.selected.length, 3)
  assert.equal(plan.sessionDurationSeconds, 111)
})

test('routes private facts through their dedicated skills', () => {
  assert.equal(testInternals.deterministicSkillHint('我的曲库有多少首歌？', { tracks }), 'music-library-query')
  assert.equal(testInternals.deterministicSkillHint('今天的计划完成了多少？', {}), 'training-context-query')
  assert.equal(testInternals.deterministicSkillHint('你记得我的旧伤吗？', {}), 'memory-query')
})

test('keeps each exercise between one and three minutes', () => {
  const exercises = [
    { id: 'a', minutes: 1 },
    { id: 'b', minutes: 2 },
    { id: 'c', minutes: 3 },
  ]
  const allocation = testInternals.allocateExerciseMinutes(exercises, 7)
  assert.equal(allocation.totalMinutes, 7)
  assert.ok(Object.values(allocation.exerciseMinutes).every((minutes) => minutes >= 1 && minutes <= 3))
})

test('music queue covers the requested fundamentals duration', () => {
  const queue = testInternals.seededTrackQueue(tracks, 6 * 60, 'seed')
  assert.ok(queue.durationSeconds >= 6 * 60)
  assert.ok(queue.trackIds.length >= 2)
})

test('parses fenced router JSON safely', () => {
  assert.deepEqual(testInternals.parseJsonObject('```json\n{"skillId":"general-chat","confidence":0.8}\n```'), {
    skillId: 'general-chat',
    confidence: 0.8,
  })
  assert.equal(testInternals.parseJsonObject('not json'), null)
})
