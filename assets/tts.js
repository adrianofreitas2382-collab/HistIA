import { store } from "./store.js";

function pickVoice(voiceHint){
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find(v => (v.lang||"").toLowerCase().startsWith((voiceHint||"pt-BR").toLowerCase()));
  if (preferred) return preferred;
  const pt = voices.find(v => (v.lang||"").toLowerCase().startsWith("pt"));
  return pt || null;
}

export const tts = {
  _cancelled:false,
  stop(){
    this._cancelled = true;
    try{ window.speechSynthesis.cancel(); }catch{}
  },
  speak(parts, onSentence){
    this.stop();
    this._cancelled = false;
    const s = store.getAudioSettings();
    let idx = 0;

    const speakNext = () => {
      if (this._cancelled) return;
      if (idx >= parts.length) return;

      const u = new SpeechSynthesisUtterance(parts[idx]);
      u.rate = s.rate;
      u.volume = s.volume;
      const v = pickVoice(s.voiceHint);
      if (v) u.voice = v;
      onSentence(idx);

      u.onend = () => { idx += 1; speakNext(); };
      u.onerror = () => { idx += 1; speakNext(); };
      window.speechSynthesis.speak(u);
    };

    if (window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.onvoiceschanged = () => speakNext();
    } else {
      speakNext();
    }
  }
};
