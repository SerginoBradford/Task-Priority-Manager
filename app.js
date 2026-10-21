/* Mes priorités — tâches par priorité, liste du jour et notes.
   Fonctionne seul (données dans le navigateur) ou synchronisé avec Supabase
   quand config.js contient l'URL et la clé du projet. */
(() => {
  'use strict';

  /* ================= Configuration ================= */
  const cfg = window.APP_CONFIG || {};
  const CLOUD = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
  const sb = CLOUD ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  }) : null;

  const PRIO = {
    1: { label: 'Critique' },
    2: { label: 'Haute' },
    3: { label: 'Moyenne' },
    4: { label: 'Basse' }
  };

  /* ================= Utilitaires ================= */
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
  }));
  const nowIso = () => new Date().toISOString();

  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage plein ou bloqué */ } },
    del(k) { try { localStorage.removeItem(k); } catch { } }
  };

  // Dates locales au format AAAA-MM-JJ
  const pad = (n) => String(n).padStart(2, '0');
  const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dateOf = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
  const todayIso = () => isoOf(new Date());
  const addDays = (iso, n) => { const d = dateOf(iso); d.setDate(d.getDate() + n); return isoOf(d); };
  const diffDays = (a, b) => Math.round((dateOf(a) - dateOf(b)) / 86400000);
  const mondayOf = (iso) => { const d = dateOf(iso); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return isoOf(d); };
  const fmt = (iso, opts) => new Intl.DateTimeFormat('fr-FR', opts).format(dateOf(iso));
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const fmtDur = (m) => {
    if (!m) return '';
    const h = Math.floor(m / 60), r = m % 60;
    if (!h) return `${r} min`;
    return r ? `${h} h ${pad(r)}` : `${h} h`;
  };

  function dueLabel(due) {
    if (!due) return { text: 'Sans date', cls: '' };
    const t = todayIso();
    const d = diffDays(due, t);
    if (d < 0) return { text: `En retard · ${fmt(due, { weekday: 'short', day: 'numeric', month: 'short' })}`, cls: 'late' };
    if (d === 0) return { text: "Aujourd'hui", cls: 'today' };
    if (d === 1) return { text: 'Demain', cls: '' };
    if (d < 7) return { text: fmt(due, { weekday: 'short', day: 'numeric' }), cls: '' };
    return { text: fmt(due, { day: 'numeric', month: 'short' }), cls: '' };
  }

  const ICON = {
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    note: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h9l4 4V20a.5.5 0 0 1-.5.5h-12A.5.5 0 0 1 6 20z"/><path d="M9 12h7M9 16h5"/></svg>',
    pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6l-1 6 3 3H7l3-3z"/><path d="M12 13v7"/></svg>',
    prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>'
  };

  /* ================= État ================= */
  const S = {
    user: null,
    tasks: [],
    notes: [],
    view: 'jour',
    day: todayIso(),
    weekStart: mondayOf(todayIso()),
    filter: 'todo',
    q: '',
    noteId: null,
    noteQ: '',
    editingId: null
  };

  /* ================= Données (cache local + file d'attente vers Supabase) ================= */
  const Data = {
    queue: [],
    flushing: false,
    inFlight: null,

    key(n) { return `mp:${S.user ? S.user.id : 'local'}:${n}`; },

    loadCache() {
      S.tasks = LS.get(this.key('tasks'), null);
      S.notes = LS.get(this.key('notes'), null);
      this.queue = LS.get(this.key('queue'), []);
    },
    saveCache() {
      LS.set(this.key('tasks'), S.tasks);
      LS.set(this.key('notes'), S.notes);
    },
    saveQueue() { LS.set(this.key('queue'), this.queue); },

    list(table) { return table === 'tasks' ? S.tasks : S.notes; },

    upsert(table, row, { silent = false } = {}) {
      row.updated_at = nowIso();
      const arr = this.list(table);
      const i = arr.findIndex((r) => r.id === row.id);
      if (i >= 0) arr[i] = row; else arr.push(row);
      this.saveCache();
      if (CLOUD) this.enqueue({ op: 'upsert', table, id: row.id });
      if (!silent) render();
    },

    remove(table, id) {
      const arr = this.list(table);
      const i = arr.findIndex((r) => r.id === id);
      if (i >= 0) arr.splice(i, 1);
      this.saveCache();
      if (CLOUD) this.enqueue({ op: 'delete', table, id });
      render();
    },

    // Une seule opération en attente par élément : la plus récente gagne.
    enqueue(op) {
      this.queue = this.queue.filter((q) => q === this.inFlight || !(q.table === op.table && q.id === op.id));
      this.queue.push(op);
      this.saveQueue();
      this.flush();
    },

    async flush() {
      if (!CLOUD || !S.user || this.flushing) return;
      if (!this.queue.length) { setSync('ok'); return; }
      this.flushing = true;
      setSync('pending');
      while (this.queue.length) {
        const op = this.queue[0];
        this.inFlight = op;
        try {
          if (op.op === 'upsert') {
            const row = this.list(op.table).find((r) => r.id === op.id);
            if (row) {
              const { error } = await sb.from(op.table).upsert({ ...row, user_id: S.user.id });
              if (error) throw error;
            }
          } else {
            const { error } = await sb.from(op.table).delete().eq('id', op.id);
            if (error) throw error;
          }
          this.queue.shift();
          this.saveQueue();
        } catch (e) {
          console.warn('Synchronisation reportée', e);
          this.inFlight = null;
          this.flushing = false;
          setSync('offline');
          return;
        }
      }
      this.inFlight = null;
      this.flushing = false;
      setSync('ok');
    },

    async pull() {
      if (!CLOUD || !S.user) return;
      await this.flush();
      if (this.queue.length) return; // hors ligne : on garde le cache
      try {
        const [t, n] = await Promise.all([
          sb.from('tasks').select('*').order('created_at'),
          sb.from('notes').select('*').order('updated_at', { ascending: false })
        ]);
        if (t.error) throw t.error;
        if (n.error) throw n.error;
        const strip = (r) => { const { user_id, ...rest } = r; return rest; };
        S.tasks = t.data.map(strip);
        S.notes = n.data.map(strip);
        this.saveCache();
        setSync('ok');
        render();
      } catch (e) {
        console.warn('Lecture impossible', e);
        setSync('offline');
      }
    }
  };

  function setSync(state) {
    const el = $('#sync');
    if (!el) return;
    const text = {
      local: 'Sur cet appareil',
      ok: 'Synchronisé',
      pending: 'Synchronisation…',
      offline: 'Hors ligne · en attente'
    }[state];
    el.dataset.state = state;
    el.innerHTML = `<span>${text}</span>`;
    el.title = text;
  }

  /* ================= Exemples (mode local uniquement) ================= */
  function exampleData() {
    const t = todayIso();
    const mk = (title, priority, off, duration, category, extra = {}) => ({
      id: uid(), title, priority, due_date: off === null ? null : addDays(t, off), duration, category,
      notes: '', done: false, done_at: null, example: true, created_at: nowIso(), updated_at: nowIso(), ...extra
    });
    const tasks = [
      mk('Finaliser le rapport mensuel', 1, 0, 90, 'Travail', { notes: 'Ajouter les chiffres de septembre avant envoi.' }),
      mk('Payer la facture d\'électricité', 1, -1, 10, 'Perso'),
      mk('Répondre aux mails clients en attente', 2, 0, 30, 'Travail'),
      mk('Faire les courses de la semaine', 3, 0, 60, 'Perso'),
      mk('Ranger le bureau', 4, 0, 20, 'Perso', { done: true, done_at: nowIso() }),
      mk('Envoyer le devis au nouveau client', 1, 1, 30, 'Travail'),
      mk('Préparer la réunion d\'équipe', 2, 1, 45, 'Travail'),
      mk('Appeler le garagiste pour le devis', 3, 2, 15, 'Perso'),
      mk('Lire le chapitre 4 de la formation', 4, 3, 40, 'Formation'),
      mk('Mettre à jour mon CV', 4, null, 60, 'Perso')
    ];
    const notes = [{
      id: uid(), title: 'Idées pour la réunion d\'équipe', pinned: true, example: true,
      content: 'Points à aborder :\n- Bilan du mois\n- Répartition des dossiers en cours\n- Date de la prochaine formation\n\nQuestion à poser : qui reprend le suivi client pendant les congés ?',
      created_at: nowIso(), updated_at: nowIso()
    }, {
      id: uid(), title: 'Liste de courses', pinned: false, example: true,
      content: 'Riz, huile, tomates, oignons, savon, piles AA',
      created_at: nowIso(), updated_at: new Date(Date.now() - 86400000).toISOString()
    }];
    return { tasks, notes };
  }

  /* ================= Tri ================= */
  const byPriority = (a, b) =>
    (a.priority - b.priority) ||
    ((a.due_date || '9999') < (b.due_date || '9999') ? -1 : (a.due_date || '9999') > (b.due_date || '9999') ? 1 : 0) ||
    ((b.duration || 0) - (a.duration || 0)) ||
    (a.created_at < b.created_at ? -1 : 1);

  function tasksForDay(day) {
    const t = todayIso();
    return S.tasks.filter((x) => {
      if (x.due_date === day) return true;
      // Les tâches en retard non faites remontent dans la journée d'aujourd'hui
      return day === t && !x.done && x.due_date && x.due_date < t;
    });
  }

  /* ================= Rendu ================= */
  function render() {
    const main = $('#main');
    document.querySelectorAll('#tabs button').forEach((b) => {
      if (b.dataset.view === S.view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    renderBanner();
    if (S.view === 'notes') { main.classList.add('wide'); renderNotes(); return; }
    main.classList.remove('wide');

    // Conserver la saisie rapide en cours pendant un nouveau rendu
    const qt = $('#q-title');
    const keep = qt ? { v: qt.value, f: document.activeElement === qt, p: $('#q-prio').value } : null;

    main.innerHTML = S.view === 'jour' ? viewDay() : viewOverview();

    if (keep) {
      const n = $('#q-title');
      if (n) { n.value = keep.v; $('#q-prio').value = keep.p; if (keep.f) n.focus(); }
    }
  }

  function renderBanner() {
    const el = $('#banner');
    const hasExamples = S.tasks.some((t) => t.example) || S.notes.some((n) => n.example);
    let html = '';
    if (hasExamples) {
      html = `<div class="banner"><div class="banner-in"><p>Ce sont des <b>exemples</b> pour te montrer l'outil. Efface-les quand tu veux commencer avec tes propres tâches.</p>
        <button type="button" class="btn btn-sm btn-ghost" data-act="clear-examples">Effacer les exemples</button></div></div>`;
    } else if (!CLOUD) {
      const dismissed = LS.get('mp:local-banner-off', false);
      if (!dismissed) {
        html = `<div class="banner"><div class="banner-in"><p>Tes données sont enregistrées sur <b>cet appareil uniquement</b>. Configure Supabase (voir le guide) pour les retrouver partout.</p>
          <button type="button" class="btn btn-sm btn-ghost" data-act="dismiss-banner">Compris</button></div></div>`;
      }
    }
    el.innerHTML = html;
  }

  function quickAdd(defDate) {
    return `<form class="quick" id="quick" autocomplete="off">
      <input type="text" id="q-title" placeholder="Ajouter une tâche…" maxlength="200" aria-label="Nouvelle tâche">
      <div class="qopts">
        <select id="q-prio" aria-label="Priorité">
          <option value="1">Critique</option><option value="2">Haute</option>
          <option value="3" selected>Moyenne</option><option value="4">Basse</option>
        </select>
        <input type="date" id="q-date" value="${esc(defDate || '')}" aria-label="Date">
        <button class="btn btn-primary btn-sm" type="submit">Ajouter</button>
      </div>
    </form>`;
  }

  function taskItem(t, { rank = null, showDate = false } = {}) {
    const t0 = todayIso();
    const late = !t.done && t.due_date && t.due_date < t0;
    const dl = dueLabel(t.due_date);
    const meta = [];
    meta.push(`<span class="pill">${PRIO[t.priority].label}</span>`);
    if (showDate) meta.push(`<span class="when ${dl.cls}">${esc(dl.text)}</span>`);
    else if (late) meta.push(`<span class="late">En retard depuis ${esc(fmt(t.due_date, { weekday: 'short', day: 'numeric' }))}</span>`);
    if (t.duration) meta.push(`<span class="dur">${fmtDur(t.duration)}</span>`);
    if (t.category) meta.push(`<span class="cat">${esc(t.category)}</span>`);
    if (t.notes) meta.push(`<span class="has-note">${ICON.note}Note</span>`);
    return `<li class="task p${t.priority}${t.done ? ' done' : ''}" data-id="${t.id}">
      <button type="button" class="check" data-act="toggle" aria-pressed="${t.done}" aria-label="${t.done ? 'Marquer comme à faire' : 'Marquer comme faite'}">${ICON.check}</button>
      ${rank !== null ? `<span class="rank" aria-hidden="true">${rank}</span>` : ''}
      <button type="button" class="tbody" data-act="edit">
        <span class="ttl">${esc(t.title)}</span>
        <span class="meta">${meta.join('')}</span>
      </button>
    </li>`;
  }

  function section(title, count, inner) {
    return `<section class="sec"><div class="sec-h"><h2>${title}</h2><span class="n">${count}</span><span class="rule"></span></div>${inner}</section>`;
  }

  /* ---------- Ma journée ---------- */
  function viewDay() {
    const t0 = todayIso();
    const ws = S.weekStart;
    const we = addDays(ws, 6);

    let week = '';
    for (let i = 0; i < 7; i++) {
      const d = addDays(ws, i);
      const list = tasksForDay(d).filter((x) => !x.done);
      const mins = list.reduce((s, x) => s + (x.duration || 30), 0);
      const top = list.length ? Math.min(...list.map((x) => x.priority)) : 0;
      const w = Math.min(100, Math.round(mins / 480 * 100));
      week += `<button type="button" class="wday${d === t0 ? ' is-today' : ''}" data-day="${d}" aria-pressed="${d === S.day}"
        aria-label="${esc(cap(fmt(d, { weekday: 'long', day: 'numeric', month: 'long' })))}, ${list.length} tâche${list.length > 1 ? 's' : ''}">
        <span class="wd">${esc(fmt(d, { weekday: 'short' }).replace('.', ''))}</span>
        <span class="dn">${dateOf(d).getDate()}</span>
        <span class="load"><i class="${top ? 'p' + top : ''}" style="width:${list.length ? Math.max(w, 8) : 0}%"></i></span>
        <span class="cnt">${list.length || ''}</span>
      </button>`;
    }

    const wLabel = `${fmt(ws, { day: 'numeric', month: 'short' })} – ${fmt(we, { day: 'numeric', month: 'short' })}`;
    const all = tasksForDay(S.day);
    const todo = all.filter((x) => !x.done).sort(byPriority);
    const done = all.filter((x) => x.done).sort((a, b) => (a.done_at || '') < (b.done_at || '') ? 1 : -1);
    const mins = todo.reduce((s, x) => s + (x.duration || 0), 0);
    const unknown = todo.filter((x) => !x.duration).length;
    const pct = all.length ? Math.round(done.length / all.length * 100) : 0;

    const dd = diffDays(S.day, t0);
    const rel = dd === 0 ? "Aujourd'hui" : dd === 1 ? 'Demain' : dd === -1 ? 'Hier' : '';
    const title = cap(fmt(S.day, { weekday: 'long', day: 'numeric', month: 'long' }));

    let body = '';
    if (!all.length) {
      body = `<div class="empty" style="margin-top:22px"><h3>Rien de prévu ${dd === 0 ? "aujourd'hui" : 'ce jour-là'}</h3>
        <p>Ajoute une tâche avec le champ ci-dessus. Elle sera rangée automatiquement selon sa priorité.</p></div>`;
    } else {
      const focus = todo.slice(0, 3);
      const rest = todo.slice(3);
      if (focus.length) {
        body += section('À faire en premier', focus.length,
          `<ol class="list focus">${focus.map((x, i) => taskItem(x, { rank: i + 1 })).join('')}</ol>`);
      } else {
        body += `<div class="empty" style="margin-top:22px"><h3>Tout est fait</h3><p>Toutes les tâches de cette journée sont terminées.</p></div>`;
      }
      if (rest.length) {
        body += section('Ensuite', rest.length,
          `<ol class="list">${rest.map((x, i) => taskItem(x, { rank: i + 4 })).join('')}</ol>`);
      }
      if (done.length) {
        body += section('Terminées', done.length, `<ol class="list">${done.map((x) => taskItem(x)).join('')}</ol>`);
      }
    }

    return `
      <div class="weeknav">
        <span class="wlabel">${esc(wLabel)}</span>
        <button type="button" class="icon-btn" data-act="week-prev" aria-label="Semaine précédente">${ICON.prev}</button>
        <button type="button" class="btn btn-sm btn-ghost" data-act="go-today">Aujourd'hui</button>
        <button type="button" class="icon-btn" data-act="week-next" aria-label="Semaine suivante">${ICON.next}</button>
      </div>
      <div class="week">${week}</div>
      <div class="dayhead">
        <div>
          <h1>${esc(title)}${rel ? ` <span class="rel">· ${rel}</span>` : ''}</h1>
          <div class="stats">
            <span><b>${todo.length}</b> à faire</span>
            ${mins ? `<span><b>${fmtDur(mins)}</b> estimées${unknown ? ` (+${unknown} sans durée)` : ''}</span>` : ''}
            <span><b>${done.length}</b> terminée${done.length > 1 ? 's' : ''}</span>
          </div>
        </div>
      </div>
      ${all.length ? `<div class="progress" aria-hidden="true"><i style="width:${pct}%"></i></div>` : ''}
      ${quickAdd(S.day)}
      ${body}`;
  }

  /* ---------- Vue d'ensemble ---------- */
  function viewOverview() {
    const t0 = todayIso();
    const open = S.tasks.filter((x) => !x.done);
    const late = open.filter((x) => x.due_date && x.due_date < t0).length;
    const nodate = open.filter((x) => !x.due_date).length;
    const max = Math.max(1, ...[1, 2, 3, 4].map((p) => open.filter((x) => x.priority === p).length));

    const bars = [1, 2, 3, 4].map((p) => {
      const n = open.filter((x) => x.priority === p).length;
      return `<button type="button" class="pb p${p}" data-act="jump-prio" data-prio="${p}">
        <div class="lbl">${PRIO[p].label}</div><div class="num">${n}</div>
        <div class="bar"><i style="width:${Math.round(n / max * 100)}%"></i></div></button>`;
    }).join('');

    const q = S.q.trim().toLowerCase();
    let list = S.tasks.filter((x) => S.filter === 'all' || (S.filter === 'done' ? x.done : !x.done));
    if (q) list = list.filter((x) => (x.title + ' ' + (x.category || '') + ' ' + (x.notes || '')).toLowerCase().includes(q));

    let groups = '';
    for (const p of [1, 2, 3, 4]) {
      const g = list.filter((x) => x.priority === p).sort(byPriority);
      if (!g.length) continue;
      groups += `<div id="prio-${p}">${section(PRIO[p].label, g.length, `<ol class="list">${g.map((x) => taskItem(x, { showDate: true })).join('')}</ol>`)}</div>`;
    }
    if (!groups) {
      groups = `<div class="empty" style="margin-top:22px"><h3>${q ? 'Aucun résultat' : S.filter === 'done' ? 'Aucune tâche terminée' : 'Aucune tâche à faire'}</h3>
        <p>${q ? 'Essaie un autre mot.' : 'Ajoute une tâche avec le champ ci-dessus.'}</p></div>`;
    }

    return `
      <div class="ov-head">
        <h1>Vue d'ensemble</h1>
        <div class="stats">
          <span><b>${open.length}</b> à faire</span>
          ${late ? `<span class="late"><b style="color:inherit">${late}</b> en retard</span>` : ''}
          <span><b>${nodate}</b> sans date</span>
          <span><b>${S.tasks.length - open.length}</b> terminée${S.tasks.length - open.length > 1 ? 's' : ''}</span>
        </div>
      </div>
      <div class="prio-bar">${bars}</div>
      ${quickAdd('')}
      <div class="tools">
        <div class="seg" role="group" aria-label="Filtrer">
          <button type="button" data-act="filter" data-f="todo" aria-pressed="${S.filter === 'todo'}">À faire</button>
          <button type="button" data-act="filter" data-f="done" aria-pressed="${S.filter === 'done'}">Terminées</button>
          <button type="button" data-act="filter" data-f="all" aria-pressed="${S.filter === 'all'}">Tout</button>
        </div>
        <input type="search" class="search" id="ov-search" placeholder="Rechercher une tâche…" value="${esc(S.q)}" aria-label="Rechercher">
      </div>
      ${groups}`;
  }

  /* ---------- Notes ---------- */
  function sortedNotes() {
    const q = S.noteQ.trim().toLowerCase();
    return S.notes
      .filter((n) => !q || (n.title + ' ' + n.content).toLowerCase().includes(q))
      .sort((a, b) => (b.pinned - a.pinned) || (a.updated_at < b.updated_at ? 1 : -1));
  }

  function noteDate(iso) {
    const d = new Date(iso);
    const t = todayIso();
    const di = isoOf(d);
    if (di === t) return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(d);
    if (di === addDays(t, -1)) return 'Hier';
    return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(d);
  }

  function noteListHtml() {
    const notes = sortedNotes();
    if (!notes.length) {
      return `<li class="empty" style="padding:22px 14px"><p>${S.noteQ ? 'Aucune note trouvée.' : 'Aucune note pour l\'instant.'}</p></li>`;
    }
    return notes.map((n) => {
      const first = (n.content || '').split('\n').find((l) => l.trim()) || '';
      return `<li><button type="button" class="nitem" data-note="${n.id}" aria-current="${n.id === S.noteId}">
        <span class="nt">${n.pinned ? ICON.pin : ''}${esc(n.title || first || 'Sans titre')}</span>
        <span class="nx">${esc(n.title ? first : '') || '&nbsp;'}</span>
        <span class="nd">${esc(noteDate(n.updated_at))}</span>
      </button></li>`;
    }).join('');
  }

  function renderNoteList() {
    const ul = $('#nitems');
    if (ul) ul.innerHTML = noteListHtml();
  }

  function renderNotes() {
    const main = $('#main');
    const editorFocused = document.activeElement && document.activeElement.closest && document.activeElement.closest('.neditor');
    if (editorFocused && $('.notes') && $('.neditor').dataset.id === S.noteId) { renderNoteList(); return; }

    const note = S.notes.find((n) => n.id === S.noteId);
    const editor = note ? `
      <section class="neditor" data-id="${note.id}">
        <button type="button" class="btn btn-sm btn-ghost nback" data-act="note-back">${ICON.prev} Notes</button>
        <input class="ntitle" id="n-title" placeholder="Titre" value="${esc(note.title)}" maxlength="200" aria-label="Titre de la note">
        <textarea class="ncontent" id="n-content" placeholder="Écris ta note…" aria-label="Contenu de la note">${esc(note.content)}</textarea>
        <div class="nfoot">
          <span class="saved" id="n-saved">Modifiée ${esc(noteDate(note.updated_at))}</span>
          <button type="button" class="btn btn-sm btn-ghost" data-act="note-pin">${note.pinned ? 'Désépingler' : 'Épingler'}</button>
          <button type="button" class="btn btn-sm btn-danger-ghost" data-act="note-delete">Supprimer</button>
        </div>
      </section>` : `
      <section class="neditor nempty"><div><h3 style="font-size:18px;color:var(--ink);margin-bottom:6px">Aucune note ouverte</h3>
        <p style="margin:0">Choisis une note dans la liste ou crée-en une nouvelle.</p></div></section>`;

    main.innerHTML = `
      <div class="notes${note ? ' editing' : ''}">
        <aside class="nlist">
          <div class="nlist-h"><h1>Notes</h1><button type="button" class="btn btn-primary btn-sm" data-act="note-new">Nouvelle note</button></div>
          <input type="search" class="search" id="n-search" placeholder="Rechercher dans les notes…" value="${esc(S.noteQ)}" aria-label="Rechercher dans les notes">
          <ul class="nitems" id="nitems">${noteListHtml()}</ul>
        </aside>
        ${editor}
      </div>`;
  }

  let noteTimer = null;
  function onNoteInput() {
    const note = S.notes.find((n) => n.id === S.noteId);
    if (!note) return;
    note.title = $('#n-title').value;
    note.content = $('#n-content').value;
    note.updated_at = nowIso();
    $('#n-saved').textContent = 'Enregistrement…';
    renderNoteList();
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => {
      Data.upsert('notes', note, { silent: true });
      const s = $('#n-saved');
      if (s) s.textContent = 'Enregistrée';
    }, 600);
  }
  function flushNote() {
    if (noteTimer) {
      clearTimeout(noteTimer); noteTimer = null;
      const note = S.notes.find((n) => n.id === S.noteId);
      if (note) Data.upsert('notes', note, { silent: true });
    }
  }

  /* ================= Fiche tâche ================= */
  function openTask(id, defaults = {}) {
    const t = id ? S.tasks.find((x) => x.id === id) : null;
    S.editingId = t ? t.id : null;
    $('#sheet-title').textContent = t ? 'Modifier la tâche' : 'Nouvelle tâche';
    $('#f-title').value = t ? t.title : (defaults.title || '');
    const p = t ? t.priority : (defaults.priority || 3);
    $(`#f-prio-${p}`).checked = true;
    $('#f-date').value = t ? (t.due_date || '') : (defaults.due_date ?? S.day);
    $('#f-dur').value = t && t.duration ? String(t.duration) : '';
    $('#f-cat').value = t ? (t.category || '') : '';
    $('#f-notes').value = t ? (t.notes || '') : '';
    const del = $('#f-delete');
    del.hidden = !t;
    del.classList.remove('armed');
    del.textContent = 'Supprimer';
    const cats = [...new Set(S.tasks.map((x) => x.category).filter(Boolean))].sort();
    $('#cat-list').innerHTML = cats.map((c) => `<option value="${esc(c)}">`).join('');
    $('#overlay').hidden = false;
    setTimeout(() => $('#f-title').focus(), 30);
  }
  function closeTask() { $('#overlay').hidden = true; S.editingId = null; }

  function saveTaskForm(e) {
    e.preventDefault();
    const title = $('#f-title').value.trim();
    if (!title) { $('#f-title').focus(); toast('Donne un nom à la tâche.'); return; }
    const prev = S.editingId ? S.tasks.find((x) => x.id === S.editingId) : null;
    const row = {
      ...(prev || { id: uid(), done: false, done_at: null, created_at: nowIso() }),
      title,
      priority: Number(document.querySelector('input[name="f-prio"]:checked')?.value || 3),
      due_date: $('#f-date').value || null,
      duration: $('#f-dur').value ? Number($('#f-dur').value) : null,
      category: $('#f-cat').value.trim(),
      notes: $('#f-notes').value.trim()
    };
    delete row.example;
    closeTask();
    Data.upsert('tasks', row);
    toast(prev ? 'Tâche modifiée' : 'Tâche ajoutée');
  }

  /* ================= Toast ================= */
  let toastTimer = null;
  function toast(msg, action) {
    const el = $('#toast');
    el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button" id="toast-act">${esc(action.label)}</button>` : ''}`;
    el.hidden = false;
    if (action) $('#toast-act').onclick = () => { el.hidden = true; action.run(); };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, action ? 5000 : 2200);
  }

  /* ================= Actions ================= */
  function toggleTask(id) {
    const t = S.tasks.find((x) => x.id === id);
    if (!t) return;
    const row = { ...t, done: !t.done, done_at: !t.done ? nowIso() : null };
    Data.upsert('tasks', row);
    if (row.done) toast('Tâche terminée', { label: 'Annuler', run: () => Data.upsert('tasks', { ...row, done: false, done_at: null }) });
  }

  let clearArmed = false;
  function clearExamples(btn) {
    if (!clearArmed) {
      clearArmed = true;
      btn.textContent = 'Confirmer l\'effacement';
      btn.classList.add('btn-danger-ghost', 'armed');
      setTimeout(() => { clearArmed = false; renderBanner(); }, 4000);
      return;
    }
    clearArmed = false;
    S.tasks.filter((t) => t.example).map((t) => t.id).forEach((id) => {
      const i = S.tasks.findIndex((x) => x.id === id); S.tasks.splice(i, 1);
    });
    S.notes = S.notes.filter((n) => !n.example);
    if (S.noteId && !S.notes.find((n) => n.id === S.noteId)) S.noteId = null;
    Data.saveCache();
    render();
    toast('Exemples effacés');
  }

  function setView(v) {
    if (S.view === 'notes') flushNote();
    S.view = v;
    try { history.replaceState(null, '', '#' + v); } catch { }
    LS.set('mp:view', v);
    render();
    window.scrollTo(0, 0);
  }

  function exportData() {
    const blob = new Blob([JSON.stringify({ exporte_le: nowIso(), taches: S.tasks, notes: S.notes }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `mes-priorites-${todayIso()}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function bindEvents() {
    $('#tabs').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-view]');
      if (b) setView(b.dataset.view);
    });

    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-act], [data-day], [data-note]');
      if (!el) return;
      if (el.dataset.day) { S.day = el.dataset.day; render(); return; }
      if (el.dataset.note) { flushNote(); S.noteId = el.dataset.note; renderNotes(); setTimeout(() => { const c = $('#n-content'); if (c) { c.focus({ preventScroll: true }); c.setSelectionRange(c.value.length, c.value.length); } }, 20); return; }
      const li = el.closest('.task');
      switch (el.dataset.act) {
        case 'toggle': toggleTask(li.dataset.id); break;
        case 'edit': openTask(li.dataset.id); break;
        case 'week-prev': S.weekStart = addDays(S.weekStart, -7); S.day = S.weekStart; render(); break;
        case 'week-next': S.weekStart = addDays(S.weekStart, 7); S.day = S.weekStart; render(); break;
        case 'go-today': S.day = todayIso(); S.weekStart = mondayOf(S.day); render(); break;
        case 'filter': S.filter = el.dataset.f; render(); break;
        case 'jump-prio': {
          S.filter = 'todo'; S.q = ''; render();
          const tgt = document.getElementById('prio-' + el.dataset.prio);
          if (tgt) tgt.scrollIntoView({ behavior: 'smooth', block: 'start' });
          break;
        }
        case 'clear-examples': clearExamples(el); break;
        case 'dismiss-banner': LS.set('mp:local-banner-off', true); renderBanner(); break;
        case 'note-new': {
          flushNote();
          const n = { id: uid(), title: '', content: '', pinned: false, created_at: nowIso(), updated_at: nowIso() };
          S.noteQ = '';
          Data.upsert('notes', n, { silent: true });
          S.noteId = n.id;
          renderNotes();
          setTimeout(() => $('#n-title')?.focus(), 20);
          break;
        }
        case 'note-back': flushNote(); S.noteId = null; renderNotes(); break;
        case 'note-pin': {
          flushNote();
          const n = S.notes.find((x) => x.id === S.noteId);
          if (n) { n.pinned = !n.pinned; delete n.example; Data.upsert('notes', n, { silent: true }); renderNotes(); }
          break;
        }
        case 'note-delete': {
          if (!el.classList.contains('armed')) {
            el.classList.add('armed'); el.textContent = 'Confirmer la suppression';
            setTimeout(() => { if (el.isConnected) { el.classList.remove('armed'); el.textContent = 'Supprimer'; } }, 4000);
            break;
          }
          clearTimeout(noteTimer); noteTimer = null;
          const id = S.noteId; S.noteId = null;
          Data.remove('notes', id);
          toast('Note supprimée');
          break;
        }
      }
    });

    document.addEventListener('submit', (e) => {
      if (e.target.id !== 'quick') return;
      e.preventDefault();
      const title = $('#q-title').value.trim();
      if (!title) { $('#q-title').focus(); return; }
      Data.upsert('tasks', {
        id: uid(), title, priority: Number($('#q-prio').value), due_date: $('#q-date').value || null,
        duration: null, category: '', notes: '', done: false, done_at: null, created_at: nowIso()
      });
      const n = $('#q-title'); n.value = ''; n.focus();
      toast('Tâche ajoutée');
    });

    document.addEventListener('input', (e) => {
      if (e.target.id === 'ov-search') {
        S.q = e.target.value;
        const pos = e.target.selectionStart;
        render();
        const s = $('#ov-search'); s.focus(); s.setSelectionRange(pos, pos);
      } else if (e.target.id === 'n-search') {
        S.noteQ = e.target.value; renderNoteList();
      } else if (e.target.id === 'n-title' || e.target.id === 'n-content') {
        const note = S.notes.find((n) => n.id === S.noteId);
        if (note) delete note.example;
        onNoteInput();
      }
    });

    // Fiche tâche
    $('#task-form').addEventListener('submit', saveTaskForm);
    $('#overlay').addEventListener('click', (e) => {
      if (e.target.id === 'overlay' || e.target.closest('[data-close]')) closeTask();
      const chip = e.target.closest('[data-when]');
      if (chip) $('#f-date').value = chip.dataset.when === 'none' ? '' : addDays(todayIso(), Number(chip.dataset.when));
    });
    $('#f-delete').addEventListener('click', (e) => {
      const b = e.currentTarget;
      if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Confirmer'; return; }
      const id = S.editingId;
      const row = S.tasks.find((x) => x.id === id);
      closeTask();
      Data.remove('tasks', id);
      toast('Tâche supprimée', { label: 'Annuler', run: () => { if (row) Data.upsert('tasks', { ...row }); } });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!$('#overlay').hidden) closeTask();
        else if (!$('#menu').hidden) toggleMenu(false);
      }
    });

    // Menu
    $('#menu-btn').addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });
    document.addEventListener('click', (e) => { if (!e.target.closest('#menu') && !$('#menu').hidden) toggleMenu(false); });
    $('#menu').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-menu]');
      if (!b) return;
      toggleMenu(false);
      if (b.dataset.menu === 'export') exportData();
      if (b.dataset.menu === 'logout' && sb) {
        flushNote();
        await Data.flush();
        await sb.auth.signOut();
      }
    });

    window.addEventListener('online', () => Data.flush());
    window.addEventListener('offline', () => CLOUD && setSync('offline'));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        // Si la date a changé pendant la nuit, revenir sur aujourd'hui
        const t = todayIso();
        if (S.lastSeen && S.lastSeen !== t && S.day === S.lastSeen) { S.day = t; S.weekStart = mondayOf(t); }
        S.lastSeen = t;
        Data.pull().then(() => render());
      } else {
        flushNote();
      }
    });
    window.addEventListener('pagehide', flushNote);
  }

  function toggleMenu(force) {
    const m = $('#menu');
    const open = force ?? m.hidden;
    m.hidden = !open;
    $('#menu-btn').setAttribute('aria-expanded', String(open));
  }

  /* ================= Connexion ================= */
  let signupMode = false;
  function showAuth() {
    $('#app').hidden = true;
    $('#auth').hidden = false;
    setAuthMode(false);
  }
  function setAuthMode(signup) {
    signupMode = signup;
    $('#auth-submit').textContent = signup ? 'Créer mon compte' : 'Se connecter';
    $('#auth-switch').textContent = signup ? 'Déjà un compte ? Se connecter' : 'Pas encore de compte ? Créer un compte';
    $('#auth-pass').autocomplete = signup ? 'new-password' : 'current-password';
    $('#auth-msg').textContent = '';
    $('#auth-msg').className = 'auth-msg';
  }
  function authError(err) {
    const m = (err && err.message) || '';
    if (/invalid login/i.test(m)) return 'E-mail ou mot de passe incorrect.';
    if (/email not confirmed/i.test(m)) return 'Confirme d\'abord ton adresse avec le lien reçu par e-mail.';
    if (/already registered/i.test(m)) return 'Un compte existe déjà avec cet e-mail. Connecte-toi.';
    if (/password.*(6|short|weak)/i.test(m)) return 'Le mot de passe doit contenir au moins 6 caractères.';
    if (/signups? not allowed|signup.*disabled/i.test(m)) return 'La création de compte est désactivée.';
    if (/fetch|network/i.test(m)) return 'Pas de connexion. Vérifie ton accès à internet.';
    return m || 'Une erreur est survenue. Réessaie.';
  }
  function bindAuth() {
    $('#auth-switch').addEventListener('click', () => setAuthMode(!signupMode));
    $('#auth-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = $('#auth-email').value.trim();
      const password = $('#auth-pass').value;
      const msg = $('#auth-msg');
      if (!email || password.length < 6) {
        msg.textContent = 'Indique ton e-mail et un mot de passe d\'au moins 6 caractères.'; msg.className = 'auth-msg err'; return;
      }
      const btn = $('#auth-submit');
      btn.disabled = true;
      msg.textContent = signupMode ? 'Création du compte…' : 'Connexion…'; msg.className = 'auth-msg';
      try {
        if (signupMode) {
          const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
          if (error) throw error;
          if (!data.session) {
            msg.textContent = 'Compte créé. Ouvre le lien reçu par e-mail pour le confirmer, puis connecte-toi ici.';
            msg.className = 'auth-msg ok';
            setTimeout(() => { signupMode = false; $('#auth-submit').textContent = 'Se connecter'; $('#auth-switch').textContent = 'Pas encore de compte ? Créer un compte'; }, 0);
          }
        } else {
          const { error } = await sb.auth.signInWithPassword({ email, password });
          if (error) throw error;
        }
      } catch (err) {
        msg.textContent = authError(err); msg.className = 'auth-msg err';
      } finally {
        btn.disabled = false;
      }
    });
  }

  /* ================= Démarrage ================= */
  function startApp() {
    $('#auth').hidden = true;
    $('#app').hidden = false;
    Data.loadCache();
    if (!CLOUD && S.tasks === null && S.notes === null) {
      const ex = exampleData();
      S.tasks = ex.tasks; S.notes = ex.notes;
      Data.saveCache();
    }
    S.tasks = S.tasks || [];
    S.notes = S.notes || [];
    S.lastSeen = todayIso();
    $('#menu-account').textContent = S.user ? `Connecté : ${S.user.email}` : 'Mode local · données sur cet appareil';
    $('#menu-logout').hidden = !CLOUD;
    setSync(CLOUD ? (navigator.onLine ? 'pending' : 'offline') : 'local');
    render();
    Data.pull();
  }

  function init() {
    const h = (location.hash || '').slice(1);
    S.view = ['jour', 'ensemble', 'notes'].includes(h) ? h : (LS.get('mp:view', 'jour'));
    bindEvents();
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(() => { });
    }
    if (!CLOUD) { S.user = null; startApp(); return; }

    bindAuth();
    let started = false;
    // Important : ne jamais appeler Supabase directement dans ce callback
    // (il s'exécute pendant que Supabase détient son verrou de session).
    // On reporte donc le travail juste après avec setTimeout.
    sb.auth.onAuthStateChange((event, session) => {
      setTimeout(() => {
        if (session && session.user) {
          if (!started || (S.user && S.user.id !== session.user.id)) {
            S.user = session.user; started = true; startApp();
          } else {
            S.user = session.user;
          }
        } else if (event === 'SIGNED_OUT' || !session) {
          started = false; S.user = null; S.tasks = []; S.notes = [];
          showAuth();
        }
      }, 0);
    });
  }

  init();
})();
