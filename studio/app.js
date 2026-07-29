/* ============================================================
   MakeDay Studio — авто-монтаж ролика с праздника.
   Всё в браузере: анализ движения + биты музыки → нарезка на ffmpeg.wasm.
   ============================================================ */
'use strict';

const state = {
  videos: [],           // {file, duration, motion:[{t,m}], poster, ready, thumbEl}
  audio: null,          // {file, duration, beatInterval}
  opts: { len: 30, fmt: '9:16', q: 'fast', smart: true },
};

let ff = null;          // экземпляр FFmpeg (ленивая загрузка)

/* ---------------- утилиты ---------------- */
const $ = s => document.querySelector(s);
const fmtSec = s => (s < 60 ? `${Math.round(s)} сек` : `${(s / 60).toFixed(1)} мин`);
function log(msg) {
  const el = $('#log'); if (!el) return;
  el.textContent += msg + '\n'; el.scrollTop = el.scrollHeight;
}
function setBar(p, stage) {
  $('#bar').style.width = Math.round(p * 100) + '%';
  if (stage) $('#stage').textContent = stage;
}

/* ---------------- шаг 1: видео ---------------- */
$('#in-video').addEventListener('change', e => { addVideos([...e.target.files]); e.target.value = ''; });
dropZone($('#drop-video'), $('#in-video'));
dropZone($('#drop-audio'), $('#in-audio'));

function dropZone(zone, input) {
  ['dragover', 'dragenter'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add('hover'); }));
  ['dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove('hover'); }));
  zone.addEventListener('drop', e => {
    const files = [...(e.dataTransfer?.files || [])];
    if (input.id === 'in-video') addVideos(files.filter(f => f.type.startsWith('video')));
    else { const a = files.find(f => f.type.startsWith('audio')); if (a) setAudio(a); }
  });
}

function addVideos(files) {
  const vids = [...files].filter(f => f.type.startsWith('video') || /\.(mov|mp4|m4v|webm|avi|mkv)$/i.test(f.name));
  for (const file of vids) {
    // добавляем СРАЗУ (ролик уже можно использовать), анализ — в фоне
    const v = { file, duration: 0, motion: [], poster: null, ready: true, analyzed: false, thumbEl: null };
    state.videos.push(v);
    renderThumb(v);
    v.thumbEl.classList.remove('busy');
  }
  updateVideoHint();
  refreshMakeBtn();
  runAnalysisQueue();
}

function updateVideoHint() {
  const n = state.videos.length;
  const hint = document.getElementById('video-hint');
  if (hint) hint.textContent = n ? `Добавлено клипов: ${n}. Можно выбрать ещё — добавятся к списку.` : '';
}

let analyzing = false;
async function runAnalysisQueue() {
  if (analyzing) return;
  analyzing = true;
  try {
    let v;
    while ((v = state.videos.find(x => !x.analyzed))) {
      v.analyzed = true;
      v.thumbEl && v.thumbEl.classList.add('busy');
      try { await withTimeout(analyzeVideo(v), 20000); }
      catch (err) { console.warn('analyze fail', err); }
      v.thumbEl && v.thumbEl.classList.remove('busy');
      updateThumb(v);
    }
  } finally { analyzing = false; }
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}
function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

function renderThumb(v) {
  const wrap = document.createElement('div');
  wrap.className = 'thumb busy';
  wrap.innerHTML = `<canvas width="88" height="120"></canvas><span class="dur"></span>
    <button class="del" title="убрать">✕</button>`;
  wrap.querySelector('.del').addEventListener('click', () => {
    state.videos = state.videos.filter(x => x !== v); wrap.remove(); updateVideoHint(); refreshMakeBtn();
  });
  $('#video-list').appendChild(wrap);
  v.thumbEl = wrap;
}
function updateThumb(v) {
  if (!v.thumbEl) return;
  if (v.poster) {
    const c = v.thumbEl.querySelector('canvas'); const ctx = c.getContext('2d');
    ctx.drawImage(v.poster, 0, 0, c.width, c.height);
  }
  v.thumbEl.querySelector('.dur').textContent = v.duration ? `${v.duration.toFixed(0)}с` : '';
}

