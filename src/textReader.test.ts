import { describe, expect, it } from 'vitest';
import { normalizeText, TextReader } from './textReader';
import type { TextLine } from './types';

const line = (text: string, score = 0.98): TextLine => ({ text, score, direction: '中间', box: [0.2, 0.2, 0.8, 0.4] });

describe('OCR narration', () => {
  it('deduplicates spacing, punctuation and full-width characters', () => {
    expect(normalizeText(' ＥＸＩＴ：出口！ ')).toBe('exit出口');
    const reader = new TextReader();
    reader.observe([line('中山路')], 0);
    const message = reader.next(0)!;
    expect(message.text).toContain('中间写着「中山路」');
    reader.commit(message, 0);
    reader.observe([line('中 山 路！')], 4000);
    expect(reader.next(4000)).toBeNull();
  });

  it('requires confirmation for medium confidence and ignores weak text', () => {
    const reader = new TextReader();
    reader.observe([line('出口', 0.82), line('乱字', 0.6)], 0);
    expect(reader.next(0)).toBeNull();
    reader.observe([line('出口', 0.84)], 3000);
    expect(reader.next(3000)?.text).toContain('出口');
    expect(reader.next(3000)?.text).not.toContain('乱字');
  });

  it('does not mistake duplicate boxes in one frame for repeated confirmation', () => {
    const reader = new TextReader();
    reader.observe([line('出口', 0.82), line('出口', 0.83)], 0);
    expect(reader.next(0)).toBeNull();
  });

  it('suppresses a minor spelling flicker but reads changed sign contents', () => {
    const reader = new TextReader();
    reader.observe([line('请从前方出口通行')], 0);
    reader.commit(reader.next(0)!, 0);
    reader.observe([line('请从前方出囗通行')], 4000);
    expect(reader.next(4000)).toBeNull();
    reader.observe([line('禁止通行')], 8000);
    expect(reader.next(8000)?.text).toContain('禁止通行');
  });

  it('expires unseen pending text and does not repeat a continuously visible sign', () => {
    const reader = new TextReader();
    reader.observe([line('出口')], 0);
    expect(reader.next(16000)).toBeNull();
    reader.observe([line('出口')], 17000);
    reader.commit(reader.next(17000)!, 17000);
    reader.observe([line('出口')], 50000);
    reader.observe([line('出口')], 90000);
    expect(reader.next(100000)).toBeNull();
  });

  it('marks only the manually spoken lines and leaves others pending', () => {
    const reader = new TextReader();
    reader.observe([line('出口'), line('中山路')], 0);
    reader.markRead([line('出口')], 0);
    expect(reader.next(2000)).toBeNull();
    expect(reader.next(4000)?.text).toContain('中山路');
    expect(reader.next(4000)?.text).not.toContain('出口');
  });
});
