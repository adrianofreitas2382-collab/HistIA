import {
  store,
  createStory,
  findDuplicate,
  listStories,
  getStory,
  saveStory,
  deleteStory,
  addChoice,
  resetPending,
  canAdvanceChapter,
  nextChapterInit,
  archiveCurrentAsPage
} from "./store.js";

import { tts } from "./tts.js";
import { geminiGenerateSegment, geminiContinue } from "./gemini.js";

const app = document.getElementById("app");
const badgeModel = document.getElementById("badgeModel");

function escapeHtml(s="") {
  return String(s).replace(/[&<>"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[m]));
}
function escapeAttr(s="") { return escapeHtml(s).replace(/"/g, "&quot;"); }
function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function updateBadge(){
  if (badgeModel) badgeModel.textContent = `3.0 • Static • ${store.getModel()}`;
}

function parseHash(){
  const raw = (location.hash || "#/").trim();
  const cleaned = raw.startsWith("#/") ? raw.slice(2) : (raw.startsWith("#") ? raw.slice(1) : raw);
  return cleaned.split("/").filter(Boolean);
}

function route(){
  updateBadge();
  const [path, id, sub] = parseHash();

  if (!path) return renderHome();
  if (path === "stories") return renderStories();
  if (path === "tutorial") return renderTutorial();
  if (path === "controls") return renderControls();
  if (path === "terms") return renderTerms();
  if (path === "story" && id && sub === "details") return renderDetails(id);
  if (path === "story" && id) return renderStory(id);

  renderHome();
}

window.addEventListener("hashchange", route);
window.addEventListener("load", route);

function renderHome(){
  const s = store.getAudioSettings();
  app.innerHTML = "";
  app.appendChild(el(`
    <div class="grid">
      <div class="card">
        <h2 class="title">Criar História</h2>
        <p class="muted">
          Em cada capítulo, haverá duas pausas com 3 opções (50% e 90%).
          O botão <b>Atualizar</b> é apenas para tentar completar geração quando um trecho ou opções não aparecem.
        </p>

        <label>Título</label>
        <input id="title" placeholder="Defina um título curto e marcante" />

        <label>Breve enredo (premissa)</label>
        <textarea id="premise" placeholder="Descreva em 2–5 linhas o ponto de partida da história"></textarea>

        <label>Núcleos desejados (separe por ponto e vírgula)</label>
        <input id="nuclei" placeholder="Liste núcleos separados por ponto e vírgula" />

        <div class="split">
          <div>
            <label>Tom</label>
            <select id="tone">
              ${["Aventura","Mistério","Drama","Ação","Fantasia","Terror","Romance"].map(x=>`<option>${x}</option>`).join("")}
            </select>
          </div>
          <div>
            <label>Classificação</label>
            <select id="age">
              ${["10+","12+","14+","16+","18+"].map(x=>`<option ${x==="16+"?"selected":""}>${x}</option>`).join("")}
            </select>
          </div>
        </div>

        <div class="row" style="margin-top:16px;">
          <input id="fp" type="checkbox" style="width:18px;height:18px;" />
          <label for="fp" style="margin:0;">Ativar Primeira Pessoa (o leitor vira personagem)</label>
        </div>

        <div class="hr"></div>

        <div class="notice" id="licenseNotice" style="display:none;">
          <div class="muted">Para gerar a história, insira a <b>Licença de Uso</b> em <a href="#/terms"><u>Termos</u></a>.</div>
        </div>

        <div class="row" style="margin-top:16px;">
          <button class="btn" id="start">Iniciar História</button>
          <a class="pill" href="#/terms">Ler Termos</a>
        </div>

        <p class="muted" style="margin-top:16px;">Modelo Gemini atual: <b>${escapeHtml(store.getModel())}</b></p>
        <p class="muted">Velocidade: <b>${s.rate.toFixed(2)}</b> • Volume: <b>${Math.round(s.volume*100)}%</b></p>

        <div class="error" id="err" style="margin-top:12px;"></div>
      </div>

      <div class="card">
        <h2 class="title">Informações</h2>
        <ul class="muted" style="margin-top:0; line-height:1.9;">
          <li>Site estático (GitHub Pages).</li>
          <li>Histórias e licença ficam no navegador (localStorage).</li>
        </ul>
      </div>
    </div>
  `));

  if (!store.getLicense()) app.querySelector("#licenseNotice").style.display = "block";

  app.querySelector("#start").addEventListener("click", async ()=>{
    const err = app.querySelector("#err");
    err.textContent = "";

    if (!store.getLicense()) { err.textContent = "Defina a Licença de Uso em Termos."; return; }

    const payload = {
      title: app.querySelector("#title").value.trim(),
      premise: app.querySelector("#premise").value.trim(),
      nuclei: app.querySelector("#nuclei").value.trim(),
      tone: app.querySelector("#tone").value,
      ageRating: app.querySelector("#age").value,
      firstPerson: app.querySelector("#fp").checked
    };
    if (!payload.premise) { err.textContent = "Premissa é obrigatória."; return; }

    const dup = findDuplicate(payload);
    if (dup) { location.hash = `#/story/${dup.storyId}`; return; }

    const story = createStory(payload);
    story.pages = Array.isArray(story.pages) ? story.pages : [];
    saveStory(story);

    const btn = app.querySelector("#start");
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Gerando...";

    try{
      const seg = await geminiGenerateSegment(story, 0); // deve trazer escolhas 1
      story.fullText = seg.text.trim();
      story.pendingChoices = seg.choices;
      story.pendingChoiceAt = 1;
      story.stage = 50;
      saveStory(story);
      location.hash = `#/story/${story.storyId}`;
    } catch(e){
      err.textContent = e?.message || "Erro ao chamar Gemini.";
      btn.disabled = false;
      btn.textContent = old;
    }
  });
}

function renderStories(){
  const items = listStories();
  app.innerHTML = "";
  const root = el(`
    <div class="card">
      <h2 class="title">Minhas Histórias</h2>
      <p class="muted">Atualizar na lista só tenta gerar o início quando uma história ficou em 0%.</p>
      <div class="hr"></div>
      <div id="list"></div>
    </div>
  `);
  const list = root.querySelector("#list");

  if (items.length === 0) {
    list.appendChild(el(`<p class="muted">Nenhuma história criada ainda.</p>`));
  } else {
    items.forEach(s => {
      list.appendChild(el(`
        <div class="card" style="padding:18px; margin-bottom:14px;">
          <div class="row" style="justify-content:space-between;">
            <div>
              <div style="font-weight:700;">${escapeHtml(s.title)}</div>
              <div class="muted">Status: ${s.status} | Capítulo: ${s.chapter} | Estágio: ${s.stage}% | Atualizado: ${new Date(s.updatedAt).toLocaleString()}</div>
            </div>
            <div class="row">
              <button class="btn secondary" data-action="refresh" data-id="${s.storyId}">Atualizar</button>
              <a class="pill" href="#/story/${s.storyId}">Continuar</a>
              <a class="pill" href="#/story/${s.storyId}/details">Exibir detalhes</a>
            </div>
          </div>
          <div class="error" data-err="${s.storyId}" style="margin-top:10px;"></div>
        </div>
      `));
    });
  }

  root.querySelectorAll('button[data-action="refresh"]').forEach(btn => {
    btn.addEventListener("click", async ()=>{
      const storyId = btn.dataset.id;
      const errEl = root.querySelector(`[data-err="${storyId}"]`);
      errEl.textContent = "";
      const story = getStory(storyId);
      if (!story) return;

      if (!store.getLicense()) { errEl.textContent = "Defina a Licença de Uso em Termos."; return; }

      if (story.stage === 0 && story.status === "active") {
        try{
          btn.disabled = true;
          btn.textContent = "Gerando...";
          const seg = await geminiGenerateSegment(story, 0);
          story.fullText = seg.text.trim();
          story.pendingChoices = seg.choices;
          story.pendingChoiceAt = 1;
          story.stage = 50;
          saveStory(story);
          location.hash = `#/story/${storyId}`;
        } catch(e){
          errEl.textContent = e?.message || "Erro ao gerar.";
        } finally {
          btn.disabled = false;
          btn.textContent = "Atualizar";
        }
      } else {
        renderStories();
      }
    });
  });

  app.appendChild(root);

// 1 tentativa automática: se faltar opções nas pausas ou a conclusão parecer truncada, tenta uma única vez.
(async ()=>{
  if (didAutoRepair) return;
  if (pageIndex !== story.pages.length) return;
  if (!store.getLicense()) return;
  if (story.pendingChoices) return;

  const needChoices = ((story.stage === 50 || story.stage === 90) && !story.pendingChoices);
  const needFinish = (story.stage === 100 && likelyTruncated(story.fullText));
  if (!needChoices && !needFinish) return;

  didAutoRepair = true;
  err.textContent = needChoices ? "Gerando opções (1 tentativa automática)..." : "Concluindo trecho (1 tentativa automática)...";

  try{
    if (needChoices) {
      const seg = await geminiContinue(story, "need_choices");
      if (seg.text) story.fullText = (story.fullText + "\n\n" + seg.text.trim()).trim();
      if (seg.choices && seg.choices.length === 3) {
        story.pendingChoices = seg.choices;
        story.pendingChoiceAt = (story.stage === 50) ? 1 : 2;
        err.textContent = "";
      } else {
        err.textContent = "Não foi possível gerar opções automaticamente. Use Atualizar para tentar manualmente.";
      }
    } else if (needFinish) {
      const seg = await geminiContinue(story, "need_finish");
      if (seg.text) story.fullText = (story.fullText + "\n\n" + seg.text.trim()).trim();
      err.textContent = "";
    }
    saveStory(story);
    renderText();
    renderControls();
    updatePager();
  } catch(e){
    err.textContent = (e?.message || "Falha na tentativa automática.") + " Use Atualizar para tentar manualmente.";
  }
})();

}

function renderTutorial(){
  app.innerHTML = "";
  app.appendChild(el(`
    <div class="card">
      <h2 class="title">Tutorial</h2>
      <p class="muted">
        Capítulo: 50% (Pausa 1 com 3 opções) → 90% (Pausa 2 com 3 opções) → 100% (conclusão).
        Atualizar é apenas para reparar falhas de geração (texto cortado ou opções ausentes).
      </p>
    </div>
  `));
}

function renderControls(){
  const s = store.getAudioSettings();
  const currentModel = store.getModel();

  app.innerHTML = "";
  const root = el(`
    <div class="card">
      <h2 class="title">Controles</h2>
      <p class="muted">Ajuste narração e modelo do Gemini.</p>
      <div class="hr"></div>

      <label>Modelo Gemini</label>
      <select id="model">
        ${["gemini-2.5-flash","gemini-2.0-flash","gemini-2.0-flash-lite","gemini-flash-latest"].map(m => `<option value="${m}" ${m===currentModel?"selected":""}>${m}</option>`).join("")}
      </select>
      <p class="muted">Modelo atual: <b id="modelV">${escapeHtml(currentModel)}</b></p>

      <div class="hr"></div>

      <label>Velocidade</label>
      <input id="rate" type="range" min="0.7" max="1.3" step="0.05" value="${s.rate}"/>
      <div class="muted">Atual: <span id="rateV">${s.rate.toFixed(2)}</span></div>

      <label style="margin-top:18px;">Volume</label>
      <input id="vol" type="range" min="0" max="1" step="0.05" value="${s.volume}"/>
      <div class="muted">Atual: <span id="volV">${Math.round(s.volume*100)}%</span></div>

      <label style="margin-top:18px;">Voz (PT-BR)</label>
      <select id="voice">
        <option value="pt-BR" ${s.voiceHint==="pt-BR"?"selected":""}>pt-BR (preferencial)</option>
        <option value="pt" ${s.voiceHint==="pt"?"selected":""}>pt (alternativo)</option>
      </select>
    </div>
  `);

  root.querySelector("#model").addEventListener("change", (e)=>{
    const v = e.target.value;
    store.setModel(v);
    root.querySelector("#modelV").textContent = v;
    updateBadge();
  });

  root.querySelector("#rate").addEventListener("input", (e)=>{
    const rate = Number(e.target.value);
    store.setAudioSettings({ ...store.getAudioSettings(), rate });
    root.querySelector("#rateV").textContent = rate.toFixed(2);
  });

  root.querySelector("#vol").addEventListener("input", (e)=>{
    const volume = Number(e.target.value);
    store.setAudioSettings({ ...store.getAudioSettings(), volume });
    root.querySelector("#volV").textContent = `${Math.round(volume*100)}%`;
  });

  root.querySelector("#voice").addEventListener("change", (e)=>{
    const voiceHint = e.target.value;
    store.setAudioSettings({ ...store.getAudioSettings(), voiceHint });
  });

  app.appendChild(root);

// 1 tentativa automática: se faltar opções nas pausas ou a conclusão parecer truncada, tenta uma única vez.
(async ()=>{
  if (didAutoRepair) return;
  if (pageIndex !== story.pages.length) return;
  if (!store.getLicense()) return;
  if (story.pendingChoices) return;

  const needChoices = ((story.stage === 50 || story.stage === 90) && !story.pendingChoices);
  const needFinish = (story.stage === 100 && likelyTruncated(story.fullText));
  if (!needChoices && !needFinish) return;

  didAutoRepair = true;
  err.textContent = needChoices ? "Gerando opções (1 tentativa automática)..." : "Concluindo trecho (1 tentativa automática)...";

  try{
    if (needChoices) {
      const seg = await geminiContinue(story, "need_choices");
      if (seg.text) story.fullText = (story.fullText + "\n\n" + seg.text.trim()).trim();
      if (seg.choices && seg.choices.length === 3) {
        story.pendingChoices = seg.choices;
        story.pendingChoiceAt = (story.stage === 50) ? 1 : 2;
        err.textContent = "";
      } else {
        err.textContent = "Não foi possível gerar opções automaticamente. Use Atualizar para tentar manualmente.";
      }
    } else if (needFinish) {
      const seg = await geminiContinue(story, "need_finish");
      if (seg.text) story.fullText = (story.fullText + "\n\n" + seg.text.trim()).trim();
      err.textContent = "";
    }
    saveStory(story);
    renderText();
    renderControls();
    updatePager();
  } catch(e){
    err.textContent = (e?.message || "Falha na tentativa automática.") + " Use Atualizar para tentar manualmente.";
  }
})();

}

function renderTerms(){
  const current = store.getLicense() || "";
  app.innerHTML = "";
  const root = el(`
    <div class="card">
      <h2 class="title">Termos e Condições</h2>
      <p class="muted">Insira a Licença de Uso (Gemini) para permitir geração.</p>
      <div class="hr"></div>

      <label>Licença de Uso (Gemini)</label>
      <input id="lic" type="password" placeholder="Cole aqui sua licença de uso" value="${escapeAttr(current)}" />
      <p class="muted">A licença é armazenada apenas neste navegador.</p>

      <div class="row" style="margin-top:16px;">
        <button class="btn" id="save">Salvar Licença</button>
        <button class="btn secondary" id="clear">Limpar</button>
        <span class="muted" id="msg"></span>
      </div>
    </div>
  `);

  root.querySelector("#save").addEventListener("click", ()=>{
    const v = root.querySelector("#lic").value.trim();
    if (!v) return;
    store.setLicense(v);
    root.querySelector("#msg").textContent = "Licença salva.";
    setTimeout(()=> root.querySelector("#msg").textContent="", 1500);
  });

  root.querySelector("#clear").addEventListener("click", ()=>{
    store.setLicense("");
    root.querySelector("#lic").value = "";
    root.querySelector("#msg").textContent = "Licença removida.";
    setTimeout(()=> root.querySelector("#msg").textContent="", 1500);
  });

  app.appendChild(root);

// 1 tentativa automática: se faltar opções nas pausas ou a conclusão parecer truncada, tenta uma única vez.
(async ()=>{
  if (didAutoRepair) return;
  if (pageIndex !== story.pages.length) return;
  if (!store.getLicense()) return;
  if (story.pendingChoices) return;

  const needChoices = ((story.stage === 50 || story.stage === 90) && !story.pendingChoices);
  const needFinish = (story.stage === 100 && likelyTruncated(story.fullText));
  if (!needChoices && !needFinish) return;

  didAutoRepair = true;
  err.textContent = needChoices ? "Gerando opções (1 tentativa automática)..." : "Concluindo trecho (1 tentativa automática)...";

  try{
    if (needChoices) {
      const seg = await geminiContinue(story, "need_choices");
      if (seg.text) story.fullText = (story.fullText + "\n\n" + seg.text.trim()).trim();
      if (seg.choices && seg.choices.length === 3) {
        story.pendingChoices = seg.choices;
        story.pendingChoiceAt = (story.stage === 50) ? 1 : 2;
        err.textContent = "";
      } else {
        err.textContent = "Não foi possível gerar opções automaticamente. Use Atualizar para tentar manualmente.";
      }
    } else if (needFinish) {
      const seg = await geminiContinue(story, "need_finish");
      if (seg.text) story.fullText = (story.fullText + "\n\n" + seg.text.trim()).trim();
      err.textContent = "";
    }
    saveStory(story);
    renderText();
    renderControls();
    updatePager();
  } catch(e){
    err.textContent = (e?.message || "Falha na tentativa automática.") + " Use Atualizar para tentar manualmente.";
  }
})();

}

function likelyTruncated(text){
  const t = String(text||"").trim();
  if (!t) return false;
  const last = t.slice(-1);
  return (t.length > 200 && !['.','!','?','”','"'].includes(last));
}

function renderStory(storyId){
  const story = getStory(storyId);
  if (!story) { location.hash = "#/stories"; return; }

  story.pages = Array.isArray(story.pages) ? story.pages : [];
  let pageIndex = story.pages.length; // current
  let didAutoRepair = false;

  app.innerHTML = "";
  const root = el(`
    <div class="grid">
      <div class="card">
        <div class="row" style="justify-content:space-between;">
          <div>
            <h2 class="title" style="margin-bottom:8px;">${escapeHtml(story.title || "(sem título)")}</h2>
            <div class="muted">Status: ${story.status} | Capítulo: ${story.chapter} | Estágio: ${story.stage}%</div>
          </div>
          <div class="row">
            <a class="pill" href="#/story/${storyId}/details">Exibir detalhes</a>
          </div>
        </div>

        <div class="hr"></div>

        <div class="row">
          <button class="btn secondary" id="refresh">Atualizar</button>
          <button class="btn" id="narrate">Narrar</button>
          <button class="btn secondary" id="stop">Parar</button>
        </div>

        <div class="row" style="margin-top:12px; justify-content:space-between;">
          <div class="row">
            <button class="btn secondary" id="prevPage">&lt;&lt;</button>
            <button class="btn secondary" id="nextPage">&gt;&gt;</button>
          </div>
          <div class="muted" id="pageLabel"></div>
        </div>

        <div class="error" id="err" style="margin-top:12px;"></div>

        <div class="hr"></div>
        <div class="textBox" id="text"></div>

        <div id="choiceBlock" style="display:none;">
          <div class="hr"></div>
          <div class="muted" id="pauseLabel"></div>
          <div class="choices" id="choices"></div>
        </div>

        <div id="nextBlock" style="display:none;">
          <div class="hr"></div>
          <button class="btn" id="next">Avançar para o próximo capítulo</button>
        </div>

        <div id="endedBlock" style="display:none;">
          <div class="hr"></div>
          <p class="muted">Esta história foi encerrada. Você pode apenas consultar as páginas.</p>
        </div>
      </div>

      <div class="card">
        <h2 class="title">Informações</h2>
        <p class="muted">Fluxo: 50% (3 opções) → 90% (3 opções) → 100%.</p>
        <div class="hr"></div>
        <p class="muted">Modelo Gemini: <b>${escapeHtml(store.getModel())}</b></p>
      </div>
    </div>
  `);

  const err = root.querySelector("#err");
  const textBox = root.querySelector("#text");
  const prevBtn = root.querySelector("#prevPage");
  const nextBtn = root.querySelector("#nextPage");
  const pageLabel = root.querySelector("#pageLabel");

  function updatePager(){
    const isCurrent = (pageIndex === story.pages.length);
    prevBtn.disabled = (pageIndex <= 0);
    nextBtn.disabled = (pageIndex >= story.pages.length);

    if (isCurrent) {
      pageLabel.textContent = `Página atual (CAP${story.chapter})`;
    } else {
      const p = story.pages[pageIndex];
      pageLabel.textContent = `${p?.label || "Página"} • ${new Date(p.at).toLocaleString()}`;
    }
  }

  prevBtn.addEventListener("click", ()=>{
    if (prevBtn.disabled) return;
    pageIndex -= 1;
    tts.stop();
    renderText();
    renderControls();
    updatePager();
  });

  nextBtn.addEventListener("click", ()=>{
    if (pageIndex >= story.pages.length) return;
    pageIndex += 1;
    tts.stop();
    renderText();
    renderControls();
    updatePager();
  });

  function renderText(){
    const isCurrent = (pageIndex === story.pages.length);
    const sourceText = isCurrent ? (story.fullText || "") : (story.pages[pageIndex]?.text || "");
    const parts = store.splitSentences(sourceText);
    textBox.innerHTML = "";
    parts.forEach((p, i) => {
      const span = document.createElement("span");
      span.textContent = p + " ";
      span.dataset.i = String(i);
      textBox.appendChild(span);
    });
  }

  function setHighlight(idx){
    [...textBox.querySelectorAll("span")].forEach(s => s.classList.remove("hl"));
    const e = textBox.querySelector(`span[data-i="${idx}"]`);
    if (e) e.classList.add("hl");
  }

  function lockChoicesUI(message){
    const wrap = root.querySelector("#choices");
    if (wrap) [...wrap.querySelectorAll("button")].forEach(b => { b.disabled = true; });
    const label = root.querySelector("#pauseLabel");
    if (label && message) label.textContent = message;
  }

  function renderControls(){
    const isReadOnly = (pageIndex !== story.pages.length);

    const cb = root.querySelector("#choiceBlock");
    const pauseLabel = root.querySelector("#pauseLabel");
    const choices = root.querySelector("#choices");

    cb.style.display = (!isReadOnly && story.pendingChoices) ? "block" : "none";
    choices.innerHTML = "";

    if (!isReadOnly && story.pendingChoices) {
      pauseLabel.textContent = `Pausa ${story.pendingChoiceAt} — escolha uma opção (irreversível):`;
      story.pendingChoices.forEach((c, idx) => {
        const b = el(`<button class="choice">${escapeHtml(c)}</button>`);
        b.addEventListener("click", () => choose(idx));
        choices.appendChild(b);
      });
    }

    root.querySelector("#nextBlock").style.display = (!isReadOnly && canAdvanceChapter(story)) ? "block" : "none";
    root.querySelector("#endedBlock").style.display = (story.status !== "active") ? "block" : "none";
  }

  async function choose(index){
    err.textContent = "";
    tts.stop();

    if (!store.getLicense()) { err.textContent = "Insira a Licença de Uso em Termos antes de continuar."; return; }
    if (!story.pendingChoices) return;

    // feedback imediato
    lockChoicesUI("Escolha aceita — gerando sequência...");

    addChoice(story, index);
    resetPending(story);
    const stageBefore = story.stage;

    try{
      if (stageBefore === 50) {
        const seg = await geminiGenerateSegment(story, 50); // deve trazer escolhas 2
        archiveCurrentAsPage(story);
        story.fullText = seg.text.trim();
        story.pendingChoices = seg.choices;
        story.pendingChoiceAt = 2;
        story.stage = 90;
      } else if (stageBefore === 90) {
        const seg = await geminiGenerateSegment(story, 90); // conclusão
        archiveCurrentAsPage(story);
        story.fullText = seg.text.trim();
        story.pendingChoices = null;
        story.pendingChoiceAt = null;
        story.stage = 100;
        if (story.chapter >= 10) story.status = "completed";
      }
      saveStory(story);
      pageIndex = story.pages.length;
      renderText();
      renderControls();
      updatePager();
      if ((story.stage === 50 || story.stage === 90) && !story.pendingChoices)if (story.stage === 100 && !story.pendingChoices && likelyTruncated(story.fullText))} catch(e){
      err.textContent = e?.message || "Erro ao chamar Gemini.";
      renderControls();
    }
  }

  // Atualizar: apenas para reparar geração incompleta (texto cortado ou opções ausentes)

// --- Auto-reparo: enquanto não houver opções (50%/90%) ou conclusão (100%), tenta corrigir automaticamente ---
let autoHealTimer = null;
let autoHealRunning = false;
let autoHealAttempts = 0;

function clearAutoHeal(){
  if (autoHealTimer) clearTimeout(autoHealTimer);
  autoHealTimer = null;
  autoHealRunning = false;
  autoHealAttempts = 0;
}

function scheduleAutoHeal(delayMs){
  if (autoHealTimer) clearTimeout(autoHealTimer);
  autoHealTimer = setTimeout(async () => {
    await autoHealTick();
  }, delayMs);
}

function needsChoicesNow(){
  return (pageIndex === story.pages.length) && !story.pendingChoices && (story.stage === 50 || story.stage === 90);
}

function needsFinishNow(){
  return (pageIndex === story.pages.length) && !story.pendingChoices && (story.stage === 100) && likelyTruncated(story.fullText);
}

async function autoHealTick(){
    if (pageIndex !== story.pages.length) return;
    if (story.pendingChoices) { clearAutoHeal(); return; }
    if (!store.getLicense()) { clearAutoHeal(); return; }

    const needChoices = needsChoicesNow();
    const needFinish = needsFinishNow();
    if (!needChoices && !needFinish) { clearAutoHeal(); return; }

    if (autoHealRunning) return;
    autoHealRunning = true;

    try{
      autoHealAttempts += 1;
      const nextDelay = Math.min(4500, Math.round(600 * (1.5 ** Math.min(6, autoHealAttempts))));

      err.textContent = needChoices ? "Reparando automaticamente: gerando opções..." : "Reparando automaticamente: concluindo trecho...";

      if (needChoices) {
        const seg = await geminiContinue(story, "need_choices");
        if (seg.text) story.fullText = (story.fullText + "

" + seg.text.trim()).trim();
        if (seg.choices && seg.choices.length === 3) {
          story.pendingChoices = seg.choices;
          story.pendingChoiceAt = (story.stage === 50) ? 1 : 2;
        }
        saveStory(story);
      } else if (needFinish) {
        const seg = await geminiContinue(story, "need_finish");
        if (seg.text) story.fullText = (story.fullText + "

" + seg.text.trim()).trim();
        saveStory(story);
      }

      renderText();
      renderControls();
      updatePager();

      if (needsChoicesNow() || needsFinishNow()) {
        if (autoHealAttempts >= 5) {
          err.textContent = "Reparo automático não concluiu. Use Atualizar para forçar nova tentativa.";
          clearAutoHeal();
          return;
        }
        autoHealRunning = false;return;
      }

      err.textContent = "";
      clearAutoHeal();
    } catch(e){
      if (autoHealAttempts >= 5) {
        err.textContent = (e?.message || "Falha no reparo automático.") + " Use Atualizar para tentar manualmente.";
        clearAutoHeal();
      } else {
        autoHealRunning = false;}
    } finally {
      autoHealRunning = false;
    }
}
);

  root.querySelector("#narrate").addEventListener("click", ()=>{
    const isCurrent = (pageIndex === story.pages.length);
    const sourceText = isCurrent ? (story.fullText || "") : (story.pages[pageIndex]?.text || "");
    const parts = store.splitSentences(sourceText);
    tts.speak(parts, (idx)=> setHighlight(idx));
  });

  root.querySelector("#stop").addEventListener("click", ()=>{
    tts.stop();
    setHighlight(-1);
  });

  root.querySelector("#next").addEventListener("click", async ()=>{
    err.textContent = "";
    tts.stop();

    if (!store.getLicense()) { err.textContent = "Insira a Licença de Uso em Termos antes de avançar."; return; }
    if (!canAdvanceChapter(story)) return;

    const nextBtn = root.querySelector("#next");
    const old = nextBtn.textContent;
    nextBtn.disabled = true;
    nextBtn.textContent = "Gerando próximo capítulo...";

    try{
      nextChapterInit(story);
      const seg = await geminiGenerateSegment(story, 0); // novo cap começa em 50% com escolhas 1
      archiveCurrentAsPage(story);
      story.fullText = seg.text.trim();
      story.pendingChoices = seg.choices;
      story.pendingChoiceAt = 1;
      story.stage = 50;

      saveStory(story);
      pageIndex = story.pages.length;
      renderText();
      renderControls();
      updatePager();
      if ((story.stage === 50 || story.stage === 90) && !story.pendingChoices)if (story.stage === 100 && !story.pendingChoices && likelyTruncated(story.fullText))} catch(e){
      err.textContent = e?.message || "Falha ao gerar próximo capítulo.";
    } finally {
      nextBtn.disabled = false;
      nextBtn.textContent = old;
    }
  });

  renderText();
  renderControls();
  updatePager();
  app.appendChild(root);

// 1 tentativa automática: se faltar opções nas pausas ou a conclusão parecer truncada, tenta uma única vez.
(async ()=>{
  if (didAutoRepair) return;
  if (pageIndex !== story.pages.length) return;
  if (!store.getLicense()) return;
  if (story.pendingChoices) return;

  const needChoices = ((story.stage === 50 || story.stage === 90) && !story.pendingChoices);
  const needFinish = (story.stage === 100 && likelyTruncated(story.fullText));
  if (!needChoices && !needFinish) return;

  didAutoRepair = true;
  err.textContent = needChoices ? "Gerando opções (1 tentativa automática)..." : "Concluindo trecho (1 tentativa automática)...";

  try{
    if (needChoices) {
      const seg = await geminiContinue(story, "need_choices");
      if (seg.text) story.fullText = (story.fullText + "\n\n" + seg.text.trim()).trim();
      if (seg.choices && seg.choices.length === 3) {
        story.pendingChoices = seg.choices;
        story.pendingChoiceAt = (story.stage === 50) ? 1 : 2;
        err.textContent = "";
      } else {
        err.textContent = "Não foi possível gerar opções automaticamente. Use Atualizar para tentar manualmente.";
      }
    } else if (needFinish) {
      const seg = await geminiContinue(story, "need_finish");
      if (seg.text) story.fullText = (story.fullText + "\n\n" + seg.text.trim()).trim();
      err.textContent = "";
    }
    saveStory(story);
    renderText();
    renderControls();
    updatePager();
  } catch(e){
    err.textContent = (e?.message || "Falha na tentativa automática.") + " Use Atualizar para tentar manualmente.";
  }
})();


  // Auto-reparo: se faltar opções nas pausas ou a conclusão parecer truncada, tenta automaticamente
  if ((story.stage === 50 || story.stage === 90) && !story.pendingChoices && pageIndex === story.pages.length) {
    err.textContent = "Pausa sem opções: reparo automático em andamento...";}
  if (story.stage === 100 && !story.pendingChoices && likelyTruncated(story.fullText) && pageIndex === story.pages.length) {
    err.textContent = "Trecho possivelmente incompleto: reparo automático em andamento...";}
}

function renderDetails(storyId){
  const story = getStory(storyId);
  if (!story) { location.hash = "#/stories"; return; }
  story.pages = Array.isArray(story.pages) ? story.pages : [];

  app.innerHTML = "";
  const root = el(`
    <div class="card">
      <h2 class="title">Detalhes</h2>
      <div class="muted">
        <b>${escapeHtml(story.title || "(sem título)")}</b><br/>
        Status: ${story.status}<br/>
        Capítulo atual: ${story.chapter}<br/>
        Estágio: ${story.stage}%<br/>
        Páginas arquivadas: ${story.pages.length}<br/>
        Criada em: ${new Date(story.createdAt).toLocaleString()}<br/>
        Atualizada em: ${new Date(story.updatedAt).toLocaleString()}
      </div>

      <div class="hr"></div>

      <div class="row">
        <button class="btn danger" id="del">Deletar História</button>
        <span class="muted" id="msg"></span>
      </div>
    </div>
  `);

  root.querySelector("#del").addEventListener("click", ()=>{
    deleteStory(storyId);
    root.querySelector("#msg").textContent = "História deletada.";
    setTimeout(()=> { location.hash = "#/stories"; }, 350);
  });

  app.appendChild(root);

// 1 tentativa automática: se faltar opções nas pausas ou a conclusão parecer truncada, tenta uma única vez.
(async ()=>{
  if (didAutoRepair) return;
  if (pageIndex !== story.pages.length) return;
  if (!store.getLicense()) return;
  if (story.pendingChoices) return;

  const needChoices = ((story.stage === 50 || story.stage === 90) && !story.pendingChoices);
  const needFinish = (story.stage === 100 && likelyTruncated(story.fullText));
  if (!needChoices && !needFinish) return;

  didAutoRepair = true;
  err.textContent = needChoices ? "Gerando opções (1 tentativa automática)..." : "Concluindo trecho (1 tentativa automática)...";

  try{
    if (needChoices) {
      const seg = await geminiContinue(story, "need_choices");
      if (seg.text) story.fullText = (story.fullText + "\n\n" + seg.text.trim()).trim();
      if (seg.choices && seg.choices.length === 3) {
        story.pendingChoices = seg.choices;
        story.pendingChoiceAt = (story.stage === 50) ? 1 : 2;
        err.textContent = "";
      } else {
        err.textContent = "Não foi possível gerar opções automaticamente. Use Atualizar para tentar manualmente.";
      }
    } else if (needFinish) {
      const seg = await geminiContinue(story, "need_finish");
      if (seg.text) story.fullText = (story.fullText + "\n\n" + seg.text.trim()).trim();
      err.textContent = "";
    }
    saveStory(story);
    renderText();
    renderControls();
    updatePager();
  } catch(e){
    err.textContent = (e?.message || "Falha na tentativa automática.") + " Use Atualizar para tentar manualmente.";
  }
})();

}