/* Анализ клипа: длительность, кадр-постер, таймлайн «движения» */
async function analyzeVideo(v) {
  const url = URL.createObjectURL(v.file);
  const vid = document.createElement('video');
  vid.muted = true; vid.playsInline = true; vid.preload = 'auto'; vid.src = url;
  await new Promise((res, rej) => {
    vid.onloadedmetadata = res;
    vid.onerror = () => rej(new Error('не читается видео'));
    setTimeout(() => rej(new Error('таймаут метаданных')), 15000);
  });
  let duration = vid.duration;
  if (!isFinite(duration) || duration <= 0) duration = 0;
  v.duration = duration;

  const ar = (vid.videoHeight && vid.videoWidth) ? vid.videoHeight / vid.videoWidth : 1.78;
  const cw = 64, ch = Math.max(8, Math.round(cw * ar));
  const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
  const ctx = cv.getContext('2d', { willReadFrequently: true });

  const seek = t => new Promise(res => {
    const done = () => { vid.removeEventListener('seeked', done); res(); };
    vid.addEventListener('seeked', done);
    try { vid.currentTime = Math.min(Math.max(0, t), Math.max(0, duration - 0.05)); } catch (e) { res(); }
  });

  if (duration > 0) {
    const step = Math.min(1.0, Math.max(0.4, duration / 20)); // легче для телефона
    let prev = null, first = true;
    for (let t = 0; t < duration - 0.05; t += step) {
      await seek(t);
      ctx.drawImage(vid, 0, 0, cw, ch);
      const d = ctx.getImageData(0, 0, cw, ch).data;
      const luma = new Float32Array(d.length / 4);
      for (let i = 0, j = 0; i < d.length; i += 4, j++) luma[j] = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
      if (first) { // постер
        const pc = document.createElement('canvas'); pc.width = cw; pc.height = ch;
        pc.getContext('2d').drawImage(vid, 0, 0, cw, ch); v.poster = pc; first = false;
      }
      if (prev) {
        let sum = 0; for (let i = 0; i < luma.length; i++) sum += Math.abs(luma[i] - prev[i]);
        v.motion.push({ t, m: sum / luma.length });
      }
      prev = luma;
    }
  }
  v.ready = true;
  URL.revokeObjectURL(url);
}

/* ---------------- шаг 2: музыка ---------------- */
$('#in-audio').addEventListener('change', e => { if (e.target.files[0]) setAudio(e.target.files[0]); e.target.value = ''; });

async function setAudio(file) {
  // музыка считается «загруженной» СРАЗУ — не ждём разбор ритма (на iOS он может зависнуть)
  state.audio = { file, duration: 0, beatInterval: 0.5 };
  $('#audio-label').innerHTML = `🎵 <b>${esc(file.name)}</b><br><span class="muted">загружено · определяю ритм…</span>`;
  refreshMakeBtn();
  try {
    const info = await withTimeout(analyzeTempo(file), 12000);
    state.audio.beatInterval = info.beatInterval;
    state.audio.duration = info.duration;
    $('#audio-label').innerHTML = `🎵 <b>${esc(file.name)}</b><br><span class="muted">${info.duration.toFixed(0)} сек · темп ~${Math.round(60 / info.beatInterval)} уд/мин</span>`;
  } catch (err) {
    console.warn('tempo fail', err);
    // ритм не разобрали — не страшно, нарежем по ровной сетке
    $('#audio-label').innerHTML = `🎵 <b>${esc(file.name)}</b><br><span class="muted">загружено · ритм по умолчанию</span>`;
  }
}

async function analyzeTempo(file) {
  const buf = await file.arrayBuffer();
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) throw new Error('no AudioContext');
  const ac = new AC();
  let audioBuf;
  try { audioBuf = await ac.decodeAudioData(buf.slice(0)); }
  finally { try { ac.close(); } catch (e) {} }
  return { beatInterval: detectBeatInterval(audioBuf), duration: audioBuf.duration };
}

/* Оценка длины бита (сек) через автокорреляцию потока онсетов */
function detectBeatInterval(buf) {
  const sr = buf.sampleRate;
  const ch = buf.getChannelData(0);
  const hop = Math.round(sr * 0.02); // окно 20 мс
  const env = [];
  for (let i = 0; i < ch.length; i += hop) {
    let s = 0, n = 0;
    for (let j = i; j < i + hop && j < ch.length; j++) { s += ch[j] * ch[j]; n++; }
    env.push(Math.sqrt(s / (n || 1)));
  }
  const flux = [];
  for (let i = 1; i < env.length; i++) flux.push(Math.max(0, env[i] - env[i - 1]));
  const fps = 1 / 0.02;
  const minLag = Math.round(0.30 * fps), maxLag = Math.round(1.0 * fps);
  let bestLag = Math.round(0.5 * fps), best = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = lag; i < flux.length; i++) s += flux[i] * flux[i - lag];
    if (s > best) { best = s; bestLag = lag; }
  }
  let bi = bestLag * 0.02;
  if (!(bi > 0.25 && bi < 1.2)) bi = 0.5;
  return bi;
}

