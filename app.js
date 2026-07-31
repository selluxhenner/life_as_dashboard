(function(){
  var STORE_KEY = 'lifeOsDashboardState_v4';
  var OLD_STORE_KEYS = ['lifeOsDashboardState_v3', 'lifeOsDashboardState_v2'];
  var TIERS = [
    {key:'woche', label:'Woche'},
    {key:'monat', label:'Monat'},
    {key:'jahr', label:'Jahr'}
  ];
  var RANKS = [
    {min:0,    name:'Rekrut',          ins:'▪'},
    {min:30,   name:'Soldat',          ins:'▮'},
    {min:70,   name:'Gefreiter',       ins:'▮▪'},
    {min:120,  name:'Obergefreiter',   ins:'▮▮'},
    {min:180,  name:'Korporal',        ins:'▮▮▪'},
    {min:260,  name:'Wachtmeister',    ins:'▮▮▮'},
    {min:360,  name:'Feldweibel',      ins:'▰▮▮'},
    {min:480,  name:'Hauptfeldweibel', ins:'▰▰▮'},
    {min:620,  name:'Adjutant',        ins:'▰▰▰'},
    {min:780,  name:'Leutnant',        ins:'★'},
    {min:960,  name:'Oberleutnant',    ins:'★★'},
    {min:1200, name:'Hauptmann',       ins:'★★★'}
  ];
  var STREAK_BONUS = {3:3, 7:7, 14:10, 21:15, 30:20, 50:25, 100:50};
  var QUOTES = [
    'Build systems that outlast motivation.',
    'Consistency over intensity.',
    'Improve a little every day.',
    'Finish what you start.',
    'Quality compounds over time.',
    'Small improvements create extraordinary long-term results.',
    'Learning over comfort.',
    'Ownership over dependence.',
    'Build more than you consume.',
    'Invest in skills before status.',
    'Systems over motivation.',
    'Long-term value over short-term recognition.'
  ];
  var MOODS = ['😞','😕','😐','🙂','🔥'];
  var BEW_STATUS = [
    {key:'entwurf',   label:'Entwurf'},
    {key:'beworben',  label:'Beworben'},
    {key:'interview', label:'Interview'},
    {key:'angebot',   label:'Angebot'},
    {key:'absage',    label:'Absage'}
  ];
  var BEW_AWARDS = {beworben:5, interview:8, angebot:15};
  var WEEKDAYS = ['Mo','Di','Mi','Do','Fr','Sa','So'];

  function uid(){ return 'id_' + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
  function pad2(n){ return String(n).padStart(2,'0'); }
  function dateKey(d){ return d.getFullYear() + '-' + pad2(d.getMonth()+1) + '-' + pad2(d.getDate()); }
  function todayKey(){ return dateKey(new Date()); }
  function parseKey(k){ var p = k.split('-'); return new Date(+p[0], +p[1]-1, +p[2]); }
  function keyOffset(k, days){ var d = parseKey(k); d.setDate(d.getDate()+days); return dateKey(d); }
  function pct(done, total){ return total ? Math.round((done/total)*100) : 0; }
  function mondayKeyOf(d){ var m = new Date(d); m.setDate(m.getDate() - ((m.getDay()+6)%7)); return dateKey(m); }
  function isoWeek(d){
    var t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    t.setDate(t.getDate() + 3 - ((t.getDay()+6)%7));
    var firstThu = new Date(t.getFullYear(), 0, 4);
    firstThu.setDate(firstThu.getDate() + 3 - ((firstThu.getDay()+6)%7));
    return 1 + Math.round((t - firstThu) / (7*24*3600*1000));
  }
  function fmtShort(k){ var d = parseKey(k); return pad2(d.getDate()) + '.' + pad2(d.getMonth()+1) + '.'; }

  function el(tag, cls, text){
    var e = document.createElement(tag);
    if(cls) e.className = cls;
    if(text !== undefined) e.textContent = text;
    return e;
  }

  /* ---------- state ---------- */
  var defaultState = {
    name: 'Kevin',
    ziele: {
      woche: [
        {id:uid(), label:'3x Krafttraining absolvieren', done:false},
        {id:uid(), label:'Deep Work Block jeden Tag', done:false},
        {id:uid(), label:'2 Bewerbungen versenden', done:false}
      ],
      monat: [
        {id:uid(), label:'Bewerbungen an Ostschweizer Agenturen raus', done:false},
        {id:uid(), label:'Tiger Wil Redesign abschliessen', done:false},
        {id:uid(), label:'+0.5 kg Richtung Zielgewicht', done:false}
      ],
      jahr: [
        {id:uid(), label:'Praktikum Plus / Junior-Rolle (80%) ab August', done:false},
        {id:uid(), label:'Studium OST Rapperswil starten (Herbst)', done:false},
        {id:uid(), label:'ServiWeb & Produkte auf Instagram ausbauen', done:false},
        {id:uid(), label:'Zielgewicht 72 kg erreichen', done:false}
      ]
    },
    habits: [
      {id:uid(), label:'Deep Work Block', sub:'Mind. 1×25-min Focus-Session', icon:'🧠', history:{}, mode:'daily', link:'focus'},
      {id:uid(), label:'Training / Bewegung', sub:'Kraft oder Sport-Einheit', icon:'💪', history:{}, mode:'weekly', target:6},
      {id:uid(), label:'Mahlzeiten + Protein', sub:'Frühstück · Mittag · Nachtessen + Shake/Wrap', icon:'🥩', history:{}, mode:'daily'}
    ],
    todos: {
      high: [ {id:uid(), label:'Tiger Wil Redesign weiterbringen', done:false} ],
      med: [ {id:uid(), label:'Trinkstube zum Hartz planen', done:false} ],
      low: []
    },
    fitness: { weight:67.0 }
  };

  function freshExtras(){
    return {
      meta: { createdAt: todayKey(), lastSettledDay: todayKey() },
      dayplan: {},
      weekplan: {},
      weekFocus: {},
      reflections: {},
      bewerbungen: [{
        id: uid(), firma:'Weitblick', rolle:'Praktikum Plus (ab August)', status:'interview',
        date:'', next:'Nachfassen / nächstes Gespräch klären',
        notes:'Erstes Online-Gespräch geführt, lief gut',
        awarded:{beworben:true, interview:true}
      }],
      ledger: [],
      focus: {},
      routines: {}
    };
  }

  function load(){
    try{
      var raw = localStorage.getItem(STORE_KEY);
      if(raw) return migrate(JSON.parse(raw));
    }catch(e){}
    for(var i=0;i<OLD_STORE_KEYS.length;i++){
      try{
        var old = localStorage.getItem(OLD_STORE_KEYS[i]);
        if(old) return migrate(JSON.parse(old));
      }catch(e){}
    }
    var st = JSON.parse(JSON.stringify(defaultState));
    return migrate(st);
  }

  function migrate(s){
    var ex = freshExtras();
    if(!s.meta) s.meta = ex.meta;
    if(!s.meta.createdAt) s.meta.createdAt = todayKey();
    if(!s.meta.lastSettledDay) s.meta.lastSettledDay = todayKey();
    if(!s.dayplan) s.dayplan = {};
    if(!s.weekplan) s.weekplan = {};
    if(!s.weekFocus) s.weekFocus = {};
    if(!s.reflections) s.reflections = {};
    if(!s.bewerbungen) s.bewerbungen = ex.bewerbungen;
    if(!s.ledger) s.ledger = [];
    if(!s.focus) s.focus = {};
    if(!s.routines) s.routines = {};
    (s.habits||[]).forEach(function(h){ if(!h.createdAt) h.createdAt = s.meta.createdAt; });
    reworkHabits(s);
    if(!s.fitness) s.fitness = { weight:67.0 };
    delete s.fitness.steps; delete s.fitness.calories; delete s.fitness.workouts;
    delete s.lifestyle;
    importBewerbungen(s);
    return s;
  }

  /* Einmalige Umstellung 31.07.2026: präzise Habit-Definitionen,
     Training als Wochenziel (6x), Lesen entfernt, Deep Work an Focus Timer gekoppelt. */
  function reworkHabits(s){
    if(s.meta.habitRework20260731) return;
    s.meta.habitRework20260731 = true;
    var kept = [];
    (s.habits||[]).forEach(function(h){
      var l = (h.label||'').toLowerCase();
      if(l.indexOf('deep work') !== -1){
        h.label = 'Deep Work Block'; h.sub = 'Mind. 1×25-min Focus-Session';
        h.mode = 'daily'; h.link = 'focus'; kept.push(h);
      } else if(l.indexOf('training') !== -1 || l.indexOf('sport') !== -1){
        h.label = 'Training / Bewegung'; h.sub = 'Kraft oder Sport-Einheit';
        h.mode = 'weekly'; h.target = 6; kept.push(h);
      } else if(l.indexOf('protein') !== -1 || l.indexOf('mahlzeit') !== -1){
        h.label = 'Mahlzeiten + Protein'; h.sub = 'Frühstück · Mittag · Nachtessen + Shake/Wrap';
        h.mode = 'daily'; kept.push(h);
      } else if(l.indexOf('lesen') !== -1 || l.indexOf('lernen') !== -1){
        /* entfernt — nicht mehr getrackt */
      } else {
        if(!h.mode) h.mode = 'daily';
        kept.push(h);
      }
    });
    s.habits = kept;
  }

  /* Einmaliger Import der Bewerbungsrunde vom 26.07. + ältere Absagen/Pendenzen.
     awarded.beworben ist gesetzt, damit rückwirkend keine Punkte vergeben werden. */
  function importBewerbungen(s){
    if(s.meta.bewImport20260729) return;
    s.meta.bewImport20260729 = true;
    var items = [
      {firma:'Webkönig AG',      rolle:'Junior Web Publisher, 58k', status:'beworben', date:'2026-07-26', next:'Nachfassen ab 09.08.', notes:'Severin Schefer · Kontaktformular', awarded:{beworben:true}},
      {firma:'cloudWEB',         status:'beworben', date:'2026-07-26', next:'Nachfassen ab 09.08.', notes:'Thomas Hasenfratz · info@cloudweb.ch', awarded:{beworben:true}},
      {firma:'Nordwand AG',      status:'beworben', date:'2026-07-26', next:'Nachfassen ab 09.08.', notes:'Silvan Widmer · info@nordwand.swiss', awarded:{beworben:true}},
      {firma:'RESIGN.',          status:'absage',   date:'2026-07-26', next:'', notes:'René Grob · info@resign.ch · Kein Platz', awarded:{beworben:true}},
      {firma:'WinWebDesign',     status:'beworben', date:'2026-07-26', next:'Nachfassen ab 09.08.', notes:'Jairo Thoma · info@winwebdesign.ch', awarded:{beworben:true}},
      {firma:'Netframe Studios', status:'beworben', date:'2026-07-26', next:'Nachfassen ab 09.08.', notes:'Philipp Zähnler · kontakt@netframe-studios.ch', awarded:{beworben:true}},
      {firma:'BBK',              status:'beworben', date:'2026-07-26', next:'Nachfassen ab 09.08.', notes:'Markus Kammermann · service@agentur-bbk.ch', awarded:{beworben:true}},
      {firma:'Weitblick',        status:'absage',   next:'Zurück ab 03.08. · Tür offen', notes:'Marcial Bollinger · Kein Platz (Praktikant verlängert)', awarded:{beworben:true}},
      {firma:'Kernbrand',        status:'absage',   next:'', notes:'Absage', awarded:{beworben:true}},
      {firma:'Vitamin2',         status:'absage',   next:'', notes:'R. Kappeler · Keine Kapazitäten', awarded:{beworben:true}},
      {firma:'Next AG',          status:'beworben', next:'Anrufen — keine Rückmeldung (überfällig)', notes:'', awarded:{beworben:true}},
      {firma:'Digiplus',         status:'beworben', next:'Anrufen — keine Rückmeldung (überfällig)', notes:'', awarded:{beworben:true}},
      {firma:'Liip AG',          status:'beworben', next:'Anrufen — keine Rückmeldung (überfällig)', notes:'', awarded:{beworben:true}},
      {firma:'Faessler Media',   status:'beworben', next:'Keine Rückmeldung', notes:'', awarded:{beworben:true}}
    ];
    items.forEach(function(it){
      var existing = null;
      s.bewerbungen.forEach(function(b){
        if((b.firma||'').toLowerCase() === it.firma.toLowerCase()) existing = b;
      });
      if(existing){
        existing.status = it.status;
        existing.next = it.next;
        if(it.notes) existing.notes = existing.notes ? existing.notes + ' · ' + it.notes : it.notes;
        if(it.date) existing.date = it.date;
        if(!existing.awarded) existing.awarded = {};
        Object.keys(it.awarded||{}).forEach(function(k){ existing.awarded[k] = true; });
      } else {
        s.bewerbungen.push({
          id:uid(), firma:it.firma, rolle:it.rolle||'', status:it.status,
          date:it.date||'', next:it.next||'', notes:it.notes||'', awarded:it.awarded||{}
        });
      }
    });
  }

  var state = load();
  function save(){ localStorage.setItem(STORE_KEY, JSON.stringify(state)); }

  /* ---------- points / responsibility ---------- */
  function addLedger(label, delta, dk, detail){
    state.ledger.push({id:uid(), date: dk || todayKey(), label:label, delta:delta, detail:detail||''});
  }
  function totalPoints(){
    return state.ledger.reduce(function(sum, e){ return sum + e.delta; }, 0);
  }
  function rankFor(points){
    var p = Math.max(0, points);
    var current = RANKS[0], next = null;
    for(var i=0;i<RANKS.length;i++){
      if(p >= RANKS[i].min) current = RANKS[i];
      else { next = RANKS[i]; break; }
    }
    var progress = 100;
    if(next){
      progress = Math.round(((p - current.min) / (next.min - current.min)) * 100);
    }
    return {current:current, next:next, progress:progress, points:points};
  }
  function streakAsOf(history, dk){
    var s = 0, d = dk;
    while(history[d]){ s++; d = keyOffset(d, -1); }
    return s;
  }
  function bestStreak(history){
    var keys = Object.keys(history).filter(function(k){ return history[k]; }).sort();
    var best = 0;
    keys.forEach(function(k){
      if(!history[keyOffset(k,-1)]){
        var s = streakRunLength(history, k);
        if(s > best) best = s;
      }
    });
    return best;
  }
  function streakRunLength(history, startKey){
    var s = 0, d = startKey;
    while(history[d]){ s++; d = keyOffset(d, 1); }
    return s;
  }

  function routineFor(dk){
    if(!state.routines[dk]) state.routines[dk] = {sleep:null, screen:null, noPhone:false};
    return state.routines[dk];
  }
  function hasVal(v){ return v !== null && v !== undefined && v !== ''; }
  function routineItems(dk){
    var r = state.routines[dk] || {};
    return [
      {key:'sleep',   part:'morgen', label:'Schlaf eingetragen',          done: hasVal(r.sleep)},
      {key:'plan',    part:'morgen', label:'Tag geplant',                 done: (state.dayplan[dk]||[]).length > 0},
      {key:'noPhone', part:'morgen', label:'Kein Handy erste 30 min',     done: !!r.noPhone},
      {key:'screen',  part:'abend',  label:'Screen Time eingetragen',     done: hasVal(r.screen)}
    ];
  }
  function weekCount(habit, anyDayKey){
    var mon = mondayKeyOf(parseKey(anyDayKey));
    var c = 0;
    for(var i=0;i<7;i++){ if(habit.history[keyOffset(mon, i)]) c++; }
    return c;
  }

  function computeDaySettlement(dk){
    var res = {delta:0, habitsDone:0, habitsTotal:0, planDone:0, planTotal:0, routineDone:0, routineTotal:0, reflected:false, milestones:[]};
    var dailyDone = 0, dailyTotal = 0;
    state.habits.forEach(function(h){
      if(h.createdAt && h.createdAt > dk) return;
      res.habitsTotal++;
      if(h.mode === 'weekly'){
        if(h.history[dk]){ res.habitsDone++; res.delta += 1; }
        /* kein Malus an Ruhetagen — Wochenziel wird sonntags abgerechnet */
        return;
      }
      dailyTotal++;
      if(h.history[dk]){
        res.habitsDone++; dailyDone++;
        res.delta += 1;
        var s = streakAsOf(h.history, dk);
        if(STREAK_BONUS[s]) res.milestones.push({habit:h.label, streak:s, bonus:STREAK_BONUS[s]});
      } else {
        res.delta -= 2;
      }
    });
    if(dailyTotal > 0 && dailyDone === dailyTotal) res.delta += 3;
    routineItems(dk).forEach(function(it){
      res.routineTotal++;
      if(it.done){ res.routineDone++; res.delta += 1; }
      else res.delta -= 1;
    });
    (state.dayplan[dk] || []).forEach(function(b){
      res.planTotal++;
      if(b.done){ res.planDone++; res.delta += 1; }
      else res.delta -= 2;
    });
    var r = state.reflections[dk];
    res.reflected = !!(r && (r.mood !== null && r.mood !== undefined || (r.good&&r.good.trim()) || (r.improve&&r.improve.trim()) || (r.grateful&&r.grateful.trim())));
    res.delta += res.reflected ? 2 : -3;
    return res;
  }

  function settleDay(dk){
    var r = computeDaySettlement(dk);
    var detail = 'Habits ' + r.habitsDone + '/' + r.habitsTotal
      + ' · Plan ' + r.planDone + '/' + r.planTotal
      + ' · Routine ' + r.routineDone + '/' + r.routineTotal
      + ' · Reflexion ' + (r.reflected ? '✓' : '✗');
    addLedger('Tagesabrechnung ' + fmtShort(dk), r.delta, dk, detail);
    r.milestones.forEach(function(m){
      addLedger('🔥 ' + m.streak + '-Tage-Streak: ' + m.habit, m.bonus, dk);
    });
    /* Sonntag: Wochenziel-Habits abrechnen */
    if(parseKey(dk).getDay() === 0){
      var monKey = keyOffset(dk, -6);
      state.habits.forEach(function(h){
        if(h.mode !== 'weekly') return;
        if(h.createdAt && h.createdAt > monKey) return;
        var c = weekCount(h, dk);
        var t = h.target || 1;
        if(c >= t) addLedger('🎯 Wochenziel erreicht: ' + h.label + ' (' + c + '/' + t + ')', 3, dk);
        else addLedger('Wochenziel verpasst: ' + h.label + ' (' + c + '/' + t + ')', -(t - c), dk);
      });
    }
  }

  function settle(){
    var t = todayKey();
    var yesterday = keyOffset(t, -1);
    var last = state.meta.lastSettledDay;
    if(yesterday <= last) return;
    var d = keyOffset(last, 1);
    while(d <= yesterday){
      settleDay(d);
      d = keyOffset(d, 1);
    }
    state.meta.lastSettledDay = yesterday;
    save();
  }

  /* ---------- generic ---------- */
  var currentDay = todayKey();
  var weekOffset = 0;

  function switchView(name){
    document.querySelectorAll('.view').forEach(function(v){ v.classList.toggle('active', v.id === 'view-'+name); });
    document.querySelectorAll('nav button').forEach(function(b){ b.classList.toggle('active', b.dataset.view === name); });
    window.scrollTo({top:0, behavior:'smooth'});
  }

  function renderGreeting(){
    var h = new Date().getHours();
    var g = (h >= 5 && h < 11) ? 'Guten Morgen' : (h >= 11 && h < 18) ? 'Guten Tag' : 'Guten Abend';
    document.getElementById('greetWord').textContent = g + ',';
    document.getElementById('greetName').textContent = state.name;
  }

  /* ---------- ziele ---------- */
  function renderZiele(){
    var container = document.getElementById('goalGroups');
    container.innerHTML = '';
    TIERS.forEach(function(tier){
      var arr = state.ziele[tier.key];
      var doneCount = arr.filter(function(g){return g.done;}).length;

      var group = el('div','goal-group');
      var head = el('div','goal-group-head');
      head.appendChild(el('span', null, tier.label.toUpperCase()));
      head.appendChild(el('span','count', doneCount + '/' + arr.length));
      group.appendChild(head);

      var list = el('ul','list');
      arr.forEach(function(g, idx){
        var li = el('li','item' + (g.done ? ' done' : ''));
        var check = el('div','check' + (g.done?' checked':''), g.done ? '✓' : '');
        check.onclick = function(){ g.done = !g.done; save(); renderAll(); };
        li.appendChild(check);
        li.appendChild(el('div','item-label', g.label));
        var del = el('div','del','×');
        del.onclick = function(){ arr.splice(idx,1); save(); renderAll(); };
        li.appendChild(del);
        list.appendChild(li);
      });
      group.appendChild(list);

      var progOuter = el('div','progress-outer');
      var progInner = el('div','progress-inner');
      progInner.style.width = pct(doneCount, arr.length) + '%';
      progOuter.appendChild(progInner);
      group.appendChild(progOuter);

      var addRow = el('div','add-row small');
      var input = el('input');
      input.placeholder = 'Neues ' + tier.label + 'sziel...';
      var btn = el('button', null, '+');
      function addGoal(){
        var val = input.value.trim();
        if(!val) return;
        arr.push({id:uid(), label:val, done:false});
        input.value = '';
        save(); renderAll();
      }
      btn.onclick = addGoal;
      input.addEventListener('keydown', function(e){ if(e.key==='Enter') addGoal(); });
      addRow.appendChild(input);
      addRow.appendChild(btn);
      group.appendChild(addRow);

      container.appendChild(group);
    });
  }

  /* ---------- habits ---------- */
  function last21Days(){
    var days = [];
    for(var i=20;i>=0;i--) days.push(keyOffset(todayKey(), -i));
    return days;
  }

  function renderHabits(){
    var list = document.getElementById('habitsList');
    list.innerHTML = '';
    var tKey = todayKey();
    var doneToday = 0;
    state.habits.forEach(function(h, idx){
      var doneT = !!h.history[tKey];
      if(doneT) doneToday++;

      var item = el('div','habit-item');
      var top = el('div','habit-top');
      var check = el('div','check' + (doneT?' checked':''), doneT ? '✓' : '');
      check.onclick = function(){ h.history[tKey] = !h.history[tKey]; if(!h.history[tKey]) delete h.history[tKey]; save(); renderAll(); };
      top.appendChild(check);
      top.appendChild(el('span','icon', h.icon));
      var meta = el('div','habit-meta');
      meta.appendChild(el('div','item-label', h.label));
      if(h.sub) meta.appendChild(el('div','habit-sub', h.sub));
      if(h.mode === 'weekly'){
        var wc = weekCount(h, tKey);
        meta.appendChild(el('div','streak', wc + '/' + (h.target||1) + ' diese Woche'));
      } else {
        meta.appendChild(el('div','streak', streakAsOf(h.history, h.history[tKey] ? tKey : keyOffset(tKey,-1)) + 'd streak'));
      }
      top.appendChild(meta);
      var del = el('div','del','×');
      del.onclick = function(){ state.habits.splice(idx,1); save(); renderAll(); };
      top.appendChild(del);
      item.appendChild(top);

      var heat = el('div','heatmap');
      last21Days().forEach(function(dk){
        var cell = el('div','cell' + (h.history[dk] ? ' done':'') + (dk===tKey?' today':''));
        cell.title = dk;
        cell.onclick = function(){ h.history[dk] = !h.history[dk]; if(!h.history[dk]) delete h.history[dk]; save(); renderAll(); };
        heat.appendChild(cell);
      });
      item.appendChild(heat);

      list.appendChild(item);
    });
    document.getElementById('habitsTag').textContent = doneToday + '/' + state.habits.length + ' ERLEDIGT';
  }

  /* ---------- dayplan ---------- */
  function renderDayplan(){
    var tKey = todayKey();
    var blocks = state.dayplan[tKey] || [];
    blocks.sort(function(a,b){ return (a.time||'').localeCompare(b.time||''); });
    var list = document.getElementById('dayplanList');
    list.innerHTML = '';
    var now = new Date();
    var nowStr = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
    var done = 0;
    blocks.forEach(function(b, idx){
      if(b.done) done++;
      var overdue = !b.done && b.time && b.time < nowStr;
      var li = el('li','item' + (b.done?' done':'') + (overdue?' overdue':''));
      var check = el('div','check' + (b.done?' checked':''), b.done ? '✓' : '');
      check.onclick = function(){ b.done = !b.done; save(); renderAll(); };
      li.appendChild(check);
      li.appendChild(el('span','plan-time', b.time || '—'));
      li.appendChild(el('div','item-label', b.label));
      if(overdue) li.appendChild(el('span','streak','ÜBERFÄLLIG'));
      var del = el('div','del','×');
      del.onclick = function(){ blocks.splice(idx,1); save(); renderAll(); };
      li.appendChild(del);
      list.appendChild(li);
    });
    if(!blocks.length){
      var empty = el('li','item');
      empty.appendChild(el('div','item-label','Noch keine Blöcke geplant — plane deinen Tag.'));
      empty.style.opacity = .5;
      list.appendChild(empty);
    }
    document.getElementById('dayplanTag').textContent = done + '/' + blocks.length + ' BLÖCKE';
  }

  function addPlanBlock(time, label){
    var tKey = todayKey();
    if(!state.dayplan[tKey]) state.dayplan[tKey] = [];
    state.dayplan[tKey].push({id:uid(), time:time, label:label, done:false});
    save(); renderAll();
  }

  /* ---------- weekplan ---------- */
  function renderWeekplan(){
    var base = new Date();
    base.setDate(base.getDate() + weekOffset*7);
    var monKey = mondayKeyOf(base);
    var kw = isoWeek(parseKey(monKey));
    var sunKey = keyOffset(monKey, 6);
    document.getElementById('weekLabel').textContent = 'KW ' + kw + ' · ' + fmtShort(monKey) + ' – ' + fmtShort(sunKey);

    var focusInput = document.getElementById('weekFocusInput');
    if(document.activeElement !== focusInput) focusInput.value = state.weekFocus[monKey] || '';
    focusInput.dataset.week = monKey;

    var board = document.getElementById('weekBoard');
    board.innerHTML = '';
    var tKey = todayKey();
    for(var i=0;i<7;i++){
      (function(i){
        var dk = keyOffset(monKey, i);
        var col = el('div','week-day' + (dk===tKey?' today':''));
        var head = el('div','week-day-head');
        head.appendChild(el('span', null, WEEKDAYS[i].toUpperCase()));
        head.appendChild(el('span', null, fmtShort(dk)));
        col.appendChild(head);

        var items = state.weekplan[dk] || [];
        var ul = el('ul');
        items.forEach(function(it, idx){
          var li = el('li','week-item' + (it.done?' done':''));
          var check = el('div','check' + (it.done?' checked':''), it.done ? '✓' : '');
          check.onclick = function(){ it.done = !it.done; save(); renderWeekplan(); };
          li.appendChild(check);
          li.appendChild(el('div','wlabel', it.label));
          var del = el('div','del','×');
          del.onclick = function(){ items.splice(idx,1); save(); renderWeekplan(); };
          li.appendChild(del);
          ul.appendChild(li);
        });
        col.appendChild(ul);

        var addWrap = el('div','week-add');
        var input = el('input');
        input.placeholder = '+ Eintrag';
        input.addEventListener('keydown', function(e){
          if(e.key === 'Enter'){
            var val = input.value.trim();
            if(!val) return;
            if(!state.weekplan[dk]) state.weekplan[dk] = [];
            state.weekplan[dk].push({id:uid(), label:val, done:false});
            save(); renderWeekplan();
          }
        });
        addWrap.appendChild(input);
        col.appendChild(addWrap);
        board.appendChild(col);
      })(i);
    }
  }

  /* ---------- reflexion ---------- */
  function reflToday(){
    var tKey = todayKey();
    if(!state.reflections[tKey]) state.reflections[tKey] = {mood:null, good:'', improve:'', grateful:''};
    return state.reflections[tKey];
  }
  function reflHasContent(r){
    return !!(r && ((r.mood !== null && r.mood !== undefined) || (r.good&&r.good.trim()) || (r.improve&&r.improve.trim()) || (r.grateful&&r.grateful.trim())));
  }

  function renderReflexion(){
    var r = reflToday();
    var moodRow = document.getElementById('moodRow');
    moodRow.innerHTML = '';
    MOODS.forEach(function(m, i){
      var b = el('button','mood-btn' + (r.mood === i ? ' selected':''), m);
      b.onclick = function(){ r.mood = (r.mood === i) ? null : i; save(); renderAll(); };
      moodRow.appendChild(b);
    });
    var g = document.getElementById('reflGood');
    var im = document.getElementById('reflImprove');
    var gr = document.getElementById('reflGrateful');
    if(document.activeElement !== g) g.value = r.good || '';
    if(document.activeElement !== im) im.value = r.improve || '';
    if(document.activeElement !== gr) gr.value = r.grateful || '';
    updateReflStatus();

    var hist = document.getElementById('reflHistory');
    hist.innerHTML = '';
    var keys = Object.keys(state.reflections).filter(function(k){ return reflHasContent(state.reflections[k]); }).sort().reverse();
    document.getElementById('reflHistTag').textContent = keys.length + ' EINTRÄGE';
    keys.slice(0, 14).forEach(function(k){
      var e = state.reflections[k];
      var li = el('li','refl-hist-item');
      var head = el('div','refl-hist-head');
      head.appendChild(el('span', null, fmtShort(k) + (k === todayKey() ? ' · HEUTE' : '')));
      head.appendChild(el('span', null, (e.mood !== null && e.mood !== undefined) ? MOODS[e.mood] : ''));
      li.appendChild(head);
      var body = el('div','refl-hist-body');
      var lines = [];
      if(e.good && e.good.trim()) lines.push('✓ ' + e.good.trim());
      if(e.improve && e.improve.trim()) lines.push('↗ ' + e.improve.trim());
      if(e.grateful && e.grateful.trim()) lines.push('♥ ' + e.grateful.trim());
      body.textContent = lines.join('\n');
      li.appendChild(body);
      hist.appendChild(li);
    });
  }

  function updateReflStatus(){
    var r = state.reflections[todayKey()];
    var tag = document.getElementById('reflStatus');
    if(reflHasContent(r)){
      tag.textContent = 'GESPEICHERT ✓ · +2 PKT BEI ABRECHNUNG';
      tag.style.color = 'var(--green)';
    } else {
      tag.textContent = 'NOCH LEER · −3 PKT DROHEN';
      tag.style.color = 'var(--red)';
    }
  }

  /* ---------- todos ---------- */
  function todoItem(item, arrRef, idx){
    var li = el('li', 'item' + (item.done ? ' done' : ''));
    var check = el('div', 'check' + (item.done ? ' checked' : ''), item.done ? '✓' : '');
    check.onclick = function(){ item.done = !item.done; save(); renderAll(); };
    li.appendChild(check);
    li.appendChild(el('div', 'item-label', item.label));
    var del = el('div', 'del', '×');
    del.onclick = function(){ arrRef.splice(idx,1); save(); renderAll(); };
    li.appendChild(del);
    return li;
  }

  function renderTodos(){
    var mapping = [['todoHigh', state.todos.high], ['todoMed', state.todos.med], ['todoLow', state.todos.low]];
    var doneCount = 0, total = 0;
    mapping.forEach(function(pair){
      var container = document.getElementById(pair[0]);
      container.innerHTML = '';
      pair[1].forEach(function(item, idx){
        container.appendChild(todoItem(item, pair[1], idx));
        total++;
        if(item.done) doneCount++;
      });
    });
    document.getElementById('todosTag').textContent = doneCount + '/' + total + ' ERLEDIGT';
  }

  /* ---------- fitness ---------- */
  function trainingHabit(){
    var found = null;
    state.habits.forEach(function(h){ if(h.mode === 'weekly' && !found) found = h; });
    return found;
  }

  function renderFitness(){
    var f = state.fitness;
    var th = trainingHabit();
    var wEl = document.getElementById('statWorkouts');
    if(th){
      wEl.textContent = weekCount(th, todayKey()) + '/' + (th.target||1);
    } else {
      wEl.textContent = '—';
    }

    var weightInput = document.getElementById('statWeight');
    if(document.activeElement !== weightInput) weightInput.value = f.weight.toFixed(1);

    var START = 67.0, GOAL = 72.0;
    var wp = Math.max(0, Math.min(100, Math.round(((f.weight - START) / (GOAL - START)) * 100)));
    document.getElementById('weightBar').style.width = wp + '%';
    document.getElementById('weightGoalLabel').textContent = f.weight.toFixed(1) + ' kg → ' + GOAL.toFixed(0) + ' kg · noch ' + Math.max(0, GOAL - f.weight).toFixed(1) + ' kg';
  }

  /* ---------- routinen (morgen / abend) ---------- */
  function routineNumberItem(label, value, unit, onChange){
    var li = el('li','item' + (hasVal(value) ? ' done' : ''));
    var check = el('div','check' + (hasVal(value) ? ' checked' : ''), hasVal(value) ? '✓' : '');
    li.appendChild(check);
    li.appendChild(el('div','item-label', label));
    var input = el('input','routine-num');
    input.type = 'number'; input.step = '0.1'; input.placeholder = '—';
    if(hasVal(value)) input.value = value;
    input.addEventListener('change', function(){
      var v = parseFloat(input.value);
      onChange(isNaN(v) ? null : v);
      save(); renderAll();
    });
    li.appendChild(input);
    li.appendChild(el('span','streak', unit));
    return li;
  }
  function routineCheckItem(label, done, onToggle, hint){
    var li = el('li','item' + (done ? ' done' : ''));
    var check = el('div','check' + (done ? ' checked' : ''), done ? '✓' : '');
    if(onToggle){ check.onclick = function(){ onToggle(); save(); renderAll(); }; }
    li.appendChild(check);
    li.appendChild(el('div','item-label', label));
    if(hint) li.appendChild(el('span','streak', hint));
    return li;
  }

  function renderRoutines(){
    var tKey = todayKey();
    var r = routineFor(tKey);
    var items = routineItems(tKey);
    var done = items.filter(function(it){ return it.done; }).length;
    document.getElementById('routineTag').textContent = done + '/' + items.length + ' ERLEDIGT';

    var focused = document.activeElement && document.activeElement.classList
      && document.activeElement.classList.contains('routine-num');
    if(focused) return; /* nicht neu bauen während getippt wird */

    var morning = document.getElementById('morningRoutine');
    morning.innerHTML = '';
    morning.appendChild(routineNumberItem('Schlaf letzte Nacht', r.sleep, 'h', function(v){ r.sleep = v; }));
    morning.appendChild(routineCheckItem('Tag geplant', (state.dayplan[tKey]||[]).length > 0, null, 'AUTO'));
    morning.appendChild(routineCheckItem('Kein Handy erste 30 min', !!r.noPhone, function(){ r.noPhone = !r.noPhone; }));

    var evening = document.getElementById('eveningRoutine');
    evening.innerHTML = '';
    evening.appendChild(routineNumberItem('Screen Time heute', r.screen, 'h', function(v){ r.screen = v; }));
    var refl = state.reflections[tKey];
    evening.appendChild(routineCheckItem('Reflexion geschrieben', reflHasContent(refl), function(){ switchView('reflexion'); }, 'AUTO'));
  }

  /* ---------- bewerbungen ---------- */
  function bewAppsThisWeek(){
    var monKey = mondayKeyOf(new Date());
    var sunKey = keyOffset(monKey, 6);
    return state.bewerbungen.filter(function(b){
      return b.date && b.date >= monKey && b.date <= sunKey;
    }).length;
  }

  function renderBewerbungen(){
    var stats = document.getElementById('bewStats');
    stats.innerHTML = '';
    var total = state.bewerbungen.length;
    var active = state.bewerbungen.filter(function(b){ return b.status !== 'absage'; }).length;
    var interviews = state.bewerbungen.filter(function(b){ return b.status === 'interview' || b.status === 'angebot'; }).length;
    var thisWeek = bewAppsThisWeek();
    [
      {label:'GESAMT', val:total, cls:''},
      {label:'AKTIV', val:active, cls:'cyan'},
      {label:'INTERVIEWS+', val:interviews, cls:'amber'},
      {label:'DIESE WOCHE', val:thisWeek, cls:'green'}
    ].forEach(function(s){
      var d = el('div','bew-stat');
      d.appendChild(el('div','label', s.label));
      d.appendChild(el('div','value ' + s.cls, String(s.val)));
      stats.appendChild(d);
    });

    var body = document.getElementById('bewBody');
    body.innerHTML = '';
    state.bewerbungen.forEach(function(b, idx){
      var tr = el('tr');

      var tdF = el('td','firma', b.firma);
      tr.appendChild(tdF);

      var tdR = el('td');
      var inR = el('input'); inR.value = b.rolle || '';
      inR.addEventListener('change', function(){ b.rolle = inR.value; save(); });
      tdR.appendChild(inR);
      tr.appendChild(tdR);

      var tdS = el('td');
      var sel = el('select','st-' + b.status);
      BEW_STATUS.forEach(function(st){
        var o = el('option', null, st.label);
        o.value = st.key;
        if(st.key === b.status) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', function(){
        var newStatus = sel.value;
        b.status = newStatus;
        if(!b.awarded) b.awarded = {};
        if(BEW_AWARDS[newStatus] && !b.awarded[newStatus]){
          b.awarded[newStatus] = true;
          var lbl = newStatus === 'beworben' ? '📨 Bewerbung versendet: ' :
                    newStatus === 'interview' ? '🎙 Interview erreicht: ' : '🏆 Angebot erhalten: ';
          addLedger(lbl + b.firma, BEW_AWARDS[newStatus]);
        }
        if(newStatus === 'beworben' && !b.date) b.date = todayKey();
        save(); renderAll();
      });
      tdS.appendChild(sel);
      tr.appendChild(tdS);

      var tdD = el('td');
      var inD = el('input'); inD.type = 'date'; inD.value = b.date || ''; inD.style.colorScheme = 'dark';
      inD.addEventListener('change', function(){ b.date = inD.value; save(); renderBewerbungen(); });
      tdD.appendChild(inD);
      tr.appendChild(tdD);

      var tdN = el('td');
      var inN = el('input'); inN.value = b.next || ''; inN.placeholder = '—';
      inN.addEventListener('change', function(){ b.next = inN.value; save(); });
      tdN.appendChild(inN);
      tr.appendChild(tdN);

      var tdNo = el('td');
      var inNo = el('input'); inNo.value = b.notes || ''; inNo.placeholder = '—';
      inNo.addEventListener('change', function(){ b.notes = inNo.value; save(); });
      tdNo.appendChild(inNo);
      tr.appendChild(tdNo);

      var tdDel = el('td','del','×');
      tdDel.onclick = function(){ state.bewerbungen.splice(idx,1); save(); renderAll(); };
      tr.appendChild(tdDel);

      body.appendChild(tr);
    });
  }

  /* ---------- rank view ---------- */
  function renderRang(){
    var points = totalPoints();
    var r = rankFor(points);

    document.getElementById('rankName').textContent = r.current.name;
    document.getElementById('rankInsignia').textContent = r.current.ins;
    document.getElementById('rankPoints').textContent = points;
    document.getElementById('rankBar').style.width = r.progress + '%';
    document.getElementById('rankNext').textContent = r.next
      ? 'Nächster Rang: ' + r.next.name.toUpperCase() + ' ab ' + r.next.min + ' PKT'
      : 'HÖCHSTER RANG ERREICHT';

    var ladder = document.getElementById('rankLadder');
    ladder.innerHTML = '';
    RANKS.forEach(function(rk){
      var cls = 'rank-step';
      if(Math.max(0,points) >= rk.min) cls += ' reached';
      if(rk.name === r.current.name) cls += ' current';
      var step = el('div', cls);
      step.appendChild(el('span', null, rk.ins + '  ' + rk.name.toUpperCase()));
      step.appendChild(el('span', null, rk.min + ' PKT'));
      ladder.appendChild(step);
    });

    var prog = computeDaySettlement(todayKey());
    renderPrognose(document.getElementById('rangPrognose'), prog);

    var streakList = document.getElementById('streakList');
    streakList.innerHTML = '';
    var tKey = todayKey();
    state.habits.forEach(function(h){
      var li = el('li','streak-item');
      li.appendChild(el('span','icon', h.icon));
      li.appendChild(el('div','slabel', h.label));
      if(h.mode === 'weekly'){
        li.appendChild(el('span','scount', weekCount(h, tKey) + '/' + (h.target||1) + ' 🎯'));
        li.appendChild(el('span','sbest', 'Wochenziel'));
      } else {
        var cur = streakAsOf(h.history, h.history[tKey] ? tKey : keyOffset(tKey,-1));
        li.appendChild(el('span','scount', cur + 'd 🔥'));
        li.appendChild(el('span','sbest', 'best ' + bestStreak(h.history) + 'd'));
      }
      streakList.appendChild(li);
    });

    var ledgerList = document.getElementById('ledgerList');
    ledgerList.innerHTML = '';
    var entries = state.ledger.slice().reverse().slice(0, 40);
    document.getElementById('ledgerTag').textContent = state.ledger.length + ' EINTRÄGE';
    if(!entries.length){
      var li = el('li','ledger-item');
      li.appendChild(el('span','llabel','Noch keine Einträge — die erste Tagesabrechnung läuft heute um Mitternacht.'));
      ledgerList.appendChild(li);
    }
    entries.forEach(function(e){
      var li = el('li','ledger-item');
      li.appendChild(el('span','ldate', fmtShort(e.date)));
      var lbl = el('span','llabel', e.label);
      if(e.detail) lbl.appendChild(el('span','detail', e.detail));
      li.appendChild(lbl);
      li.appendChild(el('span','ldelta ' + (e.delta >= 0 ? 'plus' : 'minus'), (e.delta >= 0 ? '+' : '') + e.delta));
      ledgerList.appendChild(li);
    });
  }

  function renderPrognose(node, prog){
    node.innerHTML = '';
    node.appendChild(document.createTextNode('Heute bisher: '));
    var b = el('b', prog.delta >= 0 ? 'plus' : 'minus', (prog.delta >= 0 ? '+' : '') + prog.delta + ' PKT');
    node.appendChild(b);
    node.appendChild(document.createTextNode(' · Habits ' + prog.habitsDone + '/' + prog.habitsTotal
      + ' · Plan ' + prog.planDone + '/' + prog.planTotal
      + ' · Routine ' + prog.routineDone + '/' + prog.routineTotal
      + ' · Reflexion ' + (prog.reflected ? '✓' : '✗')));
  }

  function renderHeader(){
    var points = totalPoints();
    var r = rankFor(points);
    var badge = document.getElementById('pointsBadge');
    badge.textContent = '⬢ ' + points + ' PKT · ' + r.current.name.toUpperCase();
    badge.classList.toggle('negative', points < 0);
  }

  /* ---------- home ---------- */
  function renderHome(){
    var points = totalPoints();
    var r = rankFor(points);
    document.getElementById('homeRankName').textContent = r.current.name;
    document.getElementById('homeRankPoints').textContent = points;
    document.getElementById('homeRankBar').style.width = r.progress + '%';
    document.getElementById('homeRankNext').textContent = r.next
      ? 'Nächster Rang: ' + r.next.name.toUpperCase() + ' ab ' + r.next.min + ' PKT'
      : 'HÖCHSTER RANG ERREICHT';
    document.getElementById('homeRankTag').textContent = 'RANG ' + (RANKS.indexOf(r.current)+1) + '/' + RANKS.length;
    var prog = computeDaySettlement(todayKey());
    renderPrognose(document.getElementById('homePrognose'), prog);

    document.getElementById('snapDate').textContent = new Date().toLocaleDateString('de-DE', {weekday:'long', day:'2-digit', month:'long'}).toUpperCase();
    var snap = document.getElementById('snapList');
    snap.innerHTML = '';
    var tKey = todayKey();

    var habitsLeft = prog.habitsTotal - prog.habitsDone;
    addSnap(snap, '🧠', 'Habits offen', habitsLeft === 0 ? 'Alle erledigt ✓' : habitsLeft + ' offen', habitsLeft === 0 ? 'good' : 'warn');

    addSnap(snap, '🌅', 'Routine', prog.routineDone + '/' + prog.routineTotal, prog.routineDone === prog.routineTotal ? 'good' : 'warn');

    var blocks = (state.dayplan[tKey] || []).filter(function(b){ return !b.done; }).sort(function(a,b){ return (a.time||'').localeCompare(b.time||''); });
    addSnap(snap, '📅', 'Nächster Block', blocks.length ? (blocks[0].time + ' ' + blocks[0].label) : 'Keiner offen', blocks.length ? '' : 'good');

    addSnap(snap, '📝', 'Reflexion', prog.reflected ? 'Geschrieben ✓' : 'Noch offen (−3)', prog.reflected ? 'good' : 'bad');

    var openTodos = 0;
    ['high','med','low'].forEach(function(k){ state.todos[k].forEach(function(t){ if(!t.done) openTodos++; }); });
    addSnap(snap, '☑', 'To-Dos offen', String(openTodos), openTodos === 0 ? 'good' : '');

    var sessions = state.focus[tKey] || 0;
    addSnap(snap, '⏱', 'Focus Sessions', String(sessions), sessions > 0 ? 'good' : '');

    var dayIdx = Math.floor(parseKey(tKey).getTime() / 86400000);
    document.getElementById('dailyQuote').textContent = '«' + QUOTES[dayIdx % QUOTES.length] + '»';

    var bs = document.getElementById('homeBewStat');
    bs.innerHTML = '';
    var active = state.bewerbungen.filter(function(b){ return b.status !== 'absage'; }).length;
    bs.appendChild(document.createTextNode('Bewerbungen aktiv: '));
    bs.appendChild(el('b', null, String(active)));
    bs.appendChild(document.createTextNode(' · diese Woche versendet: '));
    bs.appendChild(el('b', null, String(bewAppsThisWeek())));
  }

  function addSnap(container, ico, label, val, cls){
    var li = el('li');
    li.appendChild(el('span','s-ico', ico));
    li.appendChild(el('span','s-label', label));
    li.appendChild(el('span','s-val ' + (cls||''), val));
    container.appendChild(li);
  }

  /* ---------- nexus ---------- */
  function computeCategoryStats(){
    var zieleAgg = { done:0, total:0 };
    var perTier = {};
    TIERS.forEach(function(t){
      var arr = state.ziele[t.key];
      var d = arr.filter(function(g){return g.done;}).length;
      perTier[t.key] = {done:d, total:arr.length};
      zieleAgg.done += d; zieleAgg.total += arr.length;
    });
    var tKey = todayKey();
    var habitsDone = state.habits.filter(function(h){ return !!h.history[tKey]; }).length;
    var habitsTotal = state.habits.length;
    var todoDone=0, todoTotal=0;
    ['high','med','low'].forEach(function(k){
      state.todos[k].forEach(function(t){ todoTotal++; if(t.done) todoDone++; });
    });
    var th = trainingHabit();
    var weekWorkouts = th ? weekCount(th, tKey) : 0;
    var weekTarget = th ? (th.target||1) : 1;
    var fitnessPct = Math.min(100, Math.round((weekWorkouts/weekTarget)*100));
    var rItems = routineItems(tKey);
    var rDone = rItems.filter(function(it){ return it.done; }).length;
    var routinePct = pct(rDone, rItems.length);
    var appsWeek = bewAppsThisWeek();
    var bewPct = Math.min(100, Math.round((appsWeek/2)*100));

    return {
      ziele: { pct: pct(zieleAgg.done, zieleAgg.total), done:zieleAgg.done, total:zieleAgg.total, perTier: perTier },
      habits: { pct: pct(habitsDone, habitsTotal), done:habitsDone, total:habitsTotal },
      todos: { pct: pct(todoDone, todoTotal), done:todoDone, total:todoTotal, open: todoTotal-todoDone },
      fitness: { pct: fitnessPct, week: weekWorkouts, target: weekTarget },
      routines: { pct: routinePct, done: rDone, total: rItems.length },
      bewerbungen: { pct: bewPct, week: appsWeek }
    };
  }

  function renderLegend(stats){
    document.getElementById('legendHabitsBar').style.width = stats.habits.pct+'%';
    document.getElementById('legendHabitsVal').textContent = stats.habits.done+'/'+stats.habits.total;
    document.getElementById('legendZieleBar').style.width = stats.ziele.pct+'%';
    document.getElementById('legendZieleVal').textContent = stats.ziele.done+'/'+stats.ziele.total;
    document.getElementById('legendTodosBar').style.width = stats.todos.pct+'%';
    document.getElementById('legendTodosVal').textContent = stats.todos.done+'/'+stats.todos.total;
  }

  function buildNexus(stats, overall){
    var svg = document.getElementById('nexusSvg');
    svg.innerHTML = '';
    var NS = 'http://www.w3.org/2000/svg';
    function svgEl(tag, attrs){
      var e = document.createElementNS(NS, tag);
      for(var k in attrs){ e.setAttribute(k, attrs[k]); }
      return e;
    }
    var cx=400, cy=230;

    var defs = svgEl('defs',{});
    var filter = svgEl('filter',{id:'glow', x:'-60%', y:'-60%', width:'220%', height:'220%'});
    filter.appendChild(svgEl('feGaussianBlur',{stdDeviation:'4', result:'blur'}));
    var merge = svgEl('feMerge',{});
    merge.appendChild(svgEl('feMergeNode',{'in':'blur'}));
    merge.appendChild(svgEl('feMergeNode',{'in':'SourceGraphic'}));
    filter.appendChild(merge);
    defs.appendChild(filter);
    svg.appendChild(defs);

    var starsGroup = svgEl('g',{});
    for(var i=0;i<45;i++){
      var sx = (Math.random()*800).toFixed(1), sy = (Math.random()*460).toFixed(1);
      var r = (Math.random()*1.2+0.4).toFixed(2);
      var star = svgEl('circle',{cx:sx, cy:sy, r:r, class:'star'});
      star.style.animationDelay = (Math.random()*4).toFixed(2)+'s';
      starsGroup.appendChild(star);
    }
    svg.appendChild(starsGroup);

    var ringsGroup = svgEl('g',{class:'rings-group'});
    [90,150,190].forEach(function(r){
      ringsGroup.appendChild(svgEl('circle',{cx:cx, cy:cy, r:r, fill:'none', stroke:'#1b232c', 'stroke-width':'1', 'stroke-dasharray':'2 6'}));
    });
    svg.appendChild(ringsGroup);

    var categories = [
      {key:'ziele', label:'ZIELE', angle:-90, radius:150, color:'#3dffa0', pct: stats.ziele.pct, frac: stats.ziele.done+'/'+stats.ziele.total, target:'ziele',
        sub:[
          {label:'WOCHE', angle:-118, data:stats.ziele.perTier.woche},
          {label:'MONAT', angle:-90, data:stats.ziele.perTier.monat},
          {label:'JAHR', angle:-62, data:stats.ziele.perTier.jahr}
        ], subRadius:200},
      {key:'habits', label:'HABITS', angle:-30, radius:150, color:'#a98bff', pct:stats.habits.pct, frac: stats.habits.done+'/'+stats.habits.total, target:'heute'},
      {key:'todos', label:'TO-DOS', angle:30, radius:150, color:'#ffb648', pct:stats.todos.pct, frac: stats.todos.open+' offen', target:'heute'},
      {key:'bewerbungen', label:'BEWERBUNGEN', angle:90, radius:150, color:'#ff5c6a', pct:stats.bewerbungen.pct, frac: stats.bewerbungen.week+' diese Woche', target:'bewerbungen'},
      {key:'routines', label:'ROUTINEN', angle:150, radius:150, color:'#ff8fb0', pct:stats.routines.pct, frac: stats.routines.done+'/'+stats.routines.total+' heute', target:'heute'},
      {key:'fitness', label:'FITNESS', angle:210, radius:150, color:'#4fd8ff', pct:stats.fitness.pct, frac: stats.fitness.week+'/'+stats.fitness.target+' Workouts', target:'heute'}
    ];

    function pos(angleDeg, radius){
      var rad = angleDeg*Math.PI/180;
      return { x: cx + radius*Math.cos(rad), y: cy + radius*Math.sin(rad) };
    }

    svg.appendChild(svgEl('circle',{cx:cx, cy:cy, r:46, fill:'rgba(255,182,72,0.12)'}));
    svg.appendChild(svgEl('circle',{cx:cx, cy:cy, r:34, fill:'#ffb648', class:'orb-core', filter:'url(#glow)'}));
    var scoreText = svgEl('text',{x:cx, y:cy+7, 'text-anchor':'middle', 'font-size':'22', 'font-weight':'700', fill:'#0c0a06'});
    scoreText.textContent = overall;
    svg.appendChild(scoreText);
    var scoreLabel = svgEl('text',{x:cx, y:cy+44, 'text-anchor':'middle', 'font-size':'9', fill:'#5c6b78', 'letter-spacing':'2'});
    scoreLabel.textContent = 'SCORE';
    svg.appendChild(scoreLabel);

    categories.forEach(function(cat){
      var p = pos(cat.angle, cat.radius);
      svg.appendChild(svgEl('line',{x1:cx, y1:cy, x2:p.x.toFixed(1), y2:p.y.toFixed(1), stroke:cat.color, 'stroke-width':'1', 'stroke-dasharray':'3 6', class:'flow-line', opacity:'0.55'}));

      var g = svgEl('g',{class:'nexus-node'});
      g.addEventListener('click', function(){ switchView(cat.target); });
      g.appendChild(svgEl('circle',{cx:p.x.toFixed(1), cy:p.y.toFixed(1), r:20, fill:cat.color, filter:'url(#glow)'}));
      var pctText = svgEl('text',{x:p.x.toFixed(1), y:(p.y+4).toFixed(1), 'text-anchor':'middle', 'font-size':'10', 'font-weight':'700', fill:'#05070a'});
      pctText.textContent = cat.pct+'%';
      g.appendChild(pctText);
      var label = svgEl('text',{x:p.x.toFixed(1), y:(p.y+34).toFixed(1), 'text-anchor':'middle', 'font-size':'9', fill:'#cfe0e8', 'letter-spacing':'1'});
      label.textContent = cat.label;
      g.appendChild(label);
      var frac = svgEl('text',{x:p.x.toFixed(1), y:(p.y+46).toFixed(1), 'text-anchor':'middle', 'font-size':'8', fill:'#5c6b78'});
      frac.textContent = cat.frac;
      g.appendChild(frac);
      svg.appendChild(g);

      if(cat.sub){
        cat.sub.forEach(function(s){
          var sp = pos(s.angle, cat.subRadius || 200);
          svg.appendChild(svgEl('line',{x1:p.x.toFixed(1), y1:p.y.toFixed(1), x2:sp.x.toFixed(1), y2:sp.y.toFixed(1), stroke:cat.color, 'stroke-width':'1', 'stroke-dasharray':'2 4', opacity:'0.4'}));
          var sg = svgEl('g',{class:'nexus-node'});
          sg.addEventListener('click', function(){ switchView('ziele'); });
          sg.appendChild(svgEl('circle',{cx:sp.x.toFixed(1), cy:sp.y.toFixed(1), r:13, fill:cat.color}));
          var sLabel = svgEl('text',{x:sp.x.toFixed(1), y:(sp.y-18).toFixed(1), 'text-anchor':'middle', 'font-size':'7.5', fill:'#8fa3ad', 'letter-spacing':'1'});
          sLabel.textContent = s.label;
          sg.appendChild(sLabel);
          var sFrac = svgEl('text',{x:sp.x.toFixed(1), y:(sp.y+3).toFixed(1), 'text-anchor':'middle', 'font-size':'8', 'font-weight':'700', fill:'#05070a'});
          sFrac.textContent = s.data.done+'/'+s.data.total;
          sg.appendChild(sFrac);
          svg.appendChild(sg);
        });
      }
    });
  }

  function computeAndRenderNexus(){
    var stats = computeCategoryStats();
    var overall = Math.round((stats.ziele.pct+stats.habits.pct+stats.todos.pct+stats.fitness.pct+stats.routines.pct+stats.bewerbungen.pct)/6);
    renderLegend(stats);
    buildNexus(stats, overall);
  }

  /* ---------- focus timer ---------- */
  var FOCUS_SECONDS = 25*60;
  var timerRemaining = FOCUS_SECONDS;
  var timerInterval = null;

  function fmtTimer(s){ return pad2(Math.floor(s/60)) + ':' + pad2(s%60); }
  function renderTimer(){
    var d = document.getElementById('timerDisplay');
    d.textContent = fmtTimer(timerRemaining);
    d.classList.toggle('running', !!timerInterval);
    document.getElementById('focusTag').textContent = (state.focus[todayKey()] || 0) + ' SESSIONS HEUTE';
  }
  function timerTick(){
    timerRemaining--;
    if(timerRemaining <= 0){
      clearInterval(timerInterval); timerInterval = null;
      timerRemaining = FOCUS_SECONDS;
      var tKey = todayKey();
      state.focus[tKey] = (state.focus[tKey] || 0) + 1;
      addLedger('⏱ Focus Session abgeschlossen', 1);
      state.habits.forEach(function(h){
        if(h.link === 'focus' && !h.history[tKey]) h.history[tKey] = true;
      });
      save(); renderAll();
      return;
    }
    renderTimer();
  }

  /* ---------- render all ---------- */
  function renderAll(){
    renderGreeting();
    renderHeader();
    renderHome();
    renderZiele();
    renderHabits();
    renderDayplan();
    renderWeekplan();
    renderReflexion();
    renderTodos();
    renderFitness();
    renderRoutines();
    renderBewerbungen();
    renderRang();
    renderTimer();
    computeAndRenderNexus();
  }

  /* ---------- events ---------- */
  document.querySelectorAll('nav button').forEach(function(btn){
    btn.onclick = function(){ switchView(btn.dataset.view); };
  });

  document.getElementById('captureBtn').onclick = doCapture;
  document.getElementById('captureInput').addEventListener('keydown', function(e){ if(e.key==='Enter') doCapture(); });
  function doCapture(){
    var input = document.getElementById('captureInput');
    var val = input.value.trim();
    if(!val) return;
    var target = document.getElementById('captureTarget').value;
    if(target === 'plan'){
      var m = val.match(/^(\d{1,2}[:.]\d{2})\s+(.+)$/);
      if(m) addPlanBlock(m[1].replace('.',':').padStart(5,'0'), m[2]);
      else addPlanBlock('', val);
    }
    else if(target === 'habit') state.habits.push({id:uid(), label:val, icon:'⭐', history:{}, mode:'daily', createdAt: todayKey()});
    else if(target === 'ziele-woche') state.ziele.woche.push({id:uid(), label:val, done:false});
    else if(target === 'ziele-monat') state.ziele.monat.push({id:uid(), label:val, done:false});
    else if(target === 'ziele-jahr') state.ziele.jahr.push({id:uid(), label:val, done:false});
    else if(target === 'todo-high') state.todos.high.push({id:uid(), label:val, done:false});
    else if(target === 'todo-med') state.todos.med.push({id:uid(), label:val, done:false});
    else if(target === 'todo-low') state.todos.low.push({id:uid(), label:val, done:false});
    input.value = '';
    save(); renderAll();
  }

  document.getElementById('habitAddBtn').onclick = addHabit;
  document.getElementById('habitInput').addEventListener('keydown', function(e){ if(e.key==='Enter') addHabit(); });
  function addHabit(){
    var input = document.getElementById('habitInput');
    var val = input.value.trim();
    if(!val) return;
    state.habits.push({id:uid(), label:val, icon:'⭐', history:{}, mode:'daily', createdAt: todayKey()});
    input.value = '';
    save(); renderAll();
  }

  document.getElementById('planAddBtn').onclick = addPlan;
  document.getElementById('planInput').addEventListener('keydown', function(e){ if(e.key==='Enter') addPlan(); });
  function addPlan(){
    var input = document.getElementById('planInput');
    var val = input.value.trim();
    if(!val) return;
    addPlanBlock(document.getElementById('planTime').value || '', val);
    input.value = '';
  }

  document.getElementById('todoAddBtn').onclick = addTodo;
  document.getElementById('todoInput').addEventListener('keydown', function(e){ if(e.key==='Enter') addTodo(); });
  function addTodo(){
    var input = document.getElementById('todoInput');
    var val = input.value.trim();
    if(!val) return;
    var prio = document.getElementById('todoPriority').value;
    var key = prio === 'high' ? 'high' : prio === 'low' ? 'low' : 'med';
    state.todos[key].push({id:uid(), label:val, done:false});
    input.value = '';
    save(); renderAll();
  }

  document.getElementById('bewAddBtn').onclick = addBew;
  document.getElementById('bewRolle').addEventListener('keydown', function(e){ if(e.key==='Enter') addBew(); });
  function addBew(){
    var firma = document.getElementById('bewFirma').value.trim();
    var rolle = document.getElementById('bewRolle').value.trim();
    if(!firma) return;
    state.bewerbungen.push({id:uid(), firma:firma, rolle:rolle, status:'entwurf', date:'', next:'', notes:'', awarded:{}});
    document.getElementById('bewFirma').value = '';
    document.getElementById('bewRolle').value = '';
    save(); renderAll();
  }

  document.getElementById('weekPrevBtn').onclick = function(){ weekOffset--; renderWeekplan(); };
  document.getElementById('weekNextBtn').onclick = function(){ weekOffset++; renderWeekplan(); };
  document.getElementById('weekFocusInput').addEventListener('input', function(e){
    state.weekFocus[e.target.dataset.week] = e.target.value;
    save();
  });

  ['reflGood','reflImprove','reflGrateful'].forEach(function(id){
    var field = id === 'reflGood' ? 'good' : id === 'reflImprove' ? 'improve' : 'grateful';
    document.getElementById(id).addEventListener('input', function(e){
      reflToday()[field] = e.target.value;
      save(); updateReflStatus();
    });
    document.getElementById(id).addEventListener('blur', function(){ renderAll(); });
  });

  document.getElementById('statWeight').addEventListener('change', function(e){
    var v = parseFloat(e.target.value);
    if(!isNaN(v)){ state.fitness.weight = v; save(); renderFitness(); computeAndRenderNexus(); }
  });

  document.getElementById('timerStartBtn').onclick = function(){
    if(timerInterval) return;
    timerInterval = setInterval(timerTick, 1000);
    renderTimer();
  };
  document.getElementById('timerPauseBtn').onclick = function(){
    if(timerInterval){ clearInterval(timerInterval); timerInterval = null; }
    renderTimer();
  };
  document.getElementById('timerResetBtn').onclick = function(){
    if(timerInterval){ clearInterval(timerInterval); timerInterval = null; }
    timerRemaining = FOCUS_SECONDS;
    renderTimer();
  };

  function tickClock(){
    var now = new Date();
    document.getElementById('clockTime').textContent = now.toLocaleTimeString('de-DE');
    document.getElementById('clockDate').textContent = now.toLocaleDateString('de-DE', {weekday:'short', day:'2-digit', month:'short'});
    if(todayKey() !== currentDay){
      currentDay = todayKey();
      settle();
      renderAll();
    }
  }
  tickClock();
  setInterval(tickClock, 1000);
  window.addEventListener('focus', function(){
    if(todayKey() !== currentDay){
      currentDay = todayKey();
      settle();
      renderAll();
    }
  });

  settle();
  save();
  renderAll();
})();
