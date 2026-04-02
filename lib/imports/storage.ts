import { mkdir, writeFile, readFile, unlink } from "node:fs/promises"
import { join, basename } from "node:path"

export function getImportFilesRoot(): string {
  const rel = process.env.IMPORT_FILES_DIR?.trim() || ".data/imports"
  return join(process.cwd(), rel)
}

export function sanitizeOriginalName(name: string): string {
  const base = basename(name).replace(/[^a-zA-Z0-9._\- ]/g, "_").slice(0, 200)
  return base.length > 0 ? base : "upload"
}

export async function writeImportFile(
  batchId: string,
  fileId: string,
  originalName: string,
  body: Buffer,
): Promise<string> {
  const dir = join(getImportFilesRoot(), batchId)
  await mkdir(dir, { recursive: true })
  const safe = sanitizeOriginalName(originalName)
  const relative = join(batchId, `${fileId}_${safe}`)
  const absolute = join(getImportFilesRoot(), relative)
  await writeFile(absolute, body)
  return relative
}

export async function readImportFile(storagePath: string): Promise<Buffer> {
  const absolute = join(getImportFilesRoot(), storagePath)
  return readFile(absolute)
}

export async function deleteImportFile(storagePath: string): Promise<void> {
  try {
    const absolute = join(getImportFilesRoot(), storagePath)
    await unlink(absolute)
  } catch {
    // ignore missing
  }
}
