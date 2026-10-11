import { useCallback, useEffect, useRef, useState } from 'react';
import type { SpeechOptions } from './types';

export function useSpeech(settings: SpeechOptions) {
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState('');
  const [piperReady, setPiperReady] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const context = useRef<AudioContext | null>(null);
  const source = useRef<AudioBufferSourceNode | null>(null);
  const request = useRef<AbortController | null>(null);
  const token = useRef(0);
  const url = useRef('');

  const check = useCallback(async () => {
    if (import.meta.env.VITE_STATIC_HOST === 'true') return;
    try {
      const response = await fetch('/api/health', { signal: AbortSignal.timeout(4000) });
      if (!response.ok) { setPiperReady(false); return; }
      const data = await response.json(); setPiperReady(data.piper_ready === true);
    } catch { setPiperReady(false); }
  }, []);
  useEffect(() => { void check(); const interval = setInterval(check, 30000); return () => clearInterval(interval); }, [check]);
  const stop = useCallback(() => {
    token.current++; request.current?.abort(); request.current = null;
    window.speechSynthesis?.cancel();
    source.current?.stop(); source.current = null;
    audio.current?.pause(); audio.current = null;
    if (url.current) URL.revokeObjectURL(url.current); url.current = '';
    setSpeaking(false);
  }, []);
  // Unlock mobile audio from the user's camera/read gesture.
  const unlock = () => {
    try {
      if (!context.current || context.current.state === 'closed') context.current = new AudioContext();
      void context.current.resume();
    } catch { /* HTMLAudioElement remains available. */ }
  };
  const speak = useCallback(async (text: string) => {
    stop(); setError(''); setSpeaking(true);
    const current = token.current;
    try {
      if (settings.engine === 'device') {
        if (!window.speechSynthesis) throw new Error('当前浏览器没有系统语音，请切换到 Piper。');
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'zh-CN'; utterance.rate = settings.rate;
        utterance.voice = window.speechSynthesis.getVoices().find(v => v.lang.startsWith('zh')) ?? null;
        utterance.onend = () => { if (current === token.current) setSpeaking(false); };
        utterance.onerror = (e) => {
          if (current !== token.current) return;
          setSpeaking(false); if (e.error !== 'interrupted' && e.error !== 'canceled') setError('系统朗读失败，请检查中文语音是否已安装。');
        };
        window.speechSynthesis.speak(utterance); return true;
      }
      const controller = new AbortController(); request.current = controller;
      const timeout = setTimeout(() => controller.abort(), 30000);
      let response: Response;
      try {
        response = await fetch('/api/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, rate: settings.rate }), signal: controller.signal });
      } finally { clearTimeout(timeout); }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail ?? 'Piper 尚未连接，请启动语音服务，或切换系统语音。');
      }
      const bytes = await response.arrayBuffer();
      if (current !== token.current) return false;
      if (context.current?.state === 'running') {
        const buffer = await context.current.decodeAudioData(bytes);
        if (current !== token.current) return false;
        const node = context.current.createBufferSource(); node.buffer = buffer;
        node.connect(context.current.destination); source.current = node;
        node.onended = () => { if (current === token.current) { source.current = null; setSpeaking(false); } };
        node.start();
      } else {
        url.current = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
        const player = new Audio(url.current); audio.current = player;
        player.onended = () => { if (current === token.current) stop(); };
        await player.play();
      }
      return true;
    } catch (e) {
      if (current !== token.current) return false;
      setSpeaking(false);
      setError(e instanceof Error && e.name === 'AbortError' ? '语音服务响应超时，请检查连接后重试。' : e instanceof Error ? e.message : '朗读失败，请重试。');
      return false;
    }
  }, [settings.engine, settings.rate, stop]);
  useEffect(() => () => { stop(); void context.current?.close(); }, [stop]);
  return { speak, stop, speaking, error, piperReady, check, unlock };
}
