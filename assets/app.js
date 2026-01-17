
const APP_META = {
  name: "HistorIA",
  version: "5.2",
  engine: "gemini-2.5-flash"
};

import { store, createStory, findDuplicate, listStories, getStory, saveStory, deleteStory, addChoice, resetPending, canAdvanceChapter, nextChapterInit, addPageSnapshot, getPageById } from "./store.js";
import { tts } from "./tts.js";
import { geminiGenerateSegment } from "./gemini.js";

const app = document.getElementById("app");
const badgeModel = document.getElementById("badgeModel");

function escapeHtml(s="") {
  return String(s).replace(/[&<>"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[m]));
}
function escapeAttr(s="") {
  return escapeHtml(s).replace(/"/g, "&quot;");
}
function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function updateBadge(){
  badgeModel.textContent = `5.1 • Static • ${store.getModel()}`;
}
updateBadge();

function route() {
  updateBadge();
  const hash = location.hash || "#/";
  const [path, id, sub] = hash.replace("#/", "").split("/");
  if (!path) return renderHome();
  if (path === "stories") return renderStories();
  if (path === "tutorial") return renderTutorial();
  if (path === "controls") return renderControls();
  if (path === "terms") return renderTerms();
  if (path === "story" && id && sub === "details") return renderDetails(id);
  if (path === "story" && id) return renderStory(id);
  return renderHome();
}
window.addEventListener("hashchange", route);
window.addEventListener("load", route);

function renderHome() {
  const s = store.getAudioSettings();
  app.innerHTML = "";
  app.appendChild(el(`
    <div class="grid">
      <div class="card">
        <h2 class="title">Criar História</h2>
        <p class="muted">
          A história será gerada de forma progressiva, com duas pausas por capítulo e três escolhas em cada pausa.
          Após iniciar, escolhas e opções não podem ser revertidas.
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
          <label for="fp" style="margin:0;">Ativar Primeira Pessoa (o leitor vira personagem; a história pode terminar se você morrer)</label>
        </div>

        <div class="hr"></div>

        <div class="notice" id="licenseNotice" style="display:none;">
          <div class="muted">Para gerar a história, insira a <b>Licença de Uso</b> em <a href="#/terms"><u>Termos</u></a>.</div>
        </div>

        <div class="row" style="margin-top:16px;">
          <button class="btn" id="start">Iniciar História</button>
          <a class="pill" href="#/terms">Ler Termos</a>
        </div>

        <p class="muted" style="margin-top:16px;">Narração: PT-BR (Web Speech API). Ajuste em <b>Controles</b>.</p>
        <p class="muted">Velocidade atual: <b>${s.rate.toFixed(2)}</b> • Volume: <b>${Math.round(s.volume*100)}%</b></p>
        <p class="muted">Modelo Gemini atual: <b>${escapeHtml(store.getModel())}</b></p>

        <div class="error" id="err" style="margin-top:12px;"></div>
      </div>

      <div class="card">
        <h2 class="title">Estado do produto</h2>
        <ul class="muted" style="margin-top:0; line-height:1.9;">
          <li>Gemini como núcleo narrativo único.</li>
          <li>Persistência local em <b>localStorage</b>.</li>
          <li>Sem build/servidor: pronto para GitHub Pages.</li>
          <li>Livro: páginas e escolhas ficam registradas.</li>
        </ul>
      </div>
    </div>
  `));

  if (!store.getLicense()) app.querySelector("#licenseNotice").style.display = "block";

  app.querySelector("#start").addEventListener("click", async () => {
    const err = app.querySelector("#err");
    err.textContent = "";

    if (!store.getLicense()) {
      err.textContent = "Insira a Licença de Uso em Termos e Condições antes de iniciar.";
      return;
    }

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
    saveStory(story);

    const startBtn = app.querySelector("#start");
    startBtn.disabled = true;
    startBtn.textContent = "Gerando...";

    try{
      const seg = await geminiGenerateSegment(story, 0);
      story.fullText = seg.text.trim();
      story.pendingChoices = seg.choices;
      story.pendingChoiceAt = 1;
      story.stage = 50;

      addPageSnapshot(story, `Capítulo ${story.chapter} • 50%`);

      if (store.deathHeuristic(story, seg.text)) {
        story.status = "ended";
        story.pendingChoices = null;
        story.pendingChoiceAt = null;
        story.stage = 100;
        addPageSnapshot(story, `Capítulo ${story.chapter} • Encerrada`);
      }

      saveStory(story);
      location.hash = `#/story/${story.storyId}`;
    } catch(e){
      err.textContent = e?.message || "Erro ao chamar Gemini.";
      startBtn.disabled = false;
      startBtn.textContent = "Iniciar História";
    }
  });
}

function renderStories() {
  const items = listStories();
  app.innerHTML = "";
  const root = el(`
    <div class="card">
      <h2 class="title">Minhas Histórias</h2>
      <p class="muted">Sem edição. Você pode continuar, ver detalhes e ler páginas anteriores.</p>
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
    btn.addEventListener("click", async () => {
      const storyId = btn.dataset.id;
      const errEl = root.querySelector(`[data-err="${storyId}"]`);
      errEl.textContent = "";
      const story = getStory(storyId);
      if (!story) return;

      if (story.stage === 0 && story.status === "active") {
        if (!store.getLicense()) { errEl.textContent = "Defina a Licença de Uso em Termos."; return; }
        try{
          btn.disabled = true;
          btn.textContent = "Gerando...";
          const seg = await geminiGenerateSegment(story, 0);
          story.fullText = seg.text.trim();
          story.pendingChoices = seg.choices;
          story.pendingChoiceAt = 1;
          story.stage = 50;
          addPageSnapshot(story, `Capítulo ${story.chapter} • 50%`);
          saveStory(story);
          location.hash = `#/story/${storyId}`;
        } catch(e){
          errEl.textContent = e?.message || "Erro ao regenerar.";
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
}

function renderTutorial() {
  app.innerHTML = "";
  app.appendChild(el(`
    <div class="card">
      <h2 class="title">Tutorial</h2>
      <p class="muted">O HistorIA cria histórias fictícias de forma interativa. Cada capítulo é gerado em etapas e sempre possui duas pausas com escolhas.</p>
      <div class="hr"></div>
      <ol style="line-height:2.0;">
        <li>Defina título, premissa, núcleos, tom e (opcional) Primeira Pessoa.</li>
        <li>Insira sua Licença de Uso (Gemini) em Termos.</li>
        <li>Inicie a história. O capítulo 1 será gerado até ~50%.</li>
        <li>Pausa 1: escolha 1 de 3 opções (irreversível).</li>
        <li>O capítulo continua até ~90% e pausa novamente.</li>
        <li>Pausa 2: escolha 1 de 3 opções (irreversível).</li>
        <li>O capítulo é concluído e você pode avançar para o próximo.</li>
      </ol>
      <p class="muted">Após iniciar, não é possível alterar tom/enredo/núcleos nem refazer escolhas. No modo Primeira Pessoa, a história pode terminar se o personagem morrer.</p>
    </div>
  `));
}

function renderControls() {
  const s = store.getAudioSettings();
  const currentModel = store.getModel();
  app.innerHTML = "";
  const root = el(`
    <div class="card">
      <h2 class="title">Controles</h2>
      <p class="muted">Ajuste a narração (Web Speech API) em PT-BR e o modelo do Gemini.</p>
      <div class="hr"></div>

      <label>Modelo Gemini</label>
      <select id="model">
        ${[
          "gemini-2.5-flash",
          "gemini-2.0-flash",
          "gemini-2.0-flash-lite",
          "gemini-flash-latest"
        ].map(m => `<option value="${m}" ${m===currentModel?"selected":""}>${m}</option>`).join("")}
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

      <p class="muted" style="margin-top:18px;">Observação: a disponibilidade de vozes depende do navegador e do sistema operacional.</p>
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
}

function renderTerms() {
  const current = store.getLicense() || "";
  app.innerHTML = "";
  const root = el(`
    <div class="card">
      <h2 class="title">Termos e Condições</h2>
      <p class="muted">Ao utilizar o HistorIA, você concorda com os termos abaixo e declara possuir uma licença válida para uso do motor narrativo.</p>

      <div class="hr"></div>

      <ul style="line-height:2.0;">
        <li>O HistorIA é uma plataforma de entretenimento narrativo fictício.</li>
        <li>As escolhas realizadas durante a história são definitivas.</li>
        <li>O conteúdo é gerado por IA e pode conter imprecisões.</li>
        <li>Não insira dados pessoais, sensíveis ou confidenciais.</li>
      </ul>

      <div class="hr"></div>

      <label>Licença de Uso (Gemini)</label>
      <input id="lic" type="password" placeholder="Cole aqui sua licença de uso" value="${escapeAttr(current)}" />
      <p class="muted">Esta licença é armazenada apenas neste navegador e não é enviada ao GitHub.</p>

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
    setTimeout(()=> root.querySelector("#msg").textContent="", 2000);
  });
  root.querySelector("#clear").addEventListener("click", ()=>{
    store.setLicense("");
    root.querySelector("#lic").value = "";
    root.querySelector("#msg").textContent = "Licença removida.";
    setTimeout(()=> root.querySelector("#msg").textContent="", 2000);
  });
  app.appendChild(root);
}

function renderStory(storyId) {
  const story = getStory(storyId);
  if (!story) { location.hash = "#/stories"; return; }

  story.pages = Array.isArray(story.pages) ? story.pages : [];
  if ((story.fullText || "").trim() && story.pages.length === 0) {
    addPageSnapshot(story, `Capítulo ${story.chapter} • ${story.stage}%`);
    saveStory(story);
  }

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

        <div class="row" style="margin-top:12px;">
          <div style="flex:1; min-width:280px;">
            <label style="margin:0 0 6px;">Leitura (páginas)</label>
            <select id="pageSel"></select>
            <div class="muted" style="margin-top:10px;">Ao selecionar uma página anterior, a leitura é apenas consultiva.</div>
          </div>
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
          <p class="muted">Esta história foi encerrada. Você pode apenas consultar os detalhes.</p>
        </div>
      </div>

      <div class="card">
        <h2 class="title">Informações</h2>
        <p class="muted">Fluxo fixo por capítulo: 50% → Escolha 1 (3 opções) → 90% → Escolha 2 (3 opções) → conclusão.</p>
        <div class="hr"></div>
        <p class="muted">Modelo Gemini atual: <b>${escapeHtml(store.getModel())}</b></p>
        <p class="muted">Configure Licença de Uso em <a href="#/terms"><u>Termos</u></a>.</p>
      </div>
    </div>
  `);

  const err = root.querySelector("#err");
  const textBox = root.querySelector("#text");
  const pageSel = root.querySelector("#pageSel");
  let viewPageId = "CURRENT";

  function refreshPageOptions(){
    pageSel.innerHTML = "";
    const cur = document.createElement("option");
    cur.value = "CURRENT";
    cur.textContent = `Atual (Cap ${story.chapter} • ${story.stage}%)`;
    pageSel.appendChild(cur);

    story.pages.forEach(p => {
      const o = document.createElement("option");
      o.value = p.id;
      o.textContent = `${p.label} • ${new Date(p.at).toLocaleString()}`;
      pageSel.appendChild(o);
    });

    pageSel.value = viewPageId;
  }

  pageSel.addEventListener("change", ()=>{
    viewPageId = pageSel.value;
    renderText();
    renderControls();
  });

  function renderText() {
    const page = (viewPageId !== "CURRENT") ? getPageById(story, viewPageId) : null;
    const sourceText = page ? page.text : (story.fullText || "");
    const parts = store.splitSentences(sourceText);
    textBox.innerHTML = "";
    parts.forEach((p, i) => {
      const span = document.createElement("span");
      span.textContent = p + " ";
      span.dataset.i = String(i);
      textBox.appendChild(span);
    });
  }

  function setHighlight(idx) {
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

  function renderControls() {
    const isReadOnly = (viewPageId !== "CURRENT");

    const cb = root.querySelector("#choiceBlock");
    const pauseLabel = root.querySelector("#pauseLabel");
    const choices = root.querySelector("#choices");

    cb.style.display = (!isReadOnly && story.pendingChoices) ? "block" : "none";
    choices.innerHTML = "";

    if (!isReadOnly && story.pendingChoices) {
      pauseLabel.textContent = `Pausa ${story.pendingChoiceAt} — escolha uma opção (irreversível):`;
      story.pendingChoices.forEach((c, idx) => {
        const b = el(`<button class="choice">${escapeHtml(c)}</button>`);
        b.addEventListener("click", () => choose(idx, b));
        choices.appendChild(b);
      });
    }

    root.querySelector("#nextBlock").style.display = (!isReadOnly && canAdvanceChapter(story)) ? "block" : "none";
    root.querySelector("#endedBlock").style.display = (story.status !== "active") ? "block" : "none";
  }

  async function choose(index) {
    err.textContent = "";
    tts.stop();

    if (!store.getLicense()) { err.textContent = "Insira a Licença de Uso em Termos antes de continuar."; return; }
    if (!story.pendingChoices) return;

    // Feedback imediato: desativa as 3 opções e sinaliza processamento
    lockChoicesUI("Escolha aceita — gerando sequência...");

    addChoice(story, index);
    resetPending(story);
    const stageBefore = story.stage;

    try{
      if (stageBefore === 50) {
        const seg = await geminiGenerateSegment(story, 50);
        story.fullText = (story.fullText + "\n\n" + seg.text).trim();
        story.pendingChoices = seg.choices;
        story.pendingChoiceAt = 2;
        story.stage = 90;
        addPageSnapshot(story, `Capítulo ${story.chapter} • 90%`);
      } else if (stageBefore === 90) {
        const seg = await geminiGenerateSegment(story, 90);
        story.fullText = (story.fullText + "\n\n" + seg.text).trim();
        story.stage = 100;
        addPageSnapshot(story, `Capítulo ${story.chapter} • 100%`);

        if (store.deathHeuristic(story, seg.text)) {
          story.status = "ended";
          addPageSnapshot(story, `Capítulo ${story.chapter} • Encerrada`);
        } else if (story.chapter >= 10) {
          story.status = "completed";
        }
      } else {
        err.textContent = "Estágio inválido para continuar.";
      }

      saveStory(story);
      refreshPageOptions();
      renderText();
      renderControls();
    } catch(e){
      err.textContent = e?.message || "Erro ao chamar Gemini.";
      renderControls();
    }
  }

  root.querySelector("#refresh").addEventListener("click", ()=>{
    const updated = getStory(storyId);
    if (!updated) return;
    Object.assign(story, updated);
    story.pages = Array.isArray(story.pages) ? story.pages : [];
    refreshPageOptions();
    renderText();
    renderControls();
  });

  root.querySelector("#narrate").addEventListener("click", ()=>{
    const page = (viewPageId !== "CURRENT") ? getPageById(story, viewPageId) : null;
    const sourceText = page ? page.text : (story.fullText || "");
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
    nextBtn.disabled = true;
    const oldText = nextBtn.textContent;
    nextBtn.textContent = "Gerando próximo capítulo...";

    nextChapterInit(story);

    try{
      const seg = await geminiGenerateSegment(story, 0);
      story.fullText = (story.fullText + "\n" + seg.text).trim();
      story.pendingChoices = seg.choices;
      story.pendingChoiceAt = 1;
      story.stage = 50;

      addPageSnapshot(story, `Capítulo ${story.chapter} • 50%`);

      if (store.deathHeuristic(story, seg.text)) {
        story.status = "ended";
        story.pendingChoices = null;
        story.pendingChoiceAt = null;
        story.stage = 100;
        addPageSnapshot(story, `Capítulo ${story.chapter} • Encerrada`);
      }

      saveStory(story);
      refreshPageOptions();
      renderText();
      renderControls();
    } catch(e){
      err.textContent = e?.message || "Erro ao chamar Gemini.";
    } finally {
      nextBtn.disabled = false;
      nextBtn.textContent = oldText;
    }
  });

  refreshPageOptions();
  renderText();
  renderControls();
  app.appendChild(root);
}

function renderDetails(storyId) {
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
        Tom: ${escapeHtml(story.tone)} | Classificação: ${escapeHtml(story.ageRating)} | Primeira Pessoa: ${story.firstPerson ? "Sim" : "Não"}<br/>
        Criada em: ${new Date(story.createdAt).toLocaleString()}<br/>
        Atualizada em: ${new Date(story.updatedAt).toLocaleString()}<br/>
        Páginas salvas: ${story.pages.length}
      </div>

      <div class="hr"></div>

      <div class="muted"><b>Premissa</b></div>
      <div class="textBox">${escapeHtml(story.premise)}</div>

      <div class="hr"></div>

      <div class="muted"><b>Núcleos</b></div>
      <div class="textBox">${escapeHtml(story.nuclei)}</div>

      <div class="hr"></div>

      <div class="muted"><b>Escolhas (histórico imutável)</b></div>
      ${story.choices.length === 0 ? `<div class="muted">Nenhuma escolha registrada ainda.</div>` : `
        <ul style="line-height:2.0;">
          ${story.choices.map(c => `<li>Capítulo ${c.chapter} — Pausa ${c.pause}: <b>${escapeHtml(c.choice)}</b> (${new Date(c.at).toLocaleString()})</li>`).join("")}
        </ul>
      `}

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
}


// ===== PIPELINE NARRATIVO 5.2 =====
async function runStagePipeline(story, stage) {
  if (story._running) return;
  story._running = true;
  story._error = null;

  setUIBusy(true);

  try {
    const apiKey = store.getLicense();
    if (!apiKey) throw new Error("Licença de Uso não configurada");

    // chamada principal
    const raw = await callGemini(buildPrompt(story, stage), apiKey);
    let parsed = parseOutput(raw);

    // validação obrigatória
    if ((stage === 50 || stage === 90) && (!parsed.choices || parsed.choices.length !== 3)) {
      const raw2 = await callGemini(buildFixPrompt(story, stage, parsed.text), apiKey);
      parsed = parseOutput(raw2);
      if (!parsed.choices || parsed.choices.length !== 3) {
        throw new Error("Falha ao gerar escolhas");
      }
    }

    // commit atômico
    commitStage(story, stage, parsed);
    renderAll(story);

  } catch (e) {
    story._error = e.message;
    showError(e.message);
  } finally {
    story._running = false;
    setUIBusy(false);
  }
}

function setUIBusy(flag){
  const btns = document.querySelectorAll("button");
  btns.forEach(b => b.disabled = flag);
  const lbl = document.getElementById("statusLabel");
  if (lbl) lbl.textContent = flag ? "Gerando..." : "";
}
