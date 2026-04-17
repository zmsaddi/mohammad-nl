'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

const MAX_DURATION = 30;
// BUG-28: minimum recording duration. Bumped from 800ms to 1500ms because
// 800ms silent clips were reaching Whisper and producing hallucinated
// purchases. 1500ms still feels instant for a real utterance.
const MIN_DURATION_MS = 1500;
// BUG-28: silence threshold for the Web Audio RMS detector. Values are in
// the [0,1] range after normalizing the 8-bit PCM samples around 128.
// 0.02 is roughly 2% of full scale — catches a truly silent room while
// still passing a whispered utterance. Tune if real speech gets rejected.
const SILENCE_RMS_THRESHOLD = 0.02;

export default function VoiceButton({ onResult, onError, compact }) {
  const [state, setState] = useState('idle'); // idle, recording, processing
  const [seconds, setSeconds] = useState(0);
  const mediaRecorder = useRef(null);
  const streamRef = useRef(null);
  const chunks = useRef([]);
  const timerRef = useRef(null);
  const startTimeRef = useRef(0);
  // BUG-28: Web Audio API refs for the RMS silence detector. These live
  // alongside MediaRecorder's pipeline — both consume the same MediaStream
  // but are otherwise independent.
  const audioCtxRef = useRef(null);
  const rmsIntervalRef = useRef(null);
  const maxRmsRef = useRef(0);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (rmsIntervalRef.current) clearInterval(rmsIntervalRef.current);
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {});
      }
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const cleanup = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (rmsIntervalRef.current) { clearInterval(rmsIntervalRef.current); rmsIntervalRef.current = null; }
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
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
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true, noiseSuppression: true, autoGainControl: true,
          channelCount: 1, sampleRate: { ideal: 16000 },
        },
      });
      streamRef.current = stream;

      // Check if webm is supported, fallback to default
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorder.current = recorder;
      chunks.current = [];
      startTimeRef.current = Date.now();

      // BUG-28: Web Audio RMS silence detector. Runs in parallel with the
      // MediaRecorder — AudioContext consumes the same MediaStream via a
      // source node. We poll AnalyserNode at 10Hz, compute RMS around the
      // 128 midpoint (8-bit PCM silence value), and track the max seen.
      // If max stays below SILENCE_RMS_THRESHOLD the recording is silent.
      maxRmsRef.current = 0;
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          const audioCtx = new AudioCtx();
          // Defensive resume: some browsers suspend the context until a
          // user gesture. handleClick IS a user gesture so we're OK, but
          // belt-and-suspenders for flaky mobile cases.
          if (audioCtx.state === 'suspended') {
            audioCtx.resume().catch(() => {});
          }
          audioCtxRef.current = audioCtx;
          const source = audioCtx.createMediaStreamSource(stream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 2048;
          source.connect(analyser);
          const rmsBuf = new Uint8Array(analyser.frequencyBinCount);
          let silentTicks = 0;
          const SILENCE_AUTO_STOP_TICKS = 25; // 2.5s at 10Hz
          rmsIntervalRef.current = setInterval(() => {
            analyser.getByteTimeDomainData(rmsBuf);
            let sumSquares = 0;
            for (let i = 0; i < rmsBuf.length; i++) {
              const v = (rmsBuf[i] - 128) / 128;
              sumSquares += v * v;
            }
            const rms = Math.sqrt(sumSquares / rmsBuf.length);
            if (rms > maxRmsRef.current) maxRmsRef.current = rms;
            // STT-DEFECT-009: auto-stop after 2.5s silence (only after speech detected)
            if (rms < SILENCE_RMS_THRESHOLD) { silentTicks++; } else { silentTicks = 0; }
            const elapsed = Date.now() - startTimeRef.current;
            if (silentTicks >= SILENCE_AUTO_STOP_TICKS && elapsed > 2000 && maxRmsRef.current >= SILENCE_RMS_THRESHOLD) {
              if (mediaRecorder.current && mediaRecorder.current.state !== 'inactive') {
                mediaRecorder.current.stop();
              }
            }
          }, 100);
        }
      } catch {
        // If Web Audio is unavailable we fall back to byte-size + duration
        // gates only. Silence detection is an enhancement, not a hard
        // dependency — never let it break the recording path.
      }

      // STT-DEFECT-005: preserve real MIME type for Safari/iOS compatibility
      const actualMimeType = recorder.mimeType || 'audio/webm';

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.current.push(e.data); };

      recorder.onstop = async () => {
        const maxRmsAtStop = maxRmsRef.current;
        const audioCtxWasAvailable = audioCtxRef.current !== null;
        cleanup();
        const duration = Date.now() - startTimeRef.current;
        if (duration < MIN_DURATION_MS) {
          setState('idle');
          onError?.('التسجيل قصير جداً. الرجاء التحدث لمدة ثانية ونصف على الأقل');
          return;
        }
        const blob = new Blob(chunks.current, { type: actualMimeType });
        if (blob.size < 500) {
          setState('idle');
          onError?.('التسجيل فارغ. حاول مرة أخرى');
          return;
        }
        // BUG-28: silence check. Only meaningful if the AudioContext was
        // actually available during recording (graceful no-op if browser
        // didn't support Web Audio).
        if (audioCtxWasAvailable && maxRmsAtStop < SILENCE_RMS_THRESHOLD) {
          setState('idle');
          onError?.('لم أسمع شيئاً. تأكد من أن الميكروفون يعمل');
          return;
        }
        await processAudio(blob);
      };

      recorder.start(1000);
      setState('recording');
      setSeconds(MAX_DURATION);

      // Timer — shorter max when AudioContext unavailable (no silence auto-stop)
      const effectiveMax = audioCtxRef.current ? MAX_DURATION : 15;
      const start = Date.now();
      timerRef.current = setInterval(() => {
        const remaining = effectiveMax - Math.floor((Date.now() - start) / 1000);
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
      const blobExt = blob.type?.includes('mp4') ? 'mp4' : blob.type?.includes('ogg') ? 'ogg' : 'webm';
      formData.append('audio', blob, `recording.${blobExt}`);
      const res = await fetch('/api/voice/process', { method: 'POST', body: formData, cache: 'no-store' });
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

  if (compact) {
    return (
      <button
        className="mic-btn"
        onClick={handleClick}
        disabled={state === 'processing'}
        title={state === 'recording' ? `اضغط للإيقاف (${seconds})` : 'إدخال صوتي'}
        style={state === 'recording' ? { borderColor: '#dc2626', color: '#dc2626' } : undefined}
      >
        {state === 'processing' ? (
          <div className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px' }}></div>
        ) : state === 'recording' ? (
          <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" width="18" height="18">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="23"/>
            <line x1="8" y1="23" x2="16" y2="23"/>
          </svg>
        )}
      </button>
    );
  }

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
