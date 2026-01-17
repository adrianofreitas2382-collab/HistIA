import { store } from "./store.js";

function model(){ return store.getModel(); }

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
- Proibido pular etapas: o controlador externo decide quando pausar e quando pedir escolhas.
- Se o modo Primeira Pessoa estiver ativo, o narrador é o próprio protagonista.

Contexto fixo:
Título: ${story.title}
Premissa: ${story.premise}
Núcleos desejados: ${story.nuclei}
Tom: ${story.tone}
Classificação: ${story.ageRating}
POV: ${pov}
Capítulo atual: ${story.chapter} de 10
`;
}

function segmentInstruction(stage){
  if (stage === 0) return `
Tarefa: Escreva o INÍCIO do capítulo atual (aprox. metade do capítulo).
Ao final, gere exatamente 3 opções de escolha (curtas e claras), numeradas de 1 a 3.
Formato:
[TEXTO]

[ESCOLHAS]
1) ...
2) ...
3) ...
`;
  if (stage === 50) return `
Tarefa: Continue a história do ponto atual até aproximadamente 90% do capítulo.
Ao final, gere exatamente 3 opções de escolha (curtas e claras), numeradas de 1 a 3.
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

export async function geminiGenerateSegment(story, stage){
  const apiKey = store.getLicense();
  if (!apiKey) throw new Error("Licença de Uso ausente. Vá em Termos e Condições.");

  const prompt = `
${baseRules(story)}

Texto acumulado até agora (use como continuidade, não repita):
${story.fullText || "(vazio)"}

${segmentInstruction(stage)}
`;

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
  return parseOutput(text.trim());
}


async function callGemini(prompt, apiKey){
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model()}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-goog-api-key": apiKey },
    body: JSON.stringify({
      contents:[{parts:[{text:prompt}]}],
      generationConfig:{temperature:0.9, maxOutputTokens:1200}
    })
  });
  const data = await res.json();
  if(!res.ok) throw new Error(data?.error?.message || "Erro Gemini");
  return data?.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("") || "";
}
