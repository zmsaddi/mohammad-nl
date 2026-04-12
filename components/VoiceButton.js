'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

const MAX_DURATION = 30;

export default function VoiceButton({ onResult, onError }) {
  const [state, setState] = useState('idle'); // idle, recording, processing
  const [seconds, setSeconds] = useState(0);
  const mediaRecorder = useRef(null);
  const streamRef = useRef(null);
  const chunks = useRef([]);
  const timerRef = useRef(null);
  const startTimeRef = useRef(0);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const cleanup = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    mediaRecorder.current = null;
  }, []);

  const handleClick = async () => {
    if (state === 'processing') return;

    if (state === 'recording') {
      // STOP recording
      if (mediaRecorder.current && mediaRecorder.current.state !== 'inactive') {
        mediaRecorder.current.stop();
      }
      return;
    }

    // START recording
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Check if webm is supported, fallback to default
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorder.current = recorder;
      chunks.current = [];
      startTimeRef.current = Date.now();

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.current.push(e.data); };

      recorder.onstop = async () => {
        cleanup();
        const duration = Date.now() - startTimeRef.current;
        if (duration < 800) {
          setState('idle');
          onError?.('التسجيل قصير جداً - تكلم لثانية على الأقل');
          return;
        }
        const blob = new Blob(chunks.current, { type: 'audio/webm' });
        if (blob.size < 500) {
          setState('idle');
          onError?.('لم أسمع شيء - حاول مرة أخرى');
          return;
        }
        await processAudio(blob);
      };

      recorder.start();
      setState('recording');
      setSeconds(MAX_DURATION);

      // Timer
      const start = Date.now();
      timerRef.current = setInterval(() => {
        const remaining = MAX_DURATION - Math.floor((Date.now() - start) / 1000);
        if (remaining <= 0) {
          if (mediaRecorder.current && mediaRecorder.current.state !== 'inactive') {
            mediaRecorder.current.stop();
          }
        } else {
          setSeconds(remaining);
        }
      }, 500);
    } catch {
      cleanup();
      onError?.('لا يمكن الوصول للميكروفون - تأكد من الصلاحيات');
      setState('idle');
    }
  };

  const processAudio = async (blob) => {
    setState('processing');
    try {
      const formData = new FormData();
      formData.append('audio', blob, 'recording.webm');
      const res = await fetch('/api/voice/process', { method: 'POST', body: formData });
      if (!res.ok) {
        const e = await res.json().catch(() => ({ error: 'خطأ في السيرفر' }));
        throw new Error(e.error);
      }
      const result = await res.json();
      if (!result.transcript && !result.normalized) {
        onError?.('لم أسمع شيء واضح - حاول مرة أخرى');
        setState('idle');
        return;
      }
      onResult?.(result);
    } catch (err) {
      onError?.(err.message || 'خطأ في المعالجة');
    } finally {
      setState('idle');
      setSeconds(0);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
      <button
        onClick={handleClick}
        disabled={state === 'processing'}
        style={{
          width: '72px', height: '72px', borderRadius: '50%', border: 'none',
          cursor: state === 'processing' ? 'wait' : 'pointer',
          background: state === 'recording' ? '#dc2626' : state === 'processing' ? '#94a3b8' : '#1e40af',
          color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: state === 'recording' ? '0 0 0 8px rgba(220,38,38,0.2)' : '0 4px 12px rgba(30,64,175,0.3)',
          transition: 'all 0.2s',
        }}
      >
        {state === 'processing' ? (
          <div className="spinner" style={{ width: '28px', height: '28px', borderWidth: '3px' }}></div>
        ) : state === 'recording' ? (
          <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" width="28" height="28">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width="32" height="32">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
          </svg>
        )}
      </button>
      <div style={{ fontSize: '0.8rem', color: state === 'recording' ? '#dc2626' : '#64748b', fontWeight: 600 }}>
        {state === 'idle' && 'اضغط للتسجيل 🎙️'}
        {state === 'recording' && `⏹️ اضغط للإيقاف (${seconds})`}
        {state === 'processing' && 'جاري المعالجة...'}
      </div>
    </div>
  );
}
