// Tarayıcıdan doğrudan çağrılabilen LLM sağlayıcıları. Anahtarlar yalnızca bu tarayıcının localStorage'ında durur.
// Sıra = tercih sırası (kalite). İlk kullanılabilir olan yorumcu, ondan farklı olan ilk sağlayıcı hakem olur.

export const PROVIDERS = {
  claude: {
    name: 'Claude (Anthropic)', free: false, needsKey: true,
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  gemini: {
    name: 'Google Gemini', free: true, needsKey: true,
    models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'],
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  groq: {
    name: 'Groq', free: true, needsKey: true,
    models: ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'openai/gpt-oss-20b'],
    keyUrl: 'https://console.groq.com/keys',
  },
  openrouter: {
    name: 'OpenRouter (ücretsiz modeller)', free: true, needsKey: true,
    models: ['deepseek/deepseek-chat-v3.1:free', 'meta-llama/llama-3.3-70b-instruct:free', 'openai/gpt-oss-20b:free'],
    keyUrl: 'https://openrouter.ai/keys',
  },
  pollinations: {
    name: 'Pollinations (anahtarsız)', free: true, needsKey: false,
    models: ['openai', 'mistral'],
    keyUrl: 'https://pollinations.ai',
  },
};
export const ORDER = ['claude', 'gemini', 'groq', 'openrouter', 'pollinations'];

class LLMError extends Error {
  constructor(msg, status, retryable) { super(msg); this.status = status; this.retryable = retryable; }
}

async function post(url, headers, body) {
  let r;
  try {
    r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  } catch (e) {
    throw new LLMError('Bağlantı kurulamadı (ağ ya da CORS).', 0, true);
  }
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* düz metin */ }
  if (!r.ok) {
    const msg = data?.error?.message || data?.error || text.slice(0, 200) || r.statusText;
    // 404: model kaldırılmış olabilir → listedeki sonraki modele geç
    throw new LLMError(`${r.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`, r.status, r.status === 404 || r.status === 429 || r.status >= 500);
  }
  return data ?? text;
}

async function openaiCompat(url, key, model, system, user, json) {
  const body = { model, temperature: 0.3, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
  if (json) body.response_format = { type: 'json_object' };
  const d = await post(url, key ? { authorization: `Bearer ${key}` } : {}, body);
  if (typeof d === 'string') return d;
  return d.choices?.[0]?.message?.content || '';
}

const CALLERS = {
  async gemini(key, model, system, user, json) {
    const d = await post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {}, {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature: 0.3, ...(json ? { responseMimeType: 'application/json' } : {}) },
    });
    const c = d.candidates?.[0];
    if (!c) throw new LLMError('Gemini yanıt vermedi' + (d.promptFeedback?.blockReason ? ` (${d.promptFeedback.blockReason})` : '') + '.', 200, false);
    return (c.content?.parts || []).map(p => p.text || '').join('');
  },
  groq: (key, model, s, u, json) => openaiCompat('https://api.groq.com/openai/v1/chat/completions', key, model, s, u, json),
  openrouter: (key, model, s, u, json) => openaiCompat('https://openrouter.ai/api/v1/chat/completions', key, model, s, u, json),
  pollinations: (key, model, s, u, json) => openaiCompat('https://text.pollinations.ai/openai', null, model, s, u, json),
  async claude(key, model, system, user) {
    const { default: Anthropic } = await import('https://esm.sh/@anthropic-ai/sdk@0.127.0');
    const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
    const params = {
      model, max_tokens: 16000, system,
      output_config: { effort: 'medium' },
      messages: [{ role: 'user', content: user }],
    };
    if (model !== 'claude-haiku-5-5') { params.betas = ['server-side-fallback-2026-07-01']; params.fallbacks = 'default'; }
    try {
      const msg = await client.beta.messages.create(params);
      if (msg.stop_reason === 'refusal') throw new LLMError('Model bu isteği yanıtlamadı.', 200, true);
      return msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
    } catch (e) {
      if (e instanceof LLMError) throw e;
      throw new LLMError(e.message || String(e), e.status || 0, e.status === 429 || e.status >= 500);
    }
  },
};

// cfg: { [provider]: { key, model } }. Kullanılabilir sağlayıcılar tercih sırasıyla.
export function available(cfg) {
  return ORDER.filter(p => !PROVIDERS[p].needsKey || cfg[p]?.key);
}

// Bir sağlayıcıyı dene; model bulunamazsa / limit dolarsa listedeki diğer modellere geç.
async function callProvider(p, cfg, system, user, json) {
  const own = cfg[p]?.model?.trim();
  const models = [...new Set([own, ...PROVIDERS[p].models].filter(Boolean))];
  let last;
  for (const m of models) {
    try { return { text: await CALLERS[p](cfg[p]?.key, m, system, user, json), provider: p, model: m }; }
    catch (e) { last = e; if (!e.retryable) break; }
  }
  throw last;
}

// Sırayla dener; hepsi başarısızsa hataları birleştirip fırlatır.
// `exclude`: hakem analistten farklı olsun diye bu sağlayıcıyı anahtarlı diğerlerinin arkasına al.
// Başka anahtarlı sağlayıcı yoksa daha zayıf anahtarsız modele düşmek yerine aynı sağlayıcı hakemlik yapar.
export async function complete(cfg, system, user, { json = false, exclude = null } = {}) {
  let list = available(cfg);
  if (exclude) {
    const keyless = list.filter(p => !PROVIDERS[p].needsKey);
    const others = list.filter(p => p !== exclude && PROVIDERS[p].needsKey);
    list = [...others, ...(PROVIDERS[exclude].needsKey ? [exclude] : []), ...keyless];
  }
  const errors = [];
  for (const p of list) {
    try { return await callProvider(p, cfg, system, user, json); }
    catch (e) { errors.push(`${PROVIDERS[p].name}: ${e.message}`); if (e.status === 401 || e.status === 403) continue; }
  }
  throw new Error(errors.join(' · ') || 'Kullanılabilir yapay zeka sağlayıcısı yok.');
}

// Model yanıtından JSON nesnesini çıkar (kod bloğu ya da çevre metin olsa bile)
export function parseJSON(text) {
  try { return JSON.parse(text); } catch { /* devam */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* yok */ } }
  return null;
}
