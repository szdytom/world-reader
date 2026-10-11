import { useEffect, useRef, useState, type RefObject } from 'react';
import type { TextResult } from './types';

export function useOcr(video: RefObject<HTMLVideoElement | null>, active: boolean, enabled: boolean) {
  const [result, setResult] = useState<TextResult | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState('');
  const epoch = useRef(0);

  useEffect(() => {
    const generation = ++epoch.current;
    setResult(null); setError('');
    if (!active || !enabled) { setStatus('idle'); return; }
    setStatus('loading');
    const worker = new Worker(new URL('./ocr.worker.ts', import.meta.url), { type: 'module' });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const capture = () => {
      if (disposed || document.hidden) return;
      const element = video.current;
      if (!element || element.readyState < 2 || !context) { timer = setTimeout(capture, 1000); return; }
      const scale = Math.min(1, 960 / Math.max(element.videoWidth, element.videoHeight));
      canvas.width = Math.round(element.videoWidth * scale);
      canvas.height = Math.round(element.videoHeight * scale);
      if (!canvas.width || !canvas.height) { timer = setTimeout(capture, 1000); return; }
      context.drawImage(element, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      worker.postMessage({ type: 'frame', generation, width: canvas.width, height: canvas.height,
        pixels: pixels.data.buffer }, [pixels.data.buffer]);
    };
    const fail = (message: string) => {
      if (disposed) return;
      setError(`文字识别暂不可用：${message}`); setStatus('error');
      clearTimeout(timer); worker.terminate();
    };
    worker.onerror = event => fail(event.message || '请关闭再开启「读文字」重试。');
    worker.onmessage = ({ data }) => {
      if (disposed || generation !== epoch.current) return;
      if (data.type === 'ready') { setStatus('ready'); capture(); }
      if (data.type === 'error') fail(data.message);
      if (data.type === 'result' && data.generation === generation) {
        setResult(data.result);
        // No queue: finish this OCR pass before scheduling another camera frame.
        timer = setTimeout(capture, Math.max(2500, data.result.elapsed));
      }
    };
    worker.postMessage({ type: 'load' });
    return () => { disposed = true; clearTimeout(timer); worker.terminate(); };
  }, [video, active, enabled]);

  return { result, status, error };
}
