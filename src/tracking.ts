import { describeScene, directionFor } from './scene';
import type { Detection, Direction } from './types';

export interface TrackedObject extends Detection { id: number }
interface Track {
  object: TrackedObject;
  firstSeen: number; lastSeen: number; hits: number;
  candidate: Direction; directionSince: number;
}

function area(box: Detection['box']) {
  return Math.max(0, box[2] - box[0]) * Math.max(0, box[3] - box[1]);
}

function matchScore(a: Detection, b: Detection) {
  if (a.name !== b.name) return 0;
  const intersection = Math.max(0, Math.min(a.box[2], b.box[2]) - Math.max(a.box[0], b.box[0]))
    * Math.max(0, Math.min(a.box[3], b.box[3]) - Math.max(a.box[1], b.box[1]));
  const aa = area(a.box), ab = area(b.box);
  const iou = intersection / Math.max(1e-6, aa + ab - intersection);
  const distance = Math.hypot((a.box[0] + a.box[2] - b.box[0] - b.box[2]) / 2,
    (a.box[1] + a.box[3] - b.box[1] - b.box[3]) / 2);
  if (iou < 0.15 && (distance > 0.18 || Math.min(aa, ab) / Math.max(aa, ab, 1e-6) < 0.35)) return 0;
  return iou + Math.max(0, 0.18 - distance);
}

// Same-class spatial association is enough for the demo's low-frame-rate stream.
// This is a lightweight tracker, not Ultralytics' Python ByteTrack implementation.
export class ObjectTracker {
  private tracks = new Map<number, Track>();
  private nextId = 1;

  update(detections: Detection[], now: number, missingMs = 3500): TrackedObject[] {
    for (const [id, track] of this.tracks) {
      if (now - track.lastSeen > missingMs) this.tracks.delete(id);
    }
    const pairs: { id: number; index: number; score: number }[] = [];
    for (const [id, track] of this.tracks) {
      detections.forEach((d, index) => {
        const score = matchScore(track.object, d);
        if (score > 0) pairs.push({ id, index, score });
      });
    }
    pairs.sort((a, b) => b.score - a.score);
    const matchedIds = new Set<number>(), matchedIndices = new Set<number>();
    for (const { id, index } of pairs) {
      if (matchedIds.has(id) || matchedIndices.has(index)) continue;
      matchedIds.add(id); matchedIndices.add(index);
      const track = this.tracks.get(id)!;
      const d = detections[index];
      const center = (d.box[0] + d.box[2]) / 2;
      let direction = directionFor(center);
      // Hysteresis and a dwell time suppress left/center/right boundary flicker.
      if (track.object.direction === '左侧' && center < 1 / 3 + 0.04) direction = '左侧';
      if (track.object.direction === '右侧' && center > 2 / 3 - 0.04) direction = '右侧';
      if (track.object.direction === '中间' && center > 1 / 3 - 0.04 && center < 2 / 3 + 0.04) direction = '中间';
      if (direction !== track.candidate) { track.candidate = direction; track.directionSince = now; }
      const stableDirection = now - track.directionSince >= 1000 ? direction : track.object.direction;
      track.object = { ...d, id, direction: stableDirection };
      track.lastSeen = now; track.hits++;
    }
    detections.forEach((d, index) => {
      if (matchedIndices.has(index)) return;
      const id = this.nextId++;
      this.tracks.set(id, { object: { ...d, id }, firstSeen: now, lastSeen: now, hits: 1,
        candidate: d.direction, directionSince: now });
    });
    return [...this.tracks.values()]
      .filter(t => t.hits >= 2 && t.lastSeen - t.firstSeen >= 700)
      .map(t => ({ ...t.object }));
  }
}

export function describeChanges(previous: TrackedObject[], current: TrackedObject[]): string {
  const before = new Map(previous.map(d => [d.id, d]));
  const after = new Map(current.map(d => [d.id, d]));
  const groups = new Map<string, { kind: 'new' | 'gone' | 'moved'; object: TrackedObject; from?: Direction; count: number }>();
  const add = (kind: 'new' | 'gone' | 'moved', object: TrackedObject, from?: Direction) => {
    const key = `${kind}:${object.name}:${object.direction}:${from ?? ''}`;
    const group = groups.get(key);
    if (group) group.count++;
    else groups.set(key, { kind, object, from, count: 1 });
  };
  for (const d of current) {
    const old = before.get(d.id);
    if (!old) add('new', d);
    else if (old.direction !== d.direction) add('moved', d, old.direction);
  }
  for (const d of previous) if (!after.has(d.id)) add('gone', d);
  const phrases = [...groups.values()].map(({ kind, object: d, from, count }) => {
    const label = count > 1 ? `${count}个${d.label}` : d.label;
    if (kind === 'new') return `${d.direction}新出现${label}`;
    if (kind === 'gone') return `${d.direction}不再看到${label}`;
    return `${label}从画面${from}移到${d.direction}`;
  });
  if (!phrases.length) return '';
  // Keep each utterance short enough to finish while the camera keeps observing.
  return phrases.slice(0, 4).join('；') + (phrases.length > 4 ? `；还有${phrases.length - 4}处变化。` : '。');
}

export class SceneReader {
  private tracker = new ObjectTracker();
  private current: TrackedObject[] = [];
  private baseline: TrackedObject[] | null = null;
  private firstFrame: number | null = null;
  private lastSpoken = -Infinity;

  observe(detections: Detection[], now: number, elapsed = 0) {
    this.firstFrame ??= now;
    this.current = this.tracker.update(detections, now, Math.max(3500, elapsed * 3));
  }

  next(now: number): string {
    if (this.firstFrame === null || now - this.lastSpoken < 3000) return '';
    if (this.baseline === null) {
      if (!this.current.length && now - this.firstFrame < 2000) return '';
      return describeScene(this.current, 4);
    }
    const changes = describeChanges(this.baseline, this.current);
    if (changes) return changes;
    if (now - this.lastSpoken >= 20000) {
      return this.current.length ? `画面基本没变，${describeScene(this.current, 3).replace(/^画面中，/, '')}`
        : '仍然没有识别到熟悉的物体，可以缓慢移动镜头。';
    }
    return '';
  }

  commit(now: number) {
    this.baseline = this.current.map(d => ({ ...d }));
    this.lastSpoken = now;
  }
}
