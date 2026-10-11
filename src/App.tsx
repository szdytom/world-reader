import { useEffect, useRef, useState } from 'react';
import { Camera, LoaderCircle, Square, SwitchCamera, Volume2, VolumeX, X } from 'lucide-react';
import { useCamera } from './useCamera';
import { useSpeech } from './useSpeech';
import { describeScene } from './scene';
import { SceneReader } from './tracking';

export default function App() {
  const [autoRead, setAutoRead] = useState(true);
  const [online, setOnline] = useState(navigator.onLine);
  const camera = useCamera(0.45);
  const speech = useSpeech();
  const reader = useRef(new SceneReader());
  const [narration, setNarration] = useState('');
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
    if (camera.result) reader.current.observe(camera.result.detections, Date.now(), camera.result.elapsed);
  }, [camera.result]);

  useEffect(() => {
    if (!active || !autoRead || speech.speaking || speech.error) return;
    const tick = () => {
      const now = Date.now();
      const message = reader.current.next(now);
      if (message && speech.speak(message)) {
        reader.current.commit(now);
        setNarration(message);
      }
    };
    const interval = setInterval(tick, 500);
    return () => clearInterval(interval);
  }, [active, autoRead, speech.speaking, speech.error, speech.speak]);

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
    reader.current = new SceneReader(); setNarration('');
    // Speak inside the tap gesture so mobile browsers allow subsequent narration.
    if (autoRead) speech.speak('开始观察。');
    else speech.stop();
    void camera.start();
  };
  const stop = () => { camera.stop(); speech.stop(); setNarration(''); };
  const read = () => {
    const message = describeScene(detections, 4);
    if (speech.speak(message)) { reader.current.commit(Date.now()); setNarration(message); }
  };
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
        <button onClick={() => { speech.stop(); reader.current = new SceneReader(); setNarration(''); camera.switchCamera(); }} aria-label="切换摄像头"><SwitchCamera size={21} /></button>
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
        <span className="voice-label">系统中文语音</span>
        <button className="auto-read" aria-label="自动朗读" aria-pressed={autoRead} onClick={() => {
          setAutoRead(!autoRead);
          if (!autoRead && active) read(); else speech.stop();
        }}>
          {autoRead ? <Volume2 size={17} /> : <VolumeX size={17} />}
          {autoRead ? '自动朗读' : '自动朗读已关'}
        </button>
      </div>
      <p className="scene-caption" aria-live="polite">{narration || text}</p>
      {(camera.error || speech.error) && <p className="error-message" role="alert">{camera.error || speech.error}</p>}
      <button className="primary-button" disabled={loading || (active && !camera.result && !speech.speaking)} onClick={() => !active ? start() : speech.speaking ? speech.stop() : read()}>
        {loading ? <LoaderCircle size={21} className="spin" /> : !active ? <Camera size={21} /> : speech.speaking ? <Square size={18} fill="currentColor" /> : <Volume2 size={21} />}
        {loading ? '正在准备…' : !active ? '开启摄像头' : speech.speaking ? '停止朗读' : '朗读当前画面'}
      </button>
    </footer>
  </main>;
}
