import { store } from "./store.js";

function model(){ return store.getModel(); }

function choicesHistory(story){
  if (!Array.isArray(story.choices) || story.choices.length === 0) return "Nenhuma.";
  return story.choices.map(c => `Cap ${c.chapter} Pausa ${c.pause}: ${c.choice}`).join(" | ");
}

function baseRules(story){
  const pov = story.firstPerson ? "PRIMEIRA PESSOA (eu, meu, minha)" : "TERCEIRA PESSOA";
  return `
Você é um gerador de narrativa do HistorIA.
Regras inegociáveis:
- História fictícia para entretenimento.
- Respeite: Título, Premissa, Núcleos, Tom, Classificação e POV.
- Mantenha consistência e continuidade.
- Não ofereça explicações meta.
- Não mencione políticas, nem a palavra "prompt".
- Proibido pular etapas.
- Se o modo Primeira Pessoa estiver ativo, o narrador é o próprio protagonista.

Contexto:
Título: ${story.title}
Premissa: ${story.premise}
Núcleos: ${story.nuclei}
Tom: ${story.tone}
Classificação: ${story.ageRating}
POV: ${pov}
Capítulo atual: ${story.chapter} de 10
Escolhas já feitas: ${choicesHistory(story)}
`;
}

function segmentInstruction(stage){
  if (stage === 0) return `
Tarefa: Escreva o INÍCIO do capítulo atual (aprox. metade do capítulo).
Ao final, gere exatamente 3 opções de escolha, numeradas de 1 a 3.
Formato:
[TEXTO]

[ESCOLHAS]
1) ...
2) ...
3) ...
`;
  if (stage === 50) return `
Tarefa: Continue a história do ponto atual até aproximadamente 90% do capítulo.
Ao final, gere exatamente 3 opções de escolha, numeradas de 1 a 3.
Formato:
[TEXTO]

[ESCOLHAS]
1) ...
2) ...
3) ...
`;
  if (stage === 90) return `
Tarefa: Conclua o capítulo atual (finalize o arco do capítulo).
Não gere escolhas.
Formato:
[TEXTO]
`;
  return `Tarefa: Capítulo já concluído.`;
}

function continueInstruction(){
  return `
Tarefa: Continue EXATAMENTE do ponto onde o texto parou.
- Não repita trechos.
- Não altere escolhas anteriores.
- Mantenha o mesmo capítulo e finalize o que estiver pendente.
Se ainda faltar concluir o capítulo, conclua. Se faltar criar escolhas, crie as escolhas exigidas.
Formato:
[TEXTO]
(se for necessário escolhas, use o bloco [ESCOLHAS] com 3 opções)
`;
}

function parseOutput(raw){
  const marker = /\[ESCOLHAS\]/i;
  const parts = raw.split(marker);
  if (parts.length === 1) return { text: raw.trim(), choices: null };

  const text = parts[0].trim();
  const lines = parts.slice(1).join("\n").split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  const choices = [];
  for (const l of lines){
    const m = l.match(/^(?:\d+\)|\d+\.|-)?\s*(.+)$/);
    if (m && m[1]) {
      const c = m[1].trim();
      if (c) choices.push(c);
    }
  }
  const uniq = choices.filter((c,i)=>c && choices.indexOf(c)===i).slice(0,3);
  if (uniq.length === 3) return { text, choices: uniq };

  return { text, choices: [
    "Investigar discretamente a próxima pista",
    "Confrontar diretamente o principal suspeito",
    "Recuar e preparar um plano mais seguro"
  ]};
}

async function callGemini(prompt, apiKey){
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model()}:generateContent`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.9, topP: 0.95, maxOutputTokens: 1200 }
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type":"application/json", "X-goog-api-key": apiKey },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  if (!res.ok){
    const msg = data?.error?.message || "Falha ao chamar Gemini.";
    throw new Error(msg);
  }
  const text = data?.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("") || "";
  return text.trim();
}

export async function geminiGenerateSegment(story, stage){
  const apiKey = store.getLicense();
  if (!apiKey) throw new Error("Licença de Uso ausente. Vá em Termos e Condições.");

  const prompt = `
${baseRules(story)}

Texto acumulado até agora (use como continuidade, não repita):
${story.fullText || "(vazio)"}

${segmentInstruction(stage)}
`;
  const raw = await callGemini(prompt, apiKey);
  return parseOutput(raw);
}

export async function geminiContinue(story){
  const apiKey = store.getLicense();
  if (!apiKey) throw new Error("Licença de Uso ausente. Vá em Termos e Condições.");

  const prompt = `
${baseRules(story)}

Texto atual (últimas linhas são o ponto de continuação):
${story.fullText || "(vazio)"}

${continueInstruction()}
`;
  const raw = await callGemini(prompt, apiKey);
  return parseOutput(raw);
}
