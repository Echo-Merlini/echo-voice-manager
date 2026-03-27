import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { execSync, spawn } from 'child_process';

const app = express();
const PORT = 7070;
const VOICES_DIR = process.env.VOICES_DIR || path.join(process.env.HOME, 'Claude/voices');
const SAMPLES_DIR = process.env.SAMPLES_DIR || path.join(process.env.HOME, 'Claude/voice-samples');
const ACTIVE_REF = process.env.ACTIVE_REF || path.join(process.env.HOME, 'Claude/chatterbox-env/tiago_voice_ref.wav');
const META_FILE = path.join(VOICES_DIR, '_metadata.json');
const EDGE_VOICE_FILE = path.join(VOICES_DIR, '_edge_voice.txt');
const EDGE_SAMPLES_DIR = process.env.EDGE_SAMPLES_DIR || path.join(process.env.HOME, 'Claude/voice-samples/edge');
const CHATTERBOX_URL = process.env.CHATTERBOX_URL || 'http://localhost:5050';
const SAMPLE_TEXT = "Olá, eu sou o Echo, o assistente de inteligência artificial do Tiago.";
const EDGE_SAMPLE_TEXT = "Hello. I am Echo, your personal AI assistant. How can I help you today?";

const EDGE_VOICES = [
  { id: 'en-US-JennyNeural', label: 'Jenny', accent: 'US', gender: 'Female', style: 'Conversational' },
  { id: 'en-US-AriaNeural', label: 'Aria', accent: 'US', gender: 'Female', style: 'Warm' },
  { id: 'en-US-AvaNeural', label: 'Ava', accent: 'US', gender: 'Female', style: 'Natural' },
  { id: 'en-US-EmmaNeural', label: 'Emma', accent: 'US', gender: 'Female', style: 'Casual' },
  { id: 'en-US-MichelleNeural', label: 'Michelle', accent: 'US', gender: 'Female', style: 'Friendly' },
  { id: 'en-US-GuyNeural', label: 'Guy', accent: 'US', gender: 'Male', style: 'Casual' },
  { id: 'en-US-AndrewNeural', label: 'Andrew', accent: 'US', gender: 'Male', style: 'Warm' },
  { id: 'en-US-BrianNeural', label: 'Brian', accent: 'US', gender: 'Male', style: 'Natural' },
  { id: 'en-US-ChristopherNeural', label: 'Christopher', accent: 'US', gender: 'Male', style: 'Formal' },
  { id: 'en-US-EricNeural', label: 'Eric', accent: 'US', gender: 'Male', style: 'Conversational' },
  { id: 'en-US-RogerNeural', label: 'Roger', accent: 'US', gender: 'Male', style: 'Lively' },
  { id: 'en-GB-SoniaNeural', label: 'Sonia', accent: 'British', gender: 'Female', style: 'Formal' },
  { id: 'en-GB-RyanNeural', label: 'Ryan', accent: 'British', gender: 'Male', style: 'Casual' },
  { id: 'en-GB-LibbyNeural', label: 'Libby', accent: 'British', gender: 'Female', style: 'Conversational' },
  { id: 'en-AU-NatashaNeural', label: 'Natasha', accent: 'Australian', gender: 'Female', style: 'Casual' },
];

fs.mkdirSync(VOICES_DIR, { recursive: true });
fs.mkdirSync(SAMPLES_DIR, { recursive: true });
fs.mkdirSync(EDGE_SAMPLES_DIR, { recursive: true });

function loadMeta() {
  try { return JSON.parse(fs.readFileSync(META_FILE, 'utf8')); } catch { return {}; }
}
function saveMeta(meta) { fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2)); }

function getActiveEdgeVoice() {
  try { return fs.readFileSync(EDGE_VOICE_FILE, 'utf8').trim(); } catch { return 'en-US-JennyNeural'; }
}

const upload = multer({ dest: '/tmp/uploads/' });
app.use(express.json());

function getActiveVoice() {
  try {
    const active = fs.readFileSync(ACTIVE_REF);
    for (const f of fs.readdirSync(VOICES_DIR).filter(f => f.endsWith('.wav'))) {
      const candidate = fs.readFileSync(path.join(VOICES_DIR, f));
      if (active.equals(candidate)) return f;
    }
  } catch {}
  return null;
}

