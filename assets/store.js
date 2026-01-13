const LS_DB = "historia.db.v3";
const LS_LICENSE = "historia.licenseKey";
const LS_AUDIO = "historia.audioSettings";
const LS_MODEL = "historia.model";

function nowIso(){ return new Date().toISOString(); }
function rid(){
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return [...a].map(x=>x.toString(16).padStart(2,"0")).join("");
}
function readDb(){
  try{
    const raw = localStorage.getItem(LS_DB);
    if (!raw) return { stories: [] };
    return JSON.parse(raw);
  } catch { return { stories: [] }; }
}
function writeDb(db){ localStorage.setItem(LS_DB, JSON.stringify(db)); }

export const store = {
  getLicense(){ return localStorage.getItem(LS_LICENSE) || ""; },
  setLicense(v){ if (!v) localStorage.removeItem(LS_LICENSE); else localStorage.setItem(LS_LICENSE, v); },

  getModel(){ return localStorage.getItem(LS_MODEL) || "gemini-2.5-flash"; },
  setModel(v){ if (!v) localStorage.removeItem(LS_MODEL); else localStorage.setItem(LS_MODEL, v); },

  getAudioSettings(){
    try{
      const raw = localStorage.getItem(LS_AUDIO);
      if (!raw) return { rate: 1.0, volume: 1.0, voiceHint: "pt-BR" };
      const o = JSON.parse(raw);
      return {
        rate: typeof o.rate === "number" ? o.rate : 1.0,
        volume: typeof o.volume === "number" ? o.volume : 1.0,
        voiceHint: typeof o.voiceHint === "string" ? o.voiceHint : "pt-BR",
      };
    } catch { return { rate: 1.0, volume: 1.0, voiceHint: "pt-BR" }; }
  },
  setAudioSettings(s){ localStorage.setItem(LS_AUDIO, JSON.stringify(s)); },

  splitSentences(text){
    return String(text).split(/(?<=[\.!\?\n])\s+/).filter(Boolean);
  }
};

export function createStory(payload){
  const storyId = rid();
  const createdAt = nowIso();
  return {
    storyId,
    title: (payload.title||"").slice(0,80),
    premise: (payload.premise||"").slice(0,2000),
    nuclei: (payload.nuclei||"").slice(0,600),
    tone: (payload.tone||"Aventura").slice(0,40),
    ageRating: (payload.ageRating||"14+").slice(0,10),
    firstPerson: !!payload.firstPerson,

    status: "active",
    chapter: 1,
    stage: 0,              // 0, 50, 90, 100

    fullText: "",
    pendingChoices: null,
    pendingChoiceAt: null,

    choices: [],

    createdAt,
    updatedAt: createdAt
  };
}

export function saveStory(story){
  const db = readDb();
  const i = db.stories.findIndex(s => s.storyId === story.storyId);
  story.updatedAt = nowIso();
  if (i >= 0) db.stories[i] = story;
  else db.stories.unshift(story);
  writeDb(db);
}

export function deleteStory(storyId){
  const db = readDb();
  db.stories = db.stories.filter(s => s.storyId !== storyId);
  writeDb(db);
}

export function getStory(storyId){
  const db = readDb();
  return db.stories.find(s => s.storyId === storyId) || null;
}

export function listStories(){
  const db = readDb();
  return db.stories.map(s => ({
    storyId: s.storyId,
    title: s.title || "(sem título)",
    status: s.status,
    chapter: s.chapter,
    updatedAt: s.updatedAt,
    stage: s.stage
  }));
}

export function findDuplicate(payload){
  const db = readDb();
  const norm = (v)=>String(v||"").trim();
  return db.stories.find(s =>
    norm(s.title) === norm(payload.title) &&
    norm(s.premise) === norm(payload.premise) &&
    norm(s.nuclei) === norm(payload.nuclei) &&
    norm(s.tone) === norm(payload.tone) &&
    norm(s.ageRating) === norm(payload.ageRating) &&
    !!s.firstPerson === !!payload.firstPerson &&
    s.status === "active"
  ) || null;
}

export function addChoice(story, choiceIndex){
  if (!story.pendingChoices || !story.pendingChoiceAt) return;
  const c = story.pendingChoices[choiceIndex];
  if (!c) return;
  story.choices.push({ chapter: story.chapter, pause: story.pendingChoiceAt, choice: c, at: nowIso() });
}

export function resetPending(story){
  story.pendingChoices = null;
  story.pendingChoiceAt = null;
}