/* ---------------- шаг 3: настройки ---------------- */
chipGroup('#len-chips', 'len', val => {
  const custom = val === 'custom';
  $('#len-custom').classList.toggle('hidden', !custom);
  $('#len-custom-s').classList.toggle('hidden', !custom);
  if (!custom) state.opts.len = +val;
  else state.opts.len = clampLen(+$('#len-custom').value);
});
$('#len-custom').addEventListener('input', e => { state.opts.len = clampLen(+e.target.value); });
chipGroup('#fmt-chips', 'fmt', v => state.opts.fmt = v);
chipGroup('#q-chips', 'q', v => state.opts.q = v);
$('#opt-smart').addEventListener('change', e => state.opts.smart = e.target.checked);
const clampLen = n => Math.min(180, Math.max(5, n || 30));

function chipGroup(sel, attr, cb) {
  const box = $(sel);
  box.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => {
    box.querySelectorAll('.chip').forEach(x => x.classList.remove('active'));
    c.classList.add('active');
    cb(c.dataset[attr]);
  }));
}

function refreshMakeBtn() {
  const ok = state.videos.length > 0 && state.videos.some(v => v.ready) && state.audio;
  $('#btn-make').disabled = !ok;
}

/* ---------------- построение плана нарезки ---------------- */
function buildPlan() {
  const target = state.opts.len;
  const bi = state.audio?.beatInterval || 0.5;
  // длина одного куска ~0.8..1.8 сек, кратна биту
  let beatsPerCut = Math.max(1, Math.round(1.0 / bi));
  let segDur = beatsPerCut * bi;
  while (segDur < 0.7) { beatsPerCut++; segDur = beatsPerCut * bi; }
  while (segDur > 1.8 && beatsPerCut > 1) { beatsPerCut--; segDur = beatsPerCut * bi; }

  let nSeg = Math.max(3, Math.round(target / segDur));

  // кандидаты-окна из всех клипов
  const cands = [];
  state.videos.forEach((v, vi) => {
    if (!v.duration) { cands.push({ vi, start: 0, dur: Math.min(segDur, 3), score: avgMotion(v, 0, segDur), whole: true }); return; }
    const stepW = Math.max(0.3, segDur / 2);
    for (let s = 0; s + segDur <= v.duration + 0.01; s += stepW) {
      cands.push({ vi, start: s, dur: segDur, score: state.opts.smart ? avgMotion(v, s, segDur) : 0 });
    }
    if (cands.length === 0) cands.push({ vi, start: 0, dur: Math.min(segDur, v.duration), score: 0 });
  });

  let chosen;
  if (state.opts.smart) {
    // жадный отбор по «живости», без перекрытий в одном клипе, с разнообразием по клипам
    const sorted = [...cands].sort((a, b) => b.score - a.score);
    const perVideoCap = Math.max(1, Math.ceil(nSeg / Math.max(1, state.videos.length)) + 1);
    const usedByVideo = {}, taken = [];
    for (const c of sorted) {
      if (taken.length >= nSeg) break;
      const list = usedByVideo[c.vi] || (usedByVideo[c.vi] = []);
      if (list.length >= perVideoCap) continue;
      if (list.some(x => Math.abs(x - c.start) < c.dur * 0.9)) continue; // перекрытие
      list.push(c.start); taken.push(c);
    }
    // если кандидатов не хватило — добираем оставшимися
    for (const c of sorted) { if (taken.length >= nSeg) break; if (!taken.includes(c)) taken.push(c); }
    chosen = taken;
  } else {
    // по порядку: равномерно по клипам и по времени
    chosen = [];
    let i = 0;
    while (chosen.length < nSeg && cands.length) { chosen.push(cands[i % cands.length]); i++; if (i > nSeg * 4) break; }
  }

  // порядок вывода — по таймлайну (клип, затем время) для связности
  chosen.sort((a, b) => a.vi - b.vi || a.start - b.start);
  chosen = chosen.slice(0, nSeg);
  const total = chosen.reduce((s, c) => s + c.dur, 0);
  return { segments: chosen, total, segDur };
}

function avgMotion(v, start, dur) {
  if (!v.motion.length) return 0;
  const seg = v.motion.filter(p => p.t >= start && p.t < start + dur);
  if (!seg.length) return 0;
  return seg.reduce((s, p) => s + p.m, 0) / seg.length;
}

