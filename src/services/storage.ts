import { openDB } from 'idb'
import type { StoredMedia } from '../types'

const DB_NAME = 'krabby-dance-workbench'
const STORE = 'media'

const database = openDB(DB_NAME, 1, {
  upgrade(db) {
    if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
  },
})

export async function saveMedia(file: File): Promise<StoredMedia> {
  const media: StoredMedia = {
    id: crypto.randomUUID(),
    name: file.name,
    type: file.type,
    size: file.size,
    createdAt: new Date().toISOString(),
    blob: file,
  }
  const db = await database
  await db.put(STORE, media)
  return media
}

export async function getMedia(id: string): Promise<StoredMedia | undefined> {
  const db = await database
  return db.get(STORE, id)
}

export async function listMedia(prefix: 'audio' | 'video'): Promise<StoredMedia[]> {
  const db = await database
  const all = await db.getAll(STORE) as StoredMedia[]
  return all.filter((item) => item.type.startsWith(prefix)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function removeMedia(id: string) {
  const db = await database
  await db.delete(STORE, id)
}

export function readLocal<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return value ? JSON.parse(value) as T : fallback
  } catch {
    return fallback
  }
}

export function writeLocal<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value))
}
