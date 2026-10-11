import type { TextLine } from './types';

export function normalizeText(text: string) {
  return text.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}

function similar(a: string, b: string) {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 6 || Math.abs(a.length - b.length) > 2) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const row = [i + 1];
    for (let j = 0; j < b.length; j++) row.push(Math.min(row[j] + 1, previous[j + 1] + 1, previous[j] + Number(a[i] !== b[j])));
    previous = row;
  }
  return previous[b.length] / Math.max(a.length, b.length) <= 0.15;
}

interface Entry { key: string; line: TextLine; hits: number; lastSeen: number; spoken: boolean }
export interface TextMessage { text: string; keys: string[] }

export function describeText(lines: TextLine[]) {
  return lines.length ? '读到文字，' + lines.slice(0, 3)
    .map(line => `${line.direction}写着「${line.text.slice(0, 32)}」`).join('；') + '。' : '';
}

export class TextReader {
  private entries = new Map<string, Entry>();
  private lastSpoken = -Infinity;

  observe(lines: TextLine[], now: number) {
    for (const [key, entry] of this.entries) if (now - entry.lastSeen > 60000) this.entries.delete(key);
    const seen = new Set<string>();
    for (const line of lines) {
      const normalized = normalizeText(line.text);
      if (line.score < 0.75 || normalized.length < 2 || !/[\p{L}\p{N}]/u.test(normalized)) continue;
      const entry = [...this.entries.values()].find(e => similar(e.key, normalized));
      const key = entry?.key ?? normalized;
      if (seen.has(key)) continue;
      seen.add(key);
      if (entry) {
        entry.hits = now - entry.lastSeen > 15000 ? 1 : entry.hits + 1;
        if (line.score >= entry.line.score || normalizeText(line.text) === entry.key) entry.line = line;
        entry.lastSeen = now;
      } else this.entries.set(key, { key, line, hits: 1, lastSeen: now, spoken: false });
    }
  }

  next(now: number): TextMessage | null {
    if (now - this.lastSpoken < 3000) return null;
    const pending = [...this.entries.values()]
      .filter(e => !e.spoken && now - e.lastSeen < 15000 && (e.line.score >= 0.9 || e.hits >= 2))
      .sort((a, b) => b.line.score - a.line.score).slice(0, 3);
    return pending.length ? { text: describeText(pending.map(e => e.line)), keys: pending.map(e => e.key) } : null;
  }

  commit(message: TextMessage, now: number) {
    for (const key of message.keys) { const entry = this.entries.get(key); if (entry) entry.spoken = true; }
    this.defer(now);
  }

  markRead(lines: TextLine[], now: number) {
    for (const line of lines) {
      const entry = [...this.entries.values()].find(e => similar(e.key, normalizeText(line.text)));
      if (entry) entry.spoken = true;
    }
    this.defer(now);
  }

  defer(now: number) { this.lastSpoken = now; }
}
