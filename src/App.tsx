import { useEffect, useRef, useState } from 'react';
import { Camera, LoaderCircle, Square, SwitchCamera, Volume2, VolumeX, X } from 'lucide-react';
import { useCamera } from './useCamera';
import { useSpeech } from './useSpeech';
import { describeScene, sceneSignature } from './scene';
import type { SpeechOptions } from './types';

export default function App() {
  const staticHost = import.meta.env.VITE_STATIC_HOST === 'true';
  const [engine, setEngine] = useState<SpeechOptions['engine']>(staticHost ? 'device' : 'piper');
  const [autoRead, setAutoRead] = useState(true);
  const [online, setOnline] = useState(navigator.onLine);
  const camera = useCamera(0.45);
  const speech = useSpeech({ engine, rate: 1 });
  const auto = useRef({ candidate: '', since: 0, spoken: '', last: 0 });
  const active = camera.status === 'live';
  const loading = camera.status === 'starting' || (active && camera.modelStatus === 'loading');
  const detections = camera.result?.detections ?? [];
  const text = camera.result
    ? describeScene(detections)
    : active ? '正在观察画面…' : '对准身边的物体，自动识别并朗读。';

  useEffect(() => {
    const connection = () => setOnline(navigator.onLine);
    const visibility = () => { if (document.hidden) speech.stop(); };
    window.addEventListener('online', connection);
    window.addEventListener('offline', connection);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('online', connection);
      window.removeEventListener('offline', connection);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [speech.stop]);

  useEffect(() => {
    if (!camera.result || !active || !autoRead || speech.speaking || speech.error) return;
    if (engine === 'piper' && (!online || !speech.piperReady)) return;
    const state = auto.current;
    if (!detections.length) { state.candidate = ''; state.spoken = ''; return; }
    const signature = sceneSignature(detections);
    const now = Date.now();
    if (state.candidate !== signature) { state.candidate = signature; state.since = now; return; }
    if (signature === state.spoken || now - state.since < 1500 || now - state.last < 8000) return;
    state.spoken = signature; state.last = now;
    void speech.speak(text);
  }, [camera.result, active, autoRead, engine, online, speech.speaking, speech.error, speech.piperReady]);

  useEffect(() => {
    const result = camera.result;
    const canvas = camera.overlay.current;
    if (!canvas || !result) return;
    canvas.width = result.width; canvas.height = result.height;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (result.masks.length === result.width * result.height * 4) {
      context.putImageData(new ImageData(new Uint8ClampedArray(result.masks), result.width, result.height), 0, 0);
    }
    const font = Math.max(14, Math.round(result.width / 34));
    context.font = `600 ${font}px system-ui`;
    context.lineWidth = Math.max(2, result.width / 280);
    for (const item of result.detections) {
      const [x1, y1, x2, y2] = item.box;
      const x = x1 * result.width, y = y1 * result.height;
      context.strokeStyle = item.color;
      context.strokeRect(x, y, (x2 - x1) * result.width, (y2 - y1) * result.height);
      const width = context.measureText(item.label).width + 16;
      const labelX = Math.max(0, Math.min(x, result.width - width));
      const labelY = Math.max(0, y - font - 12);
      context.fillStyle = item.color;
      context.fillRect(labelX, labelY, width, font + 12);
      context.fillStyle = '#14232c';
      context.fillText(item.label, labelX + 8, labelY + font + 2);
    }
  }, [camera.result]);

  const start = () => {
    speech.unlock();
    auto.current = { candidate: '', since: 0, spoken: '', last: 0 };
    void camera.start();
  };
  const stop = () => { camera.stop(); speech.stop(); };
  const read = () => { speech.unlock(); void speech.speak(text); };
  const status = !online ? '离线' : loading ? '准备中' : active ? '识别中' : '待开启';

  return <main className="reader">
    <header className="reader-header">
      <h1>世界阅读器</h1>
      <span className={`status ${active && !loading ? 'live' : ''}`}><i />{status}</span>
    </header>
    <section className="viewfinder" aria-label="实时摄像头">
      <video ref={camera.video} muted playsInline aria-label="摄像头实时视频" />
      <canvas ref={camera.overlay} className="segmentation" aria-hidden="true" />
      {!active && <div className="camera-empty"><Camera size={36} strokeWidth={1.4} /><p>镜头尚未开启</p></div>}
      {active && <div className="camera-tools">
        <button onClick={() => { speech.stop(); camera.switchCamera(); }} aria-label="切换摄像头"><SwitchCamera size={21} /></button>
        <button onClick={stop} aria-label="关闭镜头"><X size={22} /></button>
      </div>}
      {loading && <div className="camera-loading" role="status">
        <LoaderCircle size={25} className="spin" />
        <p>{camera.stage || '正在开启摄像头'}{active && ` · ${camera.progress}%`}</p>
      </div>}
      {camera.result && <span className="frame-timing">{detections.length} 个物体 · {Math.round(camera.result.elapsed)} ms</span>}
    </section>
    <footer className="reader-controls">
      <div className="voice-options">
        <label className="voice-choice">
          <span className="sr-only">朗读方式</span>
          <select value={engine} onChange={event => { speech.stop(); setEngine(event.target.value as SpeechOptions['engine']); }}>
            {!staticHost && <option value="piper">Piper 中文</option>}
            <option value="device">系统语音</option>
          </select>
        </label>
        <button className="auto-read" aria-label="自动朗读" aria-pressed={autoRead} onClick={() => { setAutoRead(!autoRead); speech.stop(); }}>
          {autoRead ? <Volume2 size={17} /> : <VolumeX size={17} />}
          {autoRead ? '自动朗读' : '自动朗读已关'}
        </button>
      </div>
      <p className="scene-caption">{text}</p>
      {(camera.error || speech.error) && <p className="error-message" role="alert">{camera.error || speech.error}</p>}
      {engine === 'piper' && !speech.piperReady && !speech.error && <p className="service-note">Piper 未连接，可切换系统语音。</p>}
      <button className="primary-button" disabled={loading || (active && !camera.result && !speech.speaking)} onClick={() => !active ? start() : speech.speaking ? speech.stop() : read()}>
        {loading ? <LoaderCircle size={21} className="spin" /> : !active ? <Camera size={21} /> : speech.speaking ? <Square size={18} fill="currentColor" /> : <Volume2 size={21} />}
        {loading ? '正在准备…' : !active ? '开启摄像头' : speech.speaking ? '停止朗读' : '朗读当前画面'}
      </button>
    </footer>
  </main>;
}
