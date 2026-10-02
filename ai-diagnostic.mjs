import fs from 'node:fs/promises';
import path from 'node:path';
import { RESULT_SCHEMA, validateResult } from './radar-ai.mjs';

// Explicit, single-use operator diagnostic. Never sends application content,
// exports credentials, logs provider bodies, or retries paid generation calls.
export async function runAIDiagnostic(ai, dataDir, options = {}) {
  const token = options.token ?? process.env.AI_DIAGNOSTIC_ONCE;
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(token || '') || ai.provider !== 'gemini' || !ai.configuration().configured) return [];
  await fs.mkdir(dataDir, { recursive: true });
  try { const handle = await fs.open(path.join(dataDir, `.ai-diagnostic-${token}`), 'wx', 0o600); await handle.close(); }
  catch (error) { if (error.code === 'EEXIST') return []; throw error; }
  const log = options.log ?? (record => console.log('AI_DIAGNOSTIC', JSON.stringify(record)));
  const suite = options.suite ?? process.env.AI_DIAGNOSTIC_SUITE;
  const results = [];
  const input = 'Return exactly this result: {"text":"OK","drafts":[],"citations":[]}';
  const enumValue = value => typeof value === 'string' && /^[A-Z_]{1,48}$/.test(value) ? value : null;
  async function probe(kind, model) {
    const interactions = kind === 'interactions-json', plain = kind === 'plain';
    const url = interactions ? 'https://generativelanguage.googleapis.com/v1beta/interactions'
      : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const body = interactions ? { model, input, store: false, stream: false, background: false,
      generation_config: { max_output_tokens: 2048, thinking_level: 'low' },
      response_format: { type: 'text', mime_type: 'application/json', schema: RESULT_SCHEMA } }
      : { contents: [{ role: 'user', parts: [{ text: plain ? 'Reply only OK.' : input }] }],
        generationConfig: { candidateCount: 1, maxOutputTokens: plain ? 2048 : 12000,
          ...(!plain ? { responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema: RESULT_SCHEMA } } } : {}) } };
    if (['legacy-json', 'json-only', 'prompt-json'].includes(kind)) {
      delete body.generationConfig.responseFormat;
      if (kind !== 'prompt-json') body.generationConfig.responseMimeType = 'application/json';
      if (kind === 'legacy-json') body.generationConfig.responseJsonSchema = RESULT_SCHEMA;
    }
    if (kind === 'simple-json') body.generationConfig.responseFormat.text.schema = {
      type: 'object', properties: { text: {type: 'string'}, drafts: {type: 'array', items: {type: 'object'}}, citations: {type: 'array', items: {type: 'integer'}} }, required: ['text', 'drafts', 'citations']
    };
    let record = { kind, model, http: null, providerStatus: null, valid: false };
    try {
      const response = await ai.fetcher(url, { method: 'POST', headers: { 'x-goog-api-key': ai.key, 'content-type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
      record.http = response.status;
      const data = await response.json();
      record.providerStatus = enumValue(data?.error?.status);
      if (response.ok) {
        const candidate = data?.candidates?.[0];
        const raw = interactions ? data?.steps?.filter(s => s.type === 'model_output').flatMap(s => s.content || [])
          .filter(p => p.type === 'text' && typeof p.text === 'string').map(p => p.text).join('')
          : candidate?.content?.parts?.filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('');
        const completed = interactions ? data?.status === 'completed' : candidate?.finishReason === 'STOP';
        if (completed && typeof raw === 'string') {
          record.valid = plain ? raw.trim() === 'OK' : validateResult(raw, 'script', []).text === 'OK';
        }
      }
    } catch { /* only bounded, fixed metadata leaves the runtime */ }
    results.push(record); log(record); return record;
  }
  if (suite === 'compatibility') {
    for (const kind of ['legacy-json', 'json-only', 'simple-json', 'prompt-json']) await probe(kind, ai.model);
    return results;
  }
  await probe('plain', ai.model);
  const structured = await probe('generate-json', ai.model);
  await probe('interactions-json', ai.model);
  if (!structured.valid) {
    await ai.checkConnection();
    const preferred = ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite'];
    const available = ai.models.map(m => m.id).filter(id => id !== ai.model);
    const alternate = preferred.find(id => available.includes(id));
    if (alternate) await probe('generate-json', alternate);
  }
  return results;
}
