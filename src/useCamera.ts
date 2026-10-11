import { useCallback, useEffect, useRef, useState } from 'react';
import type { FrameResult } from './types';

export function useCamera(confidence: number) {
  const video = useRef<HTMLVideoElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const worker = useRef<Worker | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const generation = useRef(0);
  const busy = useRef(false);
  const capturing = useRef(false);
  const ready = useRef(false);
  const confidenceRef = useRef(confidence);
  confidenceRef.current = confidence;
  const frameCanvas = useRef<HTMLCanvasElement | null>(null);
  const frameCallback = useRef<() => void>(() => {});
  const [status, setStatus] = useState<'idle' | 'starting' | 'live'>('idle');
  const [modelStatus, setModelStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<FrameResult | null>(null);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');

  const clearOverlay = () => {
    const canvas = overlay.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  };
  const stop = useCallback(() => {
    generation.current++; capturing.current = false;
    clearTimeout(timer.current);
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
    if (video.current) video.current.srcObject = null;
    setStatus('idle'); setResult(null); clearOverlay();
  }, []);

  const schedule = () => {
    clearTimeout(timer.current);
    if (capturing.current && ready.current) timer.current = setTimeout(() => frameCallback.current(), 80);
  };
  frameCallback.current = () => {
    const element = video.current;
    if (!capturing.current || !ready.current || busy.current || !element || element.readyState < 2) { schedule(); return; }
    const canvas = frameCanvas.current ??= document.createElement('canvas');
    const scale = Math.min(1, 640 / Math.max(element.videoWidth, element.videoHeight));
    canvas.width = Math.round(element.videoWidth * scale);
    canvas.height = Math.round(element.videoHeight * scale);
    if (!canvas.width || !canvas.height) { schedule(); return; }
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) { setError('浏览器无法读取视频画面。'); return; }
    context.drawImage(element, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    busy.current = true;
    worker.current?.postMessage({ type: 'frame', pixels: pixels.data.buffer, width: canvas.width, height: canvas.height, confidence: confidenceRef.current, generation: generation.current }, [pixels.data.buffer]);
  };

  const load = useCallback(() => {
    if (ready.current || worker.current) return;
    setModelStatus('loading'); setError('');
    const engine = new Worker(new URL('./vision.worker.ts', import.meta.url), { type: 'module' });
    worker.current = engine;
    const fail = (message: string) => {
      setError(message); setModelStatus('error'); ready.current = false;
      busy.current = false; engine.terminate(); worker.current = null;
      // Stop tracks on failure so the camera indicator cannot remain silently active.
      stop();
    };
    engine.onerror = (event) => fail(`识别引擎启动失败：${event.message || '请检查模型与运行时文件，然后重试。'}`);
    engine.onmessage = ({ data }) => {
      if (data.type === 'progress') { setProgress(data.progress); setStage(data.stage); }
      if (data.type === 'ready') { ready.current = true; setModelStatus('ready'); setProgress(100); schedule(); }
      if (data.type === 'error') fail(data.message);
      if (data.type === 'result') {
        busy.current = false;
        if (capturing.current && data.generation === generation.current) setResult(data.result);
        schedule();
      }
    };
    engine.postMessage({ type: 'load' });
  }, [stop]);

  const start = useCallback(async (nextFacing = facing) => {
    stop(); setError(''); setStatus('starting');
    const current = generation.current;
    try {
      if (!window.isSecureContext) throw new Error('手机摄像头需要 HTTPS，请使用安全连接打开应用。');
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('浏览器不支持摄像头，请使用新版 Safari 或 Chrome。');
      const media = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: nextFacing }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      if (current !== generation.current || document.hidden) { media.getTracks().forEach(t => t.stop()); return; }
      stream.current = media;
      const element = video.current;
      if (!element) { stop(); return; }
      element.srcObject = media;
      await element.play();
      if (current !== generation.current) return;
      media.getVideoTracks()[0].onended = () => { stop(); setError('摄像头已断开，请重新开启。'); };
      capturing.current = true; setStatus('live'); load(); schedule();
    } catch (error) {
      if (current !== generation.current) return;
      stop();
      const e = error as Error;
      setError(e.name === 'NotAllowedError' ? '摄像头权限未开启，请在浏览器设置中允许访问后重试。' : e.name === 'NotFoundError' ? '未找到可用摄像头，请连接摄像头后重试。' : e.name === 'NotReadableError' ? '摄像头正被其他应用使用，请关闭后重试。' : e.message);
    }
  }, [facing, load, stop]);

  const switchCamera = () => {
    const next = facing === 'environment' ? 'user' : 'environment'; setFacing(next); void start(next);
  };
  useEffect(() => {
    const onVisibility = () => { if (document.hidden) stop(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { document.removeEventListener('visibilitychange', onVisibility); stop(); worker.current?.terminate(); };
  }, [stop]);
  return { video, overlay, status, modelStatus, progress, stage, error, result, facing, start, stop, switchCamera };
}
