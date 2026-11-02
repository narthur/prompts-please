// The Obsidian vault: where the daily ledger note lands.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Overwrite the day's note; it's regenerated from the ledger, so rewriting is safe. */
export function writeDailySummary(summaryDir: string, date: string, markdown: string): void {
  mkdirSync(summaryDir, { recursive: true })
  writeFileSync(join(summaryDir, `${date}.md`), markdown)
}
