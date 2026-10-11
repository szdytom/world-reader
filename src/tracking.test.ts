import { describe, expect, it } from 'vitest';
import { directionFor } from './scene';
import { describeChanges, ObjectTracker, SceneReader } from './tracking';
import type { Detection } from './types';

const object = (center: number, name = 'person', label = '人'): Detection => ({
  name, label, direction: directionFor(center), confidence: 0.9, color: '#fff',
  box: [center - 0.08, 0.2, center + 0.08, 0.6],
});

describe('cross-frame scene reading', () => {
  it('keeps two same-class identities when detection order changes', () => {
    const tracker = new ObjectTracker();
    const left = object(0.2), right = object(0.8);
    expect(tracker.update([left, right], 0)).toEqual([]);
    const previous = tracker.update([left, right], 800);
    const current = tracker.update([object(0.79), object(0.21)], 1600);
    expect(current.map(d => d.id)).toEqual(previous.map(d => d.id));
    expect(current[0].box[0]).toBeCloseTo(0.13);
    expect(describeChanges(previous, current)).toBe('');
  });

  it('tolerates temporary missed detections but eventually reports disappearance', () => {
    const tracker = new ObjectTracker();
    tracker.update([object(0.2)], 0);
    const before = tracker.update([object(0.2)], 800);
    expect(describeChanges(before, tracker.update([], 2000))).toBe('');
    expect(describeChanges(before, tracker.update([], 4400))).toBe('左侧不再看到人。');
  });

  it('does not announce a single-frame false positive', () => {
    const tracker = new ObjectTracker();
    tracker.update([object(0.2)], 0);
    expect(tracker.update([], 1000)).toEqual([]);
    expect(tracker.update([], 4000)).toEqual([]);
  });

  it('suppresses boundary jitter and reports a sustained position change', () => {
    const tracker = new ObjectTracker();
    tracker.update([object(0.31)], 0);
    const before = tracker.update([object(0.31)], 800);
    expect(describeChanges(before, tracker.update([object(0.35)], 1600))).toBe('');
    expect(describeChanges(before, tracker.update([object(0.4)], 2400))).toBe('');
    const after = tracker.update([object(0.42)], 3600);
    expect(after[0].id).toBe(before[0].id);
    expect(describeChanges(before, after)).toBe('人从画面左侧移到中间。');
  });

  it('reads confirmed objects even when another object flickers every frame', () => {
    const reader = new SceneReader();
    reader.observe([object(0.2)], 0);
    reader.observe([object(0.2), object(0.8, 'bottle', '瓶子')], 800);
    expect(reader.next(1000)).toBe('画面中，左侧有人。');
    reader.commit(1000);
    reader.observe([object(0.2)], 1600);
    expect(reader.next(4000)).toBe('');
    reader.observe([object(0.2), object(0.8, 'laptop', '笔记本电脑')], 4200);
    reader.observe([object(0.2), object(0.8, 'laptop', '笔记本电脑')], 5000);
    expect(reader.next(5000)).toBe('右侧新出现笔记本电脑。');
  });

  it('compares against the last spoken frame and keeps changes during speech', () => {
    const reader = new SceneReader();
    reader.observe([object(0.2)], 0);
    reader.observe([object(0.2)], 800);
    reader.commit(1000);
    reader.observe([object(0.2), object(0.8, 'bottle', '瓶子')], 1500);
    reader.observe([object(0.2), object(0.8, 'bottle', '瓶子')], 2300);
    expect(reader.next(3000)).toBe('');
    expect(reader.next(5000)).toBe('右侧新出现瓶子。');
    reader.commit(5000);
    expect(reader.next(9000)).toBe('');
    expect(reader.next(25000)).toContain('画面基本没变');
  });

  it('does not match different classes and resets identity after a long absence', () => {
    const tracker = new ObjectTracker();
    tracker.update([object(0.2)], 0);
    const before = tracker.update([object(0.2)], 800);
    tracker.update([], 4500);
    tracker.update([object(0.2, 'bottle', '瓶子')], 4600);
    const after = tracker.update([object(0.2, 'bottle', '瓶子')], 5400);
    expect(after[0].id).not.toBe(before[0].id);
    expect(describeChanges(before, after)).toBe('左侧新出现瓶子；左侧不再看到人。');
  });
});