function samplePath(name) {
  return path.join(SAMPLES_DIR, name.replace('.wav', '_sample.wav'));
}

function edgeSamplePath(voiceId) {
  return path.join(EDGE_SAMPLES_DIR, voiceId + '.mp3');
}

// ── Chatterbox endpoints ────────────────────────────────────────────────────

app.get('/api/voices', (req, res) => {
  const meta = loadMeta();
  const files = fs.readdirSync(VOICES_DIR).filter(f => f.endsWith('.wav'));
  const active = getActiveVoice();
  const voices = files.map(f => {
    const stats = fs.statSync(path.join(VOICES_DIR, f));
    return {
      name: f,
      size: stats.size,
      modified: stats.mtime,
      active: f === active,
      hasSample: fs.existsSync(samplePath(f)),
      tags: meta[f]?.tags || []
    };
  });
  res.json(voices);
});

app.patch('/api/voices/:name/tags', (req, res) => {
  const { tags } = req.body;
  const meta = loadMeta();
  if (!meta[req.params.name]) meta[req.params.name] = {};
  meta[req.params.name].tags = tags;
  saveMeta(meta);
  res.json({ ok: true });
});

app.get('/audio/ref/:name', (req, res) => {
  const file = path.join(VOICES_DIR, req.params.name);
  if (!fs.existsSync(file)) return res.status(404).end();
  res.setHeader('Content-Type', 'audio/wav');
  fs.createReadStream(file).pipe(res);
});

app.get('/audio/sample/:name', (req, res) => {
  const file = samplePath(req.params.name);
  if (!fs.existsSync(file)) return res.status(404).end();
  res.setHeader('Content-Type', 'audio/wav');
  fs.createReadStream(file).pipe(res);
});

