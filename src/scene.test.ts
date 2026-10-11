import { describe, expect, it } from 'vitest';
import { describeScene, directionFor, labels } from './scene';
import type { Detection } from './types';

const object = (name: string, label: string, center: number): Detection => ({ name, label, direction: directionFor(center), confidence: 0.9, color: '#fff', box: [0, 0, 1, 1] });
describe('scene narration', () => {
  it('keeps COCO translations aligned with the model class IDs', () => {
    expect(labels).toHaveLength(80); expect(labels[5]).toBe('公交车'); expect(labels[67]).toBe('手机');
  });
  it('uses image position instead of inventing physical distance', () => {
    expect(directionFor(0.1)).toBe('左侧'); expect(directionFor(0.5)).toBe('中间'); expect(directionFor(0.9)).toBe('右侧');
  });
  it('groups repeated objects by position and class', () => {
    const scene = [object('person', '人', 0.1), object('person', '人', 0.1), object('bus', '公交车', 0.8)];
    expect(describeScene(scene)).toBe('画面中，左侧有人，共2个；右侧有公交车。');
  });
  it('keeps automatic utterances short without changing the complete description', () => {
    const scene = [object('person', '人', 0.1), object('bus', '公交车', 0.8)];
    expect(describeScene(scene, 1)).toBe('画面中，左侧有人。');
    expect(describeScene(scene)).toContain('公交车');
  });
  it('gives actionable guidance for an empty frame', () => {
    expect(describeScene([])).toContain('缓慢移动镜头');
  });
});
