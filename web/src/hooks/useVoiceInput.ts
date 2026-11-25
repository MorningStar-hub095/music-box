/**
 * 语音识别 Hook
 * 优先使用 Web Speech API，不支持时回退到第三方 API
 */

import { useState, useRef, useCallback, useEffect } from 'react';

interface UseVoiceInputOptions {
  onResult?: (text: string) => void;
  onError?: (error: string) => void;
  lang?: string;
}

export function useVoiceInput(options: UseVoiceInputOptions = {}) {
  const { onResult, onError, lang = 'zh-CN' } = options;
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [isSupported, setIsSupported] = useState(false);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    // 检查 Web Speech API 支持
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setIsSupported(!!SpeechRecognition);

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, []);

  const startListening = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      onError?.('浏览器不支持语音识别，请使用 Chrome 浏览器');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = lang;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
      setTranscript('');
    };

    recognition.onresult = (event: any) => {
      let finalTranscript = '';
      let interimTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interimTranscript += result[0].transcript;
        }
      }

      if (finalTranscript) {
        setTranscript(finalTranscript);
        onResult?.(finalTranscript);
      } else if (interimTranscript) {
        setTranscript(interimTranscript);
      }
    };

    recognition.onerror = (event: any) => {
      setIsListening(false);
      const errorMessages: Record<string, string> = {
        'no-speech': '未检测到语音，请重试',
        'audio-capture': '未找到麦克风设备',
        'not-allowed': '麦克风权限被拒绝，请允许访问麦克风',
        'network': '语音识别服务不可用，请检查网络',
      };
      onError?.(errorMessages[event.error] || `语音识别错误: ${event.error}`);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [lang, onResult, onError]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }
  }, []);

  return {
    isListening,
    transcript,
    isSupported,
    startListening,
    stopListening,
  };
}