/* ---------------- рендер через ffmpeg.wasm ---------------- */
async function loadFFmpeg() {
  if (ff) return ff;
  if (!window.FFmpegWASM || !window.FFmpegUtil) throw new Error('Видеодвижок не загрузился. Проверьте интернет и обновите страницу.');
  const { FFmpeg } = window.FFmpegWASM;
  const { toBlobURL } = window.FFmpegUtil;
  ff = new FFmpeg();
  ff.on('log', ({ message }) => { if (message) log(message); });
  const base = 'vendor';
  setBar(0.02, 'Загружаю видеодвижок (~30 МБ, один раз)…');
  await ff.load({
    coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
  });
  return ff;
}

function vfFor(fmt, q) {
  const dims = {
    '9:16': q === 'hq' ? [1080, 1920] : [720, 1280],
    '1:1': q === 'hq' ? [1080, 1080] : [720, 720],
    '16:9': q === 'hq' ? [1920, 1080] : [1280, 720],
  }[fmt];
  const [w, h] = dims;
  return `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,fps=30`;
}

const audioExt = name => { const m = /\.([a-z0-9]+)$/i.exec(name || ''); return m ? '.' + m[1].toLowerCase() : '.mp3'; };

async function makeReel() {
  const { fetchFile } = window.FFmpegUtil;
  $('#progress-card').classList.remove('hidden');
  $('#result-card').classList.add('hidden');
  $('#btn-make').disabled = true;
  $('#log').textContent = '';
  try {
    setBar(0.01, 'Планирую нарезку…');
    const plan = buildPlan();
    if (!plan.segments.length) throw new Error('Не из чего собирать — добавьте видео.');
    log(`Кусочков: ${plan.segments.length}, длина ~${plan.total.toFixed(1)} сек`);

    await loadFFmpeg();

    // записываем исходники (каждый файл один раз)
    setBar(0.15, 'Готовлю исходники…');
    const vname = {};
    for (let i = 0; i < state.videos.length; i++) {
      if (plan.segments.some(s => s.vi === i)) {
        const n = `v${i}.mp4`;
        await ff.writeFile(n, await fetchFile(state.videos[i].file));
        vname[i] = n;
      }
    }
    const mus = 'music' + audioExt(state.audio.file.name);
    await ff.writeFile(mus, await fetchFile(state.audio.file));

    const vf = vfFor(state.opts.fmt, state.opts.q);
    const parts = [];
    for (let i = 0; i < plan.segments.length; i++) {
      const s = plan.segments[i];
      const out = `s${i}.mp4`;
      setBar(0.15 + 0.6 * (i / plan.segments.length), `Нарезаю кусок ${i + 1} из ${plan.segments.length}…`);
      await ff.exec(['-ss', s.start.toFixed(2), '-t', s.dur.toFixed(2), '-i', vname[s.vi],
        '-vf', vf, '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', out]);
      parts.push(out);
    }

    setBar(0.8, 'Склеиваю…');
    await ff.writeFile('list.txt', parts.map(f => `file '${f}'`).join('\n'));
    await ff.exec(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', 'silent.mp4']);
    for (const p of parts) { try { await ff.deleteFile(p); } catch (e) {} }

    setBar(0.9, 'Добавляю музыку…');
    await ff.exec(['-i', 'silent.mp4', '-i', mus, '-map', '0:v:0', '-map', '1:a:0',
      '-t', plan.total.toFixed(2), '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-shortest', 'final.mp4']);

    setBar(0.98, 'Готовлю файл…');
    const data = await ff.readFile('final.mp4');
    const blob = new Blob([data.buffer], { type: 'video/mp4' });
    const url = URL.createObjectURL(blob);
    $('#result-video').src = url;
    $('#download').href = url;
    setBar(1, 'Готово!');
    $('#progress-card').classList.add('hidden');
    $('#result-card').classList.remove('hidden');
    $('#result-card').scrollIntoView({ behavior: 'smooth' });

    // чистим память ffmpeg
    for (const n of Object.values(vname)) { try { await ff.deleteFile(n); } catch (e) {} }
    try { await ff.deleteFile('silent.mp4'); await ff.deleteFile(mus); } catch (e) {}
  } catch (err) {
    console.error(err);
    $('#stage').textContent = '⚠️ ' + (err.message || 'Не удалось собрать ролик');
    log('ОШИБКА: ' + (err.message || err));
  } finally {
    $('#btn-make').disabled = false;
  }
}

$('#btn-make').addEventListener('click', makeReel);
$('#btn-again').addEventListener('click', () => {
  $('#result-card').classList.add('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
