import { store, createStory, findDuplicate, listStories, getStory, saveStory, deleteStory, addChoice, resetPending } from "./store.js";
import { tts } from "./tts.js";
import { geminiGenerateSegment, geminiContinue } from "./gemini.js";

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
  if (badgeModel) badgeModel.textContent = `3.0 • Static • ${store.getModel()}`;
}

function parseHash(){
  const raw = (location.hash || "#/").trim();
  const cleaned = raw.startsWith("#/") ? raw.slice(2) : (raw.startsWith("#") ? raw.slice(1) : raw);
  return cleaned.split("/").filter(Boolean);
}

function route() {
  updateBadge();
  const parts = parseHash();
  const [path, id, sub] = parts;

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

function renderHome() {
  const s = store.getAudioSettings();
  app.innerHTML = "";
  app.appendChild(el(`
    <div class="grid">
      <div class="card">
        <h2 class="title">Criar História</h2>
        <p class="muted">
          Cada capítulo: 50% → 3 escolhas → 90% → 3 escolhas → conclusão.
          O botão Atualizar tenta continuar a geração caso algum trecho fique incompleto.
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
          <label for="fp" style="margin:0;">Ativar Primeira Pessoa</label>
        </div>

        <div class="hr"></div>

        <div class="notice" id="licenseNotice" style="display:none;">
          <div class="muted">Para gerar a história, insira a <b>Licença de Uso</b> em <a href="#/terms"><u>Termos</u></a>.</div>
        </div>

        <div class="row" style="margin-top:16px;">
          <button class="btn" id="start">Iniciar História</button>
          <a class="pill" href="#/terms">Ler Termos</a>
        </div>

        <p class="muted" style="margin-top:16px;">Velocidade: <b>${s.rate.toFixed(2)}</b> • Volume: <b>${Math.round(s.volume*100)}%</b></p>
        <p class="muted">Modelo Gemini: <b>${escapeHtml(store.getModel())}</b></p>

        <div class="error" id="err" style="margin-top:12px;"></div>
      </div>

      <div class="card">
        <h2 class="title">Estado</h2>
        <ul class="muted" style="margin-top:0; line-height:1.9;">
          <li>Persistência local (localStorage).</li>
          <li>Compatível com GitHub Pages.</li>
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
      <p class="muted">Você pode continuar, ver detalhes e usar Atualizar para completar trechos.</p>
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
              <a class="pill" href="#/story/${s.storyId}">Continuar</a>
              <a class="pill" href="#/story/${s.storyId}/details">Detalhes</a>
            </div>
          </div>
        </div>
      `));
    });
  }
  app.appendChild(root);
}