app.post('/api/voices/generate/:name', async (req, res) => {
  const ref = path.join(VOICES_DIR, req.params.name);
  if (!fs.existsSync(ref)) return res.status(404).json({ error: 'Not found' });
  const out = samplePath(req.params.name);
  res.writeHead(200, { 'Content-Type': 'text/plain', 'Transfer-Encoding': 'chunked' });
  res.write('Generating...\n');
  try {
    const response = await fetch(`${CHATTERBOX_URL}/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: SAMPLE_TEXT, voice_ref: `/voices/${req.params.name}` })
    });
    if (!response.ok) {
      const err = await response.text();
      res.write(`\nError: ${err}\n`); res.end(); return;
    }
    const buf = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(out, buf);
    res.write('\nDone!\n'); res.end();
  } catch (e) {
    res.write(`\nError: ${e.message}\n`); res.end();
  }
});

app.post('/api/voices/select/:name', (req, res) => {
  const src = path.join(VOICES_DIR, req.params.name);
  if (!fs.existsSync(src)) return res.status(404).json({ error: 'Not found' });
  fs.copyFileSync(src, ACTIVE_REF);
  res.json({ ok: true });
});

app.delete('/api/voices/:name', (req, res) => {
  const file = path.join(VOICES_DIR, req.params.name);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' });
  fs.unlinkSync(file);
  const sample = samplePath(req.params.name);
  if (fs.existsSync(sample)) fs.unlinkSync(sample);
  const meta = loadMeta();
  delete meta[req.params.name];
  saveMeta(meta);
  res.json({ ok: true });
});

app.post('/api/voices/upload', upload.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const name = (req.body.name?.replace(/[^a-z0-9_-]/gi, '_') || 'voice_' + Date.now()) + '.wav';
  const dest = path.join(VOICES_DIR, name);
  try {
    execSync(`ffmpeg -i "${req.file.path}" -ar 22050 -ac 1 "${dest}" -y 2>/dev/null`);
    fs.unlinkSync(req.file.path);
    const tags = req.body.tags ? JSON.parse(req.body.tags) : [];
    if (tags.length) { const meta = loadMeta(); meta[name] = { tags }; saveMeta(meta); }
    res.json({ ok: true, name });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── Edge TTS endpoints ──────────────────────────────────────────────────────

app.get('/api/edge-voices', (req, res) => {
  const active = getActiveEdgeVoice();
  res.json(EDGE_VOICES.map(v => ({
    ...v,
    active: v.id === active,
    hasSample: fs.existsSync(edgeSamplePath(v.id))
  })));
});

app.post('/api/edge-voices/select/:id', (req, res) => {
  const voice = EDGE_VOICES.find(v => v.id === req.params.id);
  if (!voice) return res.status(404).json({ error: 'Unknown voice' });
  fs.writeFileSync(EDGE_VOICE_FILE, req.params.id, 'utf8');
  res.json({ ok: true });
});

app.get('/audio/edge-sample/:id', (req, res) => {
  const file = edgeSamplePath(req.params.id);
  if (!fs.existsSync(file)) return res.status(404).end();
  res.setHeader('Content-Type', 'audio/mpeg');
  fs.createReadStream(file).pipe(res);
});

app.post('/api/edge-voices/preview/:id', (req, res) => {
  const voice = EDGE_VOICES.find(v => v.id === req.params.id);
  if (!voice) return res.status(404).json({ error: 'Unknown voice' });
  const out = edgeSamplePath(req.params.id);
  const PYTHON = 'python3';
  const script = `import asyncio, edge_tts\nasync def speak():\n    c = edge_tts.Communicate(${JSON.stringify(EDGE_SAMPLE_TEXT)}, ${JSON.stringify(voice.id)})\n    await c.save(${JSON.stringify(out)})\nasyncio.run(speak())\n`;
  const scriptFile = `/tmp/edge_prev_${Date.now()}.py`;
  fs.writeFileSync(scriptFile, script);
  try {
    execSync(`"${PYTHON}" "${scriptFile}"`, { timeout: 30000 });
    try { fs.unlinkSync(scriptFile); } catch {}
    res.json({ ok: true });
  } catch (e) {
    try { fs.unlinkSync(scriptFile); } catch {}
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ── Main ────────────────────────────────────────────────────────────────────

app.get('/', (req, res) => res.send(HTML));
app.listen(PORT, () => console.log(`Voice Manager at http://localhost:${PORT}`));

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Echo Voice Manager</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f0f11;color:#e1e1e6;min-height:100vh;padding:2rem}
  h1{font-size:1.5rem;font-weight:600;margin-bottom:.25rem}
  .subtitle{color:#888;font-size:.875rem;margin-bottom:1.5rem}
  .section-title{font-size:1rem;font-weight:600;color:#a5b4fc;margin:2rem 0 1rem;border-bottom:1px solid #2a2a35;padding-bottom:.5rem;max-width:720px}
  .filter-bar{display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:1.5rem;max-width:720px}
  .filter-chip{background:#1a1a1f;border:1px solid #2a2a35;color:#888;border-radius:20px;padding:.3rem .85rem;font-size:.75rem;cursor:pointer;transition:all .15s;user-select:none}
  .filter-chip.on{background:#312e81;border-color:#4f46e5;color:#a5b4fc}
  .voices{display:grid;gap:1rem;max-width:720px}
  .voice-card{background:#1a1a1f;border:1px solid #2a2a35;border-radius:14px;padding:1.25rem;transition:border-color .2s}
  .voice-card.active{border-color:#6366f1;background:#1e1e2e}
  .voice-card.hidden{display:none}
  .card-header{display:flex;align-items:center;gap:.75rem;margin-bottom:.85rem}
  .voice-icon{width:38px;height:38px;border-radius:10px;background:#2a2a35;display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0}
  .voice-card.active .voice-icon{background:#312e81}
  .voice-info{flex:1;min-width:0}
  .voice-name{font-weight:600;font-size:.95rem}
  .voice-meta{color:#666;font-size:.72rem;margin-top:2px}
  .active-badge{background:#4f46e5;color:#fff;font-size:.62rem;font-weight:600;padding:2px 8px;border-radius:20px;text-transform:uppercase;letter-spacing:.05em;margin-left:8px;vertical-align:middle}
  .card-actions{display:flex;gap:.5rem;flex-shrink:0}
  .tags-row{display:flex;flex-wrap:wrap;gap:.4rem;margin-bottom:.85rem;align-items:center}
  .tag{background:#2a2a35;color:#a5a5b5;border-radius:20px;padding:.2rem .65rem;font-size:.72rem;display:flex;align-items:center;gap:.35rem}
  .tag .remove-tag{cursor:pointer;color:#666;font-size:.8rem;line-height:1}
  .tag .remove-tag:hover{color:#f87171}
  .tag-input-wrap{display:flex;gap:.4rem;align-items:center}
  .tag-input{background:#0f0f11;border:1px solid #2a2a35;color:#e1e1e6;border-radius:20px;padding:.2rem .75rem;font-size:.72rem;outline:none;width:110px}
  .tag-input:focus{border-color:#4f46e5}
  .tag-suggestions{display:flex;flex-wrap:wrap;gap:.3rem;margin-top:.4rem}
  .tag-sugg{background:#1a1a1f;border:1px dashed #2a2a35;color:#666;border-radius:20px;padding:.18rem .6rem;font-size:.68rem;cursor:pointer;transition:all .15s}
  .tag-sugg:hover{border-color:#4f46e5;color:#a5b4fc}
  .ab-grid{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}
  .ab-panel{background:#0f0f11;border:1px solid #2a2a35;border-radius:10px;padding:.9rem}
  .ab-label{font-size:.68rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#666;margin-bottom:.6rem}
  .ab-panel.ref .ab-label{color:#34d399}
  .ab-panel.ai .ab-label{color:#818cf8}
  audio{width:100%;height:32px;display:block;border-radius:4px}
  .generate-btn{width:100%;margin-top:.5rem;background:#1e1e2e;border:1px dashed #4f46e5;color:#818cf8;border-radius:8px;padding:.45rem;font-size:.78rem;cursor:pointer;transition:all .15s}
  .generate-btn:hover{background:#312e81;border-style:solid}
  .generate-btn:disabled{opacity:.5;cursor:not-allowed}
  .progress{font-size:.72rem;color:#6366f1;margin-top:.35rem;min-height:1rem}
  button{border:none;cursor:pointer;border-radius:8px;font-size:.8rem;font-weight:500;padding:.4rem .9rem;transition:all .15s}
  .btn-select{background:#312e81;color:#a5b4fc}
  .btn-select:hover{background:#4338ca;color:#fff}
  .btn-select.is-active{background:#4f46e5;color:#fff;cursor:default}
  .btn-delete{background:#2a1a1a;color:#f87171}
  .btn-delete:hover{background:#3d1f1f}
  /* Edge TTS grid */
  .edge-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:.75rem;max-width:720px}
  .edge-card{background:#1a1a1f;border:1px solid #2a2a35;border-radius:12px;padding:1rem;transition:border-color .2s}
  .edge-card.active{border-color:#10b981;background:#0f1f1a}
  .edge-name{font-weight:600;font-size:.9rem;margin-bottom:.2rem;display:flex;align-items:center;gap:.5rem}
  .edge-meta{color:#666;font-size:.7rem;margin-bottom:.75rem}
  .edge-actions{display:flex;gap:.4rem;flex-direction:column}
  .btn-edge-select{background:#0d3d2e;color:#34d399;border-radius:8px;padding:.35rem .75rem;font-size:.75rem;font-weight:500;border:none;cursor:pointer;transition:all .15s;width:100%}
  .btn-edge-select:hover{background:#134e3a}
  .btn-edge-select.is-active{background:#10b981;color:#fff;cursor:default}
  .btn-edge-preview{background:#1e1e2e;border:1px dashed #4f46e5;color:#818cf8;border-radius:8px;padding:.35rem .75rem;font-size:.75rem;font-weight:500;cursor:pointer;transition:all .15s;width:100%}
  .btn-edge-preview:hover{background:#312e81;border-style:solid}
  .btn-edge-preview:disabled{opacity:.5;cursor:not-allowed}
  .edge-audio{margin-top:.5rem}
  .upload-section{max-width:720px;margin-top:2rem;background:#1a1a1f;border:1px dashed #2a2a35;border-radius:12px;padding:1.5rem}
  .upload-section h2{font-size:.9rem;font-weight:600;margin-bottom:1rem;color:#888}
  .upload-form{display:flex;gap:.75rem;flex-wrap:wrap;align-items:flex-end}
  .form-group{display:flex;flex-direction:column;gap:.35rem}
  label{font-size:.75rem;color:#888}
  input[type=text]{background:#0f0f11;border:1px solid #2a2a35;color:#e1e1e6;border-radius:8px;padding:.45rem .75rem;font-size:.85rem;outline:none}
  input[type=text]:focus{border-color:#4f46e5}
  input[type=file]{background:#0f0f11;border:1px solid #2a2a35;color:#e1e1e6;border-radius:8px;padding:.4rem .75rem;font-size:.8rem}
  .btn-upload{background:#4f46e5;color:#fff;padding:.45rem 1.2rem}
  .btn-upload:hover{background:#6366f1}
  .upload-tag-suggestions{display:flex;flex-wrap:wrap;gap:.3rem;margin-top:.5rem}
  .toast{position:fixed;bottom:1.5rem;right:1.5rem;background:#1e1e2e;border:1px solid #4f46e5;color:#a5b4fc;padding:.75rem 1.25rem;border-radius:10px;font-size:.85rem;opacity:0;transform:translateY(10px);transition:all .3s;pointer-events:none}
  .toast.show{opacity:1;transform:translateY(0)}
</style>
</head>
<body>
<h1>🎙️ Echo Voice Manager</h1>
<p class="subtitle">Manage Edge TTS voices and Chatterbox voice clones</p>

<div class="section-title">⚡ Edge TTS — Fast Cloud Voices</div>
<div class="edge-grid" id="edgeVoices"></div>

<div class="section-title">🧬 Chatterbox — Voice Clones</div>
<div class="filter-bar" id="filterBar">
  <span style="color:#666;font-size:.75rem;align-self:center">Filter:</span>
  <div class="filter-chip on" data-tag="all" onclick="toggleFilter(this)">All</div>
</div>
<div class="voices" id="voices"></div>

<div class="upload-section">
  <h2>Upload New Voice Reference</h2>
  <div class="upload-form">
    <div class="form-group">
      <label>Name</label>
      <input type="text" id="voiceName" placeholder="e.g. tiago_studio" />
    </div>
    <div class="form-group">
      <label>Audio file</label>
      <input type="file" id="voiceFile" accept="audio/*" />
    </div>
    <button class="btn-upload" onclick="uploadVoice()">Upload</button>
  </div>
  <div style="margin-top:.75rem">
    <label style="font-size:.72rem;color:#666">Quick tags:</label>
    <div class="upload-tag-suggestions" id="uploadTagSuggs"></div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
const SUGGESTED_TAGS = ['Male','Female','Non-binary','Transgender','Portuguese','English','Spanish','French','Deep','High','Raspy','Smooth','Robot','Monster','Character','Child','Elderly'];
let activeFilters = new Set(['all']);
let uploadTags = new Set();
let voices = [];

function renderUploadTags() {
  document.getElementById('uploadTagSuggs').innerHTML = SUGGESTED_TAGS.map(t =>
    \`<span class="tag-sugg \${uploadTags.has(t)?'on':''}" onclick="toggleUploadTag('\${t}')">\${t}</span>\`
  ).join('');
}
function toggleUploadTag(t) { uploadTags.has(t)?uploadTags.delete(t):uploadTags.add(t); renderUploadTags(); }
renderUploadTags();

function toggleFilter(el) {
  const tag = el.dataset.tag;
  if (tag === 'all') { activeFilters = new Set(['all']); document.querySelectorAll('.filter-chip').forEach(c => c.classList.toggle('on', c.dataset.tag==='all')); }
  else { activeFilters.delete('all'); document.querySelector('[data-tag=all]').classList.remove('on'); el.classList.toggle('on'); if(el.classList.contains('on')) activeFilters.add(tag); else { activeFilters.delete(tag); if(!activeFilters.size){activeFilters.add('all');document.querySelector('[data-tag=all]').classList.add('on');} } }
  applyFilter();
}

function applyFilter() {
  document.querySelectorAll('.voice-card').forEach(card => {
    if (activeFilters.has('all')) { card.classList.remove('hidden'); return; }
    const cardTags = (card.dataset.tags||'').split(',').filter(Boolean);
    card.classList.toggle('hidden', !cardTags.some(t => activeFilters.has(t)));
  });
}

function rebuildFilterBar(allTags) {
  const bar = document.getElementById('filterBar');
  const existing = new Set([...bar.querySelectorAll('.filter-chip:not([data-tag=all])')].map(c=>c.dataset.tag));
  allTags.forEach(t => {
    if (!existing.has(t)) {
      const chip = document.createElement('div');
      chip.className = 'filter-chip'; chip.dataset.tag = t; chip.textContent = t;
      chip.onclick = () => toggleFilter(chip);
      bar.appendChild(chip);
    }
  });
}

// ── Edge TTS ────────────────────────────────────────────────────────────────

async function loadEdgeVoices() {
  const res = await fetch('/api/edge-voices');
  const voices = await res.json();
  const el = document.getElementById('edgeVoices');
  el.innerHTML = voices.map(v => \`
    <div class="edge-card \${v.active?'active':''}" id="ecard-\${v.id}">
      <div class="edge-name">\${v.label}\${v.active?'<span class="active-badge">active</span>':''}</div>
      <div class="edge-meta">\${v.accent} · \${v.gender} · \${v.style}</div>
      <div class="edge-actions">
        \${v.active
          ? \`<button class="btn-edge-select is-active" disabled>✓ Active</button>\`
          : \`<button class="btn-edge-select" onclick="selectEdge('\${v.id}')">Set Active</button>\`}
        <button class="btn-edge-preview" id="eprev-\${v.id}" onclick="previewEdge('\${v.id}')">
          \${v.hasSample ? '▶ Play / Regenerate' : '▶ Generate Preview'}
        </button>
        \${v.hasSample ? \`<div class="edge-audio"><audio controls src="/audio/edge-sample/\${v.id}?t=\${Date.now()}"></audio></div>\` : ''}
      </div>
    </div>
  \`).join('');
}

async function selectEdge(id) {
  await fetch('/api/edge-voices/select/'+id, {method:'POST'});
  toast('✅ Edge TTS voice set to '+id.split('-')[2].replace('Neural',''));
  loadEdgeVoices();
}

async function previewEdge(id) {
  const btn = document.getElementById('eprev-'+id);
  btn.disabled = true; btn.textContent = 'Generating...';
  try {
    const res = await fetch('/api/edge-voices/preview/'+id, {method:'POST'});
    const data = await res.json();
    if (data.ok) { toast('Preview ready!'); }
    else { toast('Error: '+data.error); }
  } catch(e) { toast('Error generating preview'); }
  loadEdgeVoices();
}

// ── Chatterbox ──────────────────────────────────────────────────────────────

async function load() {
  const res = await fetch('/api/voices');
  voices = await res.json();
  const allTags = [...new Set(voices.flatMap(v => v.tags))];
  rebuildFilterBar(allTags);
  const el = document.getElementById('voices');
  if (!voices.length) { el.innerHTML = '<p style="color:#555;font-size:.85rem">No voice models yet.</p>'; return; }
  el.innerHTML = voices.map(v => {
    const tagChips = v.tags.map(t => \`<span class="tag">\${t}<span class="remove-tag" onclick="removeTag('\${v.name}','\${t}')">×</span></span>\`).join('');
    const suggChips = SUGGESTED_TAGS.filter(t=>!v.tags.includes(t)).map(t=>\`<span class="tag-sugg" onclick="addTag('\${v.name}','\${t}')">\${t}</span>\`).join('');
    return \`
    <div class="voice-card \${v.active?'active':''}" id="card-\${v.name}" data-tags="\${v.tags.join(',')}">
      <div class="card-header">
        <div class="voice-icon">\${v.active?'✅':'🎤'}</div>
        <div class="voice-info">
          <div class="voice-name">\${v.name.replace('.wav','')}\${v.active?'<span class="active-badge">active</span>':''}</div>
          <div class="voice-meta">\${(v.size/1024).toFixed(0)} KB · \${new Date(v.modified).toLocaleDateString()}</div>
        </div>
        <div class="card-actions">
          \${!v.active?\`<button class="btn-select" onclick="selectVoice('\${v.name}')">Set Active</button>\`:\`<button class="btn-select is-active" disabled>Active</button>\`}
          <button class="btn-delete" onclick="del('\${v.name}')">Delete</button>
        </div>
      </div>
      <div class="tags-row">
        \${tagChips}
        <div class="tag-input-wrap">
          <input class="tag-input" id="ti-\${v.name}" placeholder="Add tag…" onkeydown="if(event.key==='Enter')addTagInput('\${v.name}')" />
        </div>
      </div>
      <div class="tag-suggestions">\${suggChips}</div>
      <div class="ab-grid" style="margin-top:.85rem">
        <div class="ab-panel ref">
          <div class="ab-label">🟢 Reference Recording</div>
          <audio controls src="/audio/ref/\${v.name}"></audio>
        </div>
        <div class="ab-panel ai" id="ai-\${v.name}">
          <div class="ab-label">🟣 AI Clone Sample</div>
          \${v.hasSample?\`<audio controls src="/audio/sample/\${v.name}?t=\${Date.now()}"></audio>\`:\`<div style="color:#555;font-size:.78rem;margin-bottom:.4rem">No sample yet</div>\`}
          <button class="generate-btn" id="genbtn-\${v.name}" onclick="generate('\${v.name}')">\${v.hasSample?'↺ Regenerate':'✨ Generate AI Sample'}</button>
          <div class="progress" id="prog-\${v.name}"></div>
        </div>
      </div>
    </div>\`;
  }).join('');
  applyFilter();
}

async function addTagInput(name) {
  const inp = document.getElementById('ti-'+name);
  const tag = inp.value.trim();
  if (!tag) return;
  inp.value='';
  await addTag(name, tag);
}

async function addTag(name, tag) {
  const v = voices.find(x=>x.name===name);
  if (!v || v.tags.includes(tag)) return;
  const tags = [...v.tags, tag];
  await fetch('/api/voices/'+name+'/tags', {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({tags})});
  load();
}

async function removeTag(name, tag) {
  const v = voices.find(x=>x.name===name);
  if (!v) return;
  const tags = v.tags.filter(t=>t!==tag);
  await fetch('/api/voices/'+name+'/tags', {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({tags})});
  load();
}

async function selectVoice(name) {
  await fetch('/api/voices/select/'+name,{method:'POST'});
  toast('✅ '+name.replace('.wav','')+' is now active');
  load();
}

async function del(name) {
  if(!confirm('Delete '+name+'?')) return;
  await fetch('/api/voices/'+name,{method:'DELETE'});
  toast('Deleted '+name.replace('.wav',''));
  load();
}

async function generate(name) {
  const btn = document.getElementById('genbtn-'+name);
  const prog = document.getElementById('prog-'+name);
  btn.disabled=true; btn.textContent='Generating...'; prog.textContent='Loading model...';
  const res = await fetch('/api/voices/generate/'+name,{method:'POST'});
  const reader = res.body.getReader();
  let dots=0;
  while(true){
    const{done,value}=await reader.read();
    if(done)break;
    const text=new TextDecoder().decode(value);
    if(text.includes('.')){dots+=(text.match(/\\./g)||[]).length;prog.textContent='Sampling '+'·'.repeat(Math.min(dots,30));}
    if(text.includes('Done')){prog.textContent='';toast('Sample ready!');load();}
    if(text.includes('Error')){prog.textContent='Generation failed';btn.disabled=false;btn.textContent='↺ Retry';}
  }
}

async function uploadVoice() {
  const name=document.getElementById('voiceName').value.trim();
  const file=document.getElementById('voiceFile').files[0];
  if(!name||!file){toast('Enter a name and select a file');return;}
  const fd=new FormData();
  fd.append('name',name);
  fd.append('audio',file);
  fd.append('tags',JSON.stringify([...uploadTags]));
  const res=await fetch('/api/voices/upload',{method:'POST',body:fd});
  const data=await res.json();
  if(data.ok){toast('Uploaded '+data.name);uploadTags=new Set();renderUploadTags();load();}
  else toast('Error: '+data.error);
}

function toast(msg){
  const el=document.getElementById('toast');
  el.textContent=msg;el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'),3000);
}

loadEdgeVoices();
load();
</script>
</body>
</html>`;
