'use client';

import { useState, useRef, useEffect } from 'react';

const MAX_DURATION = 30; // seconds

export default function VoiceButton({ onResult, onError }) {
  const [state, setState] = useState('idle'); // idle, recording, processing
  const [seconds, setSeconds] = useState(0);
  const mediaRecorder = useRef(null);
  const chunks = useRef([]);
  const timerRef = useRef(null);

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      mediaRecorder.current = recorder;
      chunks.current = [];

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.current.push(e.data); };
      const recStartTime = Date.now();
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop()); // Always cleanup stream
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        const duration = Date.now() - recStartTime;
        if (duration < 800) { setState('idle'); onError?.('اضغط لفترة أطول - أقل شيء ثانية'); return; }
        const blob = new Blob(chunks.current, { type: 'audio/webm' });
        if (blob.size < 500) { setState('idle'); onError?.('لم أسمع شيء - حاول مرة أخرى'); return; }
        await processAudio(blob);
      };

      recorder.start();
      setState('recording');
      setSeconds(MAX_DURATION);
      const startTime = Date.now();
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const remaining = MAX_DURATION - elapsed;
        if (remaining <= 0) {
          stopRecording();
        } else {
          setSeconds(remaining);
        }
      }, 500);
    } catch (err) {
      onError?.('لا يمكن الوصول للميكروفون');
      setState('idle');
    }
  };

  const stopRecording = () => {
    if (mediaRecorder.current && mediaRecorder.current.state !== 'inactive') {
      mediaRecorder.current.stop();
    }
  };

  const processAudio = async (blob) => {
    setState('processing');
    try {
      // Step 1: Transcribe
      const formData = new FormData();
      formData.append('audio', blob, 'recording.webm');
      const transcribeRes = await fetch('/api/voice/transcribe', { method: 'POST', body: formData });
      if (!transcribeRes.ok) { const e = await transcribeRes.json(); throw new Error(e.error); }
      const { raw, normalized } = await transcribeRes.json();

      if (!normalized || normalized.length < 3) { onError?.('لم أسمع شيء واضح - حاول مرة أخرى'); setState('idle'); return; }

      // Step 2: Extract data
      const extractRes = await fetch('/api/voice/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: normalized }),
      });
      if (!extractRes.ok) { const e = await extractRes.json(); throw new Error(e.error); }
      const result = await extractRes.json();

      onResult?.({ ...result, transcript: raw, normalized });
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
        onMouseDown={state === 'idle' ? startRecording : undefined}
        onMouseUp={state === 'recording' ? stopRecording : undefined}
        onTouchStart={state === 'idle' ? startRecording : undefined}
        onTouchEnd={state === 'recording' ? stopRecording : undefined}
        disabled={state === 'processing'}
        style={{
          width: '72px', height: '72px', borderRadius: '50%', border: 'none', cursor: state === 'processing' ? 'wait' : 'pointer',
          background: state === 'recording' ? '#dc2626' : state === 'processing' ? '#94a3b8' : '#1e40af',
          color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: state === 'recording' ? '0 0 0 8px rgba(220,38,38,0.2)' : '0 4px 12px rgba(30,64,175,0.3)',
          transition: 'all 0.2s', animation: state === 'recording' ? 'pulse 1.5s infinite' : 'none',
        }}
      >
        {state === 'processing' ? (
          <div className="spinner" style={{ width: '28px', height: '28px', borderWidth: '3px' }}></div>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width="32" height="32">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
          </svg>
        )}
      </button>
      <div style={{ fontSize: '0.8rem', color: state === 'recording' ? '#dc2626' : '#64748b', fontWeight: 600 }}>
        {state === 'idle' && 'اضغط مع الاستمرار للتسجيل'}
        {state === 'recording' && `جاري التسجيل... ${seconds} ثانية`}
        {state === 'processing' && 'جاري المعالجة...'}
      </div>
    </div>
  );
}
