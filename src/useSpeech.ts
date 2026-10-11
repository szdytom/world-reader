import { useCallback, useEffect, useRef, useState } from 'react';

export function useSpeech() {
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState('');
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  const deadline = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const token = useRef(0);

  const stop = useCallback(() => {
    token.current++;
    clearTimeout(deadline.current);
    window.speechSynthesis?.cancel();
    utterance.current = null;
    setSpeaking(false);
    setError('');
  }, []);

  const speak = useCallback((text: string) => {
    stop();
    const current = token.current;
    try {
      if (!window.speechSynthesis) throw new Error('当前浏览器不支持系统朗读，请使用 Safari 或 Chrome。');
      const message = new SpeechSynthesisUtterance(text);
      message.lang = 'zh-CN';
      const voices = window.speechSynthesis.getVoices();
      message.voice = voices.find(v => /^zh[-_]CN$/i.test(v.lang))
        ?? voices.find(v => /^zh(?:[-_]|$)/i.test(v.lang)) ?? null;
      message.onend = () => {
        if (current !== token.current) return;
        clearTimeout(deadline.current);
        utterance.current = null;
        setSpeaking(false);
      };
      message.onerror = event => {
        if (current !== token.current) return;
        clearTimeout(deadline.current);
        utterance.current = null;
        setSpeaking(false);
        if (event.error !== 'interrupted' && event.error !== 'canceled') {
          setError(event.error === 'not-allowed' ? '浏览器需要一次点击来允许语音，请点击「朗读当前画面」。'
            : '系统朗读失败，请检查中文语音是否已安装，然后点击重试。');
        }
      };
      utterance.current = message;
      setSpeaking(true);
      // Some mobile voices omit the end event; do not leave auto-reading stuck.
      deadline.current = setTimeout(() => {
        if (current === token.current) stop();
      }, Math.min(30000, Math.max(6000, text.length * 350 + 3000)));
      window.speechSynthesis.resume();
      window.speechSynthesis.speak(message);
      return true;
    } catch (e) {
      clearTimeout(deadline.current);
      utterance.current = null;
      setSpeaking(false);
      setError(e instanceof Error ? e.message : '朗读失败，请重试。');
      return false;
    }
  }, [stop]);

  useEffect(() => {
    // Start loading device voices before the first camera result arrives.
    window.speechSynthesis?.getVoices();
    return stop;
  }, [stop]);

  return { speak, stop, speaking, error };
}