function renderTutorial() {
  app.innerHTML = "";
  app.appendChild(el(`
    <div class="card">
      <h2 class="title">Tutorial</h2>
      <p class="muted">Cada capítulo tem duas pausas com 3 escolhas. O botão Atualizar tenta continuar trechos incompletos sem alterar escolhas.</p>
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
    route();
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

function isLikelyIncomplete(text){
  const t = String(text||"").trim();
  if (!t) return true;
  const last = t.slice(-1);
  // heurística simples: se termina sem pontuação final e o texto é longo, provavelmente cortou
  return (t.length > 200 && ![".","!","?","”","""].includes(last));
}

function renderStory(storyId) {
  const story = getStory(storyId);
  if (!story) { location.hash = "#/stories"; return; }

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
            <a class="pill" href="#/story/${storyId}/details">Detalhes</a>
          </div>
        </div>

        <div class="hr"></div>

        <div class="row">
          <button class="btn secondary" id="refresh">Atualizar</button>
          <button class="btn" id="narrate">Narrar</button>
          <button class="btn secondary" id="stop">Parar</button>
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
      </div>

      <div class="card">
        <h2 class="title">Informações</h2>
        <p class="muted">Modelo: <b>${escapeHtml(store.getModel())}</b></p>
      </div>
    </div>
  `);

  const err = root.querySelector("#err");
  const textBox = root.querySelector("#text");
  const refreshBtn = root.querySelector("#refresh");

  function renderText() {
    textBox.textContent = "";
    const parts = store.splitSentences(story.fullText || "");
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
    const cb = root.querySelector("#choiceBlock");
    const pauseLabel = root.querySelector("#pauseLabel");
    const choices = root.querySelector("#choices");

    cb.style.display = (story.pendingChoices) ? "block" : "none";
    choices.innerHTML = "";

    if (story.pendingChoices) {
      pauseLabel.textContent = `Pausa ${story.pendingChoiceAt} — escolha uma opção (irreversível):`;
      story.pendingChoices.forEach((c, idx) => {
        const b = el(`<button class="choice">${escapeHtml(c)}</button>`);
        b.addEventListener("click", () => choose(idx));
        choices.appendChild(b);
      });
    }

    // Próximo capítulo somente se concluiu e ainda não chegou no 10
    const canNext = (story.status === "active" && story.stage === 100 && story.chapter < 10);
    root.querySelector("#nextBlock").style.display = canNext ? "block" : "none";
  }

  async function choose(index) {
    err.textContent = "";
    tts.stop();

    if (!store.getLicense()) { err.textContent = "Defina a Licença de Uso em Termos."; return; }
    if (!story.pendingChoices) return;

    lockChoicesUI("Escolha aceita — gerando sequência...");

    addChoice(story, index);
    resetPending(story);
    const stageBefore = story.stage;

    try{
      if (stageBefore === 50) {
        const seg = await geminiGenerateSegment(story, 50);
        story.fullText = (story.fullText + "\n\n" + seg.text.trim()).trim();
        story.pendingChoices = seg.choices;
        story.pendingChoiceAt = 2;
        story.stage = 90;
      } else if (stageBefore === 90) {
        const seg = await geminiGenerateSegment(story, 90);
        story.fullText = (story.fullText + "\n\n" + seg.text.trim()).trim();
        story.stage = 100;
        if (story.chapter >= 10) story.status = "completed";
      }
      saveStory(story);
      renderText();
      renderControls();
    } catch(e){
      err.textContent = e?.message || "Erro ao chamar Gemini.";
      renderControls();
    }
  }

  async function attemptRepair(){
    // Não altera escolhas. Apenas continua se não houver escolha pendente.
    if (story.pendingChoices) return;
    if (!store.getLicense()) { throw new Error("Defina a Licença de Uso em Termos."); }

    // Casos:
    // - stage 0: gerar início
    // - stage 50 sem choices: regenerar início
    // - stage 90 sem choices: tentar continuar até gerar escolhas/90
    // - stage 100 mas texto parece cortado: continuar para completar conclusão
    if (story.stage === 0) {
      const seg = await geminiGenerateSegment(story, 0);
      story.fullText = seg.text.trim();
      story.pendingChoices = seg.choices;
      story.pendingChoiceAt = 1;
      story.stage = 50;
      return;
    }

    if (story.stage === 50) {
      // se não há pendingChoices, reexecuta o início (sem escolhas feitas ainda)
      const seg = await geminiGenerateSegment(story, 0);
      story.fullText = seg.text.trim();
      story.pendingChoices = seg.choices;
      story.pendingChoiceAt = 1;
      story.stage = 50;
      return;
    }

    if (story.stage === 90) {
      // Se choices2 não apareceram, tenta continuar (sem alterar escolhas)
      const seg = await geminiContinue(story);
      story.fullText = (story.fullText + "\n\n" + seg.text.trim()).trim();
      if (seg.choices) {
        story.pendingChoices = seg.choices;
        story.pendingChoiceAt = 2;
        story.stage = 90;
      }
      return;
    }

    if (story.stage === 100) {
      if (isLikelyIncomplete(story.fullText)) {
        const seg = await geminiContinue(story);
        story.fullText = (story.fullText + "\n\n" + seg.text.trim()).trim();
      }
      return;
    }
  }

  refreshBtn.addEventListener("click", async ()=>{
    err.textContent = "";
    tts.stop();
    refreshBtn.disabled = true;
    const old = refreshBtn.textContent;
    refreshBtn.textContent = "Processando...";
    try{
      await attemptRepair();
      saveStory(story);
      renderText();
      renderControls();
    } catch(e){
      err.textContent = e?.message || "Falha ao atualizar.";
    } finally {
      refreshBtn.disabled = false;
      refreshBtn.textContent = old;
    }
  });

  root.querySelector("#narrate").addEventListener("click", ()=>{
    const parts = store.splitSentences(story.fullText || "");
    tts.speak(parts, (idx)=> setHighlight(idx));
  });
  root.querySelector("#stop").addEventListener("click", ()=>{
    tts.stop();
    setHighlight(-1);
  });

  root.querySelector("#next").addEventListener("click", async ()=>{
    err.textContent = "";
    tts.stop();
    const btn = root.querySelector("#next");
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = "Gerando...";
    try{
      story.chapter += 1;
      story.stage = 0;
      story.pendingChoices = null;
      story.pendingChoiceAt = null;

      const seg = await geminiGenerateSegment(story, 0);
      story.fullText = (story.fullText + "\n\n=== CAPÍTULO " + story.chapter + " ===\n\n" + seg.text.trim()).trim();
      story.pendingChoices = seg.choices;
      story.pendingChoiceAt = 1;
      story.stage = 50;

      saveStory(story);
      renderText();
      renderControls();
    } catch(e){
      err.textContent = e?.message || "Falha ao gerar próximo capítulo.";
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  });

  renderText();
  renderControls();
  app.appendChild(root);
}

function renderDetails(storyId) {
  const story = getStory(storyId);
  if (!story) { location.hash = "#/stories"; return; }

  app.innerHTML = "";
  const root = el(`
    <div class="card">
      <h2 class="title">Detalhes</h2>
      <div class="muted">
        <b>${escapeHtml(story.title || "(sem título)")}</b><br/>
        Status: ${story.status}<br/>
        Capítulo: ${story.chapter}<br/>
        Estágio: ${story.stage}%<br/>
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
}
