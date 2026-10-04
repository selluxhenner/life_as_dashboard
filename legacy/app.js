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
    }, /* wird von migrateTodos in state.tasks umgewandelt */
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
    migrateTodos(s);
    if(!s.sync) s.sync = { cursor:0, dirty:{}, lastSync:0 };
    if(!s.gcal) s.gcal = { connected:false, pushed:{}, events:[], range:null, lastFetch:0 };
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

  /* 24.09.2026: To-dos als flache, synchronisierbare Liste statt drei Prioritäts-Arrays. */
  function migrateTodos(s){
    if(s.tasks) return;
    s.tasks = [];
    var now = Date.now();
    ['high','med','low'].forEach(function(prio){
      ((s.todos||{})[prio]||[]).forEach(function(t, i){
        s.tasks.push(makeTask({id:t.id, title:t.label, priority:prio, done:!!t.done, sort:now + i}));
      });
    });
    delete s.todos;
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
  function save(){ localStorage.setItem(STORE_KEY, JSON.stringify(state)); scheduleCal(); }

  /* Einmalig 24.09.2026: Minuspunkte abgeschafft. Alte Tagesabrechnungen mit den
     neuen Regeln neu berechnen, verpasste Wochenziele und Nullrunden entfernen. */
  function forgivePenalties(){
    if(state.meta.noPenalties20260924) return;
    state.meta.noPenalties20260924 = true;
    state.ledger = state.ledger.filter(function(e){
      if(e.label.indexOf('Tagesabrechnung') === 0) e.delta = computeDaySettlement(e.date).delta;
      return e.delta > 0;
    });
  }

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
      }
    });
    /* Nur Belohnungen: Verpasstes kostet nichts, ein Tag ohne App-Nutzung bleibt bei 0. */
    if(dailyTotal > 0 && dailyDone === dailyTotal) res.delta += 3;
    routineItems(dk).forEach(function(it){
      res.routineTotal++;
      if(it.done){ res.routineDone++; res.delta += 1; }
    });
    (state.dayplan[dk] || []).forEach(function(b){
      res.planTotal++;
      if(b.done){ res.planDone++; res.delta += 1; }
    });
    var r = state.reflections[dk];
    res.reflected = !!(r && (r.mood !== null && r.mood !== undefined || (r.good&&r.good.trim()) || (r.improve&&r.improve.trim()) || (r.grateful&&r.grateful.trim())));
    if(res.reflected) res.delta += 2;
    return res;
  }

  function settleDay(dk){
    var r = computeDaySettlement(dk);
    var detail = 'Habits ' + r.habitsDone + '/' + r.habitsTotal
      + ' · Plan ' + r.planDone + '/' + r.planTotal
      + ' · Routine ' + r.routineDone + '/' + r.routineTotal
      + ' · Reflexion ' + (r.reflected ? '✓' : '✗');
    if(r.delta > 0) addLedger('Tagesabrechnung ' + fmtShort(dk), r.delta, dk, detail);
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
    nexusSync();
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
    var events = calEventsOn(tKey);
    var ei = 0;
    function eventsUntil(time){
      while(ei < events.length && (time === null || events[ei].time <= time)) list.appendChild(calEventLi(events[ei++], 'item'));
    }
    blocks.forEach(function(b, idx){
      eventsUntil(b.time || '');
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
    eventsUntil(null);
    if(!blocks.length && !events.length){
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
    ensureCalRange(monKey);

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
        calEventsOn(dk).forEach(function(c){ ul.appendChild(calEventLi(c, 'week-item')); });
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
      tag.textContent = 'NOCH LEER · +2 PKT MÖGLICH';
      tag.style.color = 'var(--text-dim)';
    }
  }

  /* ---------- todos ---------- */
  /* Gleiche Feldnamen wie die API (backend/src/index.js), damit Sync 1:1 abbildet. */
  function makeTask(f){
    var now = Date.now();
    return {
      id: f.id || uid(), title: f.title, notes: f.notes || '', done: !!f.done,
      priority: f.priority || 'med', due: f.due || null, project: f.project || null,
      sort: f.sort || now, source: 'app', createdAt: now, updatedAt: now,
      completedAt: f.done ? now : null, deleted: false
    };
  }
  function liveTasks(){ return state.tasks.filter(function(t){ return !t.deleted; }); }
  function markDirty(t){
    t.updatedAt = Math.max(Date.now(), (t.updatedAt || 0) + 1);
    state.sync.dirty[t.id] = true;
    scheduleSync();
  }
  function addTask(title, priority){
    var t = makeTask({title:title, priority:priority});
    state.tasks.push(t);
    markDirty(t);
    return t;
  }
  function taskChanged(t){ markDirty(t); save(); renderAll(); }
  function todoItem(item){
    var li = el('li', 'item' + (item.done ? ' done' : ''));
    var check = el('div', 'check' + (item.done ? ' checked' : ''), item.done ? '✓' : '');
    check.onclick = function(){
      item.done = !item.done;
      item.completedAt = item.done ? Date.now() : null;
      taskChanged(item);
    };
    li.appendChild(check);
    li.appendChild(el('div', 'item-label', item.title));
    var del = el('div', 'del', '×');
    del.onclick = function(){ item.deleted = true; taskChanged(item); };
    li.appendChild(del);
    return li;
  }

  function renderTodos(){
    var mapping = [['todoHigh', 'high'], ['todoMed', 'med'], ['todoLow', 'low']];
    var doneCount = 0, total = 0;
    mapping.forEach(function(pair){
      var container = document.getElementById(pair[0]);
      container.innerHTML = '';
      liveTasks().filter(function(t){ return t.priority === pair[1]; }).forEach(function(item){
        container.appendChild(todoItem(item));
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

    if(state.gcal.connected){
      var nowHm = pad2(new Date().getHours()) + ':' + pad2(new Date().getMinutes());
      var nextEv = calEventsOn(tKey).filter(function(c){ return c.time && c.time >= nowHm; })[0];
      addSnap(snap, '🗓', 'Nächster Termin', nextEv ? nextEv.time + ' ' + nextEv.title : 'Keiner mehr heute', nextEv ? '' : 'good');
    }

    addSnap(snap, '📝', 'Reflexion', prog.reflected ? 'Geschrieben ✓' : 'Noch offen (+2)', prog.reflected ? 'good' : '');

    var openTodos = 0;
    liveTasks().forEach(function(t){ if(!t.done) openTodos++; });
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
    liveTasks().forEach(function(t){ todoTotal++; if(t.done) todoDone++; });
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

  /* 3D-Orbit auf Canvas: eigene Perspektivprojektion, keine Library (App muss offline laufen). */
  var NEXUS_CATS = [
    {key:'ziele',       label:'ZIELE',       color:'--green',  target:'ziele'},
    {key:'habits',      label:'HABITS',      color:'--purple', target:'heute'},
    {key:'todos',       label:'TO-DOS',      color:'--amber',  target:'heute'},
    {key:'bewerbungen', label:'BEWERBUNGEN', color:'--red',    target:'bewerbungen'},
    {key:'routines',    label:'ROUTINEN',    color:'--pink',   target:'heute'},
    {key:'fitness',     label:'FITNESS',     color:'--cyan',   target:'heute'}
  ];
  var nexus = {
    canvas:null, ctx:null, w:0, h:0, dpr:1,
    yaw:0.4, pitch:0.42, items:[], overall:0, hits:[], hot:-1,
    drag:null, running:false, last:0, moonT:0,
    reduced: !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  };

  function cssColor(name){ return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function hexRgb(hex){
    var h = hex.replace('#','');
    if(h.length === 3) h = h.split('').map(function(c){ return c+c; }).join('');
    var n = parseInt(h, 16);
    return [(n>>16)&255, (n>>8)&255, n&255];
  }
  function shade(rgb, amt){
    /* amt > 0 Richtung Weiss, < 0 Richtung Schwarz */
    return 'rgb(' + rgb.map(function(c){
      return Math.round(amt >= 0 ? c + (255-c)*amt : c*(1+amt));
    }).join(',') + ')';
  }
  function rgba(rgb, a){ return 'rgba(' + rgb.join(',') + ',' + a + ')'; }

  function nexusFrac(key, stats){
    if(key === 'ziele') return stats.ziele.done + '/' + stats.ziele.total;
    if(key === 'habits') return stats.habits.done + '/' + stats.habits.total;
    if(key === 'todos') return stats.todos.open + ' offen';
    if(key === 'bewerbungen') return stats.bewerbungen.week + '/Wo';
    if(key === 'routines') return stats.routines.done + '/' + stats.routines.total;
    return stats.fitness.week + '/' + stats.fitness.target;
  }

  function shortLabel(label){
    var first = label.split(/[/+·]/)[0].trim().toUpperCase();
    /* ganze Wörter behalten, solange es kurz bleibt: "Deep Work Block" -> "DEEP WORK" */
    var words = first.split(/\s+/), out = words[0];
    for(var i = 1; i < words.length && (out + ' ' + words[i]).length <= 11; i++) out += ' ' + words[i];
    return out.slice(0, 11);
  }

  /* Monde pro Planet: die Einzelteile, aus denen sich der Bereichs-Prozentwert zusammensetzt. */
  function nexusSubs(key, stats){
    var tKey = todayKey();
    function sub(label, frac, p){ return {label:label, frac:frac, pct:Math.max(0, Math.min(100, p))}; }
    if(key === 'ziele') return TIERS.map(function(t){
      var d = stats.ziele.perTier[t.key];
      return sub(t.label.toUpperCase(), d.done + '/' + d.total, pct(d.done, d.total));
    });
    if(key === 'habits') return state.habits.map(function(h){
      if(h.mode === 'weekly'){
        var c = weekCount(h, tKey), tg = h.target || 1;
        return sub(shortLabel(h.label), c + '/' + tg, Math.round(c / tg * 100));
      }
      return sub(shortLabel(h.label), h.history[tKey] ? '✓' : '—', h.history[tKey] ? 100 : 0);
    });
    if(key === 'todos') return [['high','HOCH'],['med','MITTEL'],['low','NIEDRIG']].map(function(p){
      var list = liveTasks().filter(function(t){ return t.priority === p[0]; });
      var done = list.filter(function(t){ return t.done; }).length;
      return sub(p[1], (list.length - done) + ' offen', pct(done, list.length));
    });
    if(key === 'bewerbungen'){
      var total = state.bewerbungen.length;
      return [['beworben','BEWORBEN'],['interview','INTERVIEW'],['angebot','ANGEBOT']].map(function(st){
        var n = state.bewerbungen.filter(function(b){ return b.status === st[0]; }).length;
        return sub(st[1], String(n), pct(n, total));
      });
    }
    if(key === 'routines') return routineItems(tKey).map(function(it){
      var names = {sleep:'SCHLAF', plan:'TAGESPLAN', noPhone:'KEIN HANDY', screen:'SCREEN'};
      return sub(names[it.key] || it.key.toUpperCase(), it.done ? '✓' : '—', it.done ? 100 : 0);
    });
    var START = 67.0, GOAL = 72.0, w = state.fitness.weight;
    return [
      sub('WORKOUTS', stats.fitness.week + '/' + stats.fitness.target, stats.fitness.pct),
      sub('GEWICHT', w.toFixed(1) + ' kg', Math.round((w - START) / (GOAL - START) * 100))
    ];
  }

  function renderNexusList(){
    var list = document.getElementById('nexusList');
    list.innerHTML = '';
    nexus.items.forEach(function(it, i){
      var li = el('li');
      var b = el('button', i === nexus.hot ? 'hot' : '');
      b.style.setProperty('--c', it.hex);
      b.appendChild(el('span','n-dot'));
      b.appendChild(el('span','n-label', it.label));
      b.appendChild(el('span','n-val', it.frac));
      var bar = el('span','n-bar'); var fill = el('i'); fill.style.width = it.pct + '%';
      bar.appendChild(fill); b.appendChild(bar);
      if(i === nexus.hot && it.subs.length){
        b.appendChild(el('span','n-subs', it.subs.map(function(sb){ return sb.label + ' ' + sb.frac; }).join(' · ')));
      }
      b.onclick = function(){ switchView(it.target); };
      b.onmouseenter = function(){ if(nexus.hot !== i){ nexus.hot = i; renderNexusList(); drawNexus(); } };
      b.onmouseleave = function(){ nexus.hot = -1; renderNexusList(); drawNexus(); };
      li.appendChild(b);
      list.appendChild(li);
    });
  }

  function nexusResize(){
    var c = nexus.canvas;
    nexus.dpr = window.devicePixelRatio || 1;
    nexus.w = c.clientWidth; nexus.h = c.clientHeight;
    c.width = Math.round(nexus.w * nexus.dpr);
    c.height = Math.round(nexus.h * nexus.dpr);
    nexus.ctx.setTransform(nexus.dpr, 0, 0, nexus.dpr, 0, 0);
  }

  function project(x, y, z){
    var cy = Math.cos(nexus.yaw), sy = Math.sin(nexus.yaw);
    var x1 = x*cy - z*sy, z1 = x*sy + z*cy;
    var cp = Math.cos(nexus.pitch), sp = Math.sin(nexus.pitch);
    var y2 = y*cp - z1*sp, z2 = y*sp + z1*cp;
    var D = 4.2, f = D / (D + z2);
    /* Ausdehnung nach oben/unten hängt von der Neigung ab — so skalieren und zentrieren,
       dass auch steil gekippt alles inkl. Beschriftung (32px) sichtbar bleibt. */
    var top = Math.max(1.06*sp, 0.8*sp + 0.27, 0.4);
    var bottom = 1.25*sp + 0.3;
    var scale = Math.min(nexus.w / 3.1, (nexus.h - 50) / (top + bottom));
    var slack = Math.max(0, (nexus.h - 50 - (top + bottom)*scale) / 2);
    return { x: nexus.w/2 + x1*f*scale, y: 6 + slack + top*scale + y2*f*scale, z: z2, f: f*scale };
  }

  function drawSphere(ctx, p, r, rgb, alpha){
    ctx.globalAlpha = alpha;
    var g = ctx.createRadialGradient(p.x - r*0.35, p.y - r*0.4, r*0.08, p.x, p.y, r);
    g.addColorStop(0, shade(rgb, 0.6));
    g.addColorStop(0.35, shade(rgb, 0.1));
    g.addColorStop(0.8, shade(rgb, -0.35));
    g.addColorStop(1, shade(rgb, -0.6));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI*2); ctx.fill();
    /* Rim-Light unten rechts für Volumen */
    ctx.strokeStyle = rgba(rgb, 0.35); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(p.x, p.y, r - 0.5, 0.1*Math.PI, 0.6*Math.PI); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawRing(ctx, radius, rgb, alpha, dash){
    var pts = [];
    for(var i=0;i<=72;i++){
      var a = i/72*Math.PI*2;
      pts.push(project(Math.cos(a)*radius, 0, Math.sin(a)*radius));
    }
    ctx.setLineDash(dash || []);
    ctx.lineWidth = 1;
    for(var j=0;j<72;j++){
      var p = pts[j], q = pts[j+1];
      ctx.strokeStyle = rgba(rgb, alpha * ((p.z + q.z) > 0 ? 0.45 : 1));
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  function drawNexus(){
    if(!nexus.ctx || !nexus.w) return;
    var ctx = nexus.ctx, t = performance.now() / 1000;
    ctx.clearRect(0, 0, nexus.w, nexus.h);
    var textRgb = hexRgb(cssColor('--text'));
    var dimRgb = hexRgb(cssColor('--text-dim'));
    var FLOOR = 0.42, ORBIT = 1.0;

    /* Bodenschatten unter dem System */
    var fc = project(0, FLOOR, 0);
    ctx.save();
    ctx.translate(fc.x, fc.y); ctx.scale(1, Math.sin(nexus.pitch));
    var fg = ctx.createRadialGradient(0, 0, 0, 0, 0, fc.f*1.15);
    fg.addColorStop(0, 'rgba(0,0,0,0.28)'); fg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(0, 0, fc.f*1.15, 0, Math.PI*2); ctx.fill();
    ctx.restore();

    drawRing(ctx, ORBIT, dimRgb, 0.5);
    drawRing(ctx, 1.32, dimRgb, 0.22, [2, 5]);

    /* Kugeln sammeln und nach Tiefe sortieren (hinten zuerst) */
    var n = nexus.items.length, bodies = [];
    nexus.items.forEach(function(it, i){
      var a = i / n * Math.PI * 2;
      var bob = nexus.reduced ? 0 : Math.sin(t*1.1 + i) * 0.04;
      var px = Math.cos(a)*ORBIT, pz = Math.sin(a)*ORBIT;
      var planet = {i:i, it:it, x:px, y:bob, z:pz, r:0.15};
      bodies.push(planet);
      /* Monde kreisen auf einer gekippten Bahn um den Planeten (radial + tangential + hoch) */
      var k = it.subs.length, MR = 0.3, INC = 0.85;
      it.subs.forEach(function(sb, j){
        var m = i*1.7 + j/k*Math.PI*2 + nexus.moonT*0.55;
        var lr = Math.cos(m)*MR, lt = Math.sin(m)*MR*Math.cos(INC), lu = Math.sin(m)*MR*Math.sin(INC);
        bodies.push({moon:true, i:i, sub:sb, planet:planet, r:0.052,
          x: px + Math.cos(a)*lr - Math.sin(a)*lt, y: bob - lu, z: pz + Math.sin(a)*lr + Math.cos(a)*lt});
      });
    });
    bodies.push({core:true, x:0, y:0, z:0, r:0.34});
    bodies.forEach(function(b){ b.p = project(b.x, b.y, b.z); });
    bodies.sort(function(a, b){ return b.p.z - a.p.z; });

    nexus.hits = [];
    var labels = [];
    bodies.forEach(function(b){
      var p = b.p, r = b.r * p.f;
      var depthA = Math.max(0.45, Math.min(1, 0.75 - p.z*0.3));
      /* Schatten auf dem Boden */
      var sp = project(b.x, FLOOR, b.z);
      ctx.save();
      ctx.translate(sp.x, sp.y); ctx.scale(1, Math.sin(nexus.pitch)*0.7);
      var sg = ctx.createRadialGradient(0, 0, 0, 0, 0, r*1.1);
      sg.addColorStop(0, 'rgba(0,0,0,' + (0.3*depthA).toFixed(3) + ')'); sg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(0, 0, r*1.1, 0, Math.PI*2); ctx.fill();
      ctx.restore();

      if(b.core){
        var amber = hexRgb(cssColor('--amber'));
        var pulse = nexus.reduced ? 0 : Math.sin(t*2.2) * 0.5 + 0.5;
        var halo = ctx.createRadialGradient(p.x, p.y, r*0.8, p.x, p.y, r*1.9);
        halo.addColorStop(0, rgba(amber, 0.18 + pulse*0.08)); halo.addColorStop(1, rgba(amber, 0));
        ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(p.x, p.y, r*1.9, 0, Math.PI*2); ctx.fill();
        drawSphere(ctx, p, r, amber, 1);
        ctx.fillStyle = '#1b1406';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = '700 ' + Math.round(r*0.62) + 'px "JetBrains Mono", monospace';
        ctx.fillText(String(nexus.overall), p.x, p.y - r*0.08);
        ctx.font = '500 ' + Math.max(7, Math.round(r*0.2)) + 'px "JetBrains Mono", monospace';
        ctx.fillStyle = 'rgba(27,20,6,0.7)';
        ctx.fillText('SCORE', p.x, p.y + r*0.42);
        return;
      }

      if(b.moon){
        var mit = nexus.items[b.i], mhot = b.i === nexus.hot, pp = b.planet.p;
        /* Ast zum Planeten */
        ctx.strokeStyle = rgba(mit.rgb, (mhot ? 0.6 : 0.3) * depthA); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(pp.x, pp.y); ctx.lineTo(p.x, p.y); ctx.stroke();
        /* unerledigte Monde grau eingefärbt, erledigte in voller Farbe */
        var mix = 0.3 + 0.7*b.sub.pct/100;
        var mrgb = mit.rgb.map(function(c, ci){ return Math.round(dimRgb[ci] + (c - dimRgb[ci])*mix); });
        drawSphere(ctx, p, mhot ? r*1.2 : r, mrgb, depthA * (0.55 + 0.45*mix));
        if(mhot) labels.push({text:b.sub.label + ' ' + b.sub.frac, x:p.x, y:p.y, from:pp, r:r*1.2, rgb:mrgb});
        nexus.hits.push({i:b.i, x:p.x, y:p.y, r:Math.max(8, r + 5), z:p.z});
        return;
      }

      var it = b.it, hot = b.i === nexus.hot;
      var rr = hot ? r*1.12 : r;
      drawSphere(ctx, p, rr, it.rgb, depthA);
      /* Fortschrittsring um die Kugel */
      ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.strokeStyle = rgba(textRgb, 0.1*depthA);
      ctx.beginPath(); ctx.arc(p.x, p.y, rr + 4, 0, Math.PI*2); ctx.stroke();
      if(it.pct > 0){
        ctx.strokeStyle = rgba(it.rgb, depthA);
        ctx.beginPath(); ctx.arc(p.x, p.y, rr + 4, -Math.PI/2, -Math.PI/2 + Math.PI*2*it.pct/100); ctx.stroke();
      }
      ctx.lineCap = 'butt';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.font = '500 9px "JetBrains Mono", monospace';
      ctx.fillStyle = rgba(hot ? textRgb : dimRgb, depthA);
      ctx.fillText(it.label, p.x, p.y + rr + 9);
      ctx.font = '700 10px "JetBrains Mono", monospace';
      ctx.fillStyle = rgba(textRgb, depthA);
      ctx.fillText(it.pct + '%', p.x, p.y + rr + 20);
      nexus.hits.push({i:b.i, x:p.x, y:p.y, r:rr + 8, z:p.z});
    });
    drawMoonLabels(ctx, labels, textRgb);
  }

  /* Mond-Beschriftungen zuletzt zeichnen (immer vorne), vom Planeten weg versetzt, auf dunklem Pill. */
  function drawMoonLabels(ctx, labels, textRgb){
    ctx.font = '500 9px "JetBrains Mono", monospace';
    ctx.textBaseline = 'middle';
    var panel = hexRgb(cssColor('--panel'));
    labels.forEach(function(l){
      var dx = l.x - l.from.x, dy = l.y - l.from.y, len = Math.hypot(dx, dy) || 1;
      var ux = dx/len, uy = dy/len;
      var tw = ctx.measureText(l.text).width, pw = tw + 12, ph = 16;
      var cx = l.x + ux*(l.r + 6 + pw/2*Math.abs(ux)), cy = l.y + uy*(l.r + 6 + ph/2*Math.abs(uy));
      cx = Math.max(pw/2 + 2, Math.min(nexus.w - pw/2 - 2, cx));
      cy = Math.max(ph/2 + 2, Math.min(nexus.h - ph/2 - 2, cy));
      ctx.fillStyle = rgba(panel, 0.88);
      ctx.strokeStyle = rgba(l.rgb, 0.7); ctx.lineWidth = 1;
      ctx.beginPath();
      if(ctx.roundRect) ctx.roundRect(cx - pw/2, cy - ph/2, pw, ph, 4); else ctx.rect(cx - pw/2, cy - ph/2, pw, ph);
      ctx.fill(); ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillStyle = rgba(textRgb, 0.95);
      ctx.fillText(l.text, cx, cy + 0.5);
    });
  }

  function nexusLoop(now){
    if(!nexus.running) return;
    var dt = nexus.last ? Math.min(0.05, (now - nexus.last) / 1000) : 0;
    nexus.last = now;
    if(!nexus.drag && nexus.hot === -1 && !nexus.reduced){ nexus.yaw += dt * 0.22; nexus.moonT += dt; }
    drawNexus();
    requestAnimationFrame(nexusLoop);
  }

  /* Nur animieren, solange HOME sichtbar ist — spart Akku auf dem Handy */
  function nexusSync(){
    var should = !document.hidden && document.getElementById('view-home').classList.contains('active');
    if(should && !nexus.running){
      nexus.running = true; nexus.last = 0;
      nexusResize();
      requestAnimationFrame(nexusLoop);
    } else if(!should){
      nexus.running = false;
    }
  }

  function nexusHit(e){
    var rect = nexus.canvas.getBoundingClientRect();
    var x = e.clientX - rect.left, y = e.clientY - rect.top, best = null;
    nexus.hits.forEach(function(h){
      if(Math.hypot(h.x - x, h.y - y) <= h.r && (!best || h.z < best.z)) best = h;
    });
    return best ? best.i : -1;
  }

  function initNexus(){
    var c = document.getElementById('nexusCanvas');
    nexus.canvas = c; nexus.ctx = c.getContext('2d');
    c.addEventListener('pointerdown', function(e){
      nexus.drag = {x:e.clientX, y:e.clientY, yaw:nexus.yaw, pitch:nexus.pitch, moved:false};
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', function(e){
      if(nexus.drag){
        var dx = e.clientX - nexus.drag.x, dy = e.clientY - nexus.drag.y;
        if(Math.abs(dx) + Math.abs(dy) > 4){ nexus.drag.moved = true; c.classList.add('dragging'); }
        nexus.yaw = nexus.drag.yaw - dx * 0.01;
        nexus.pitch = Math.max(0.15, Math.min(1.1, nexus.drag.pitch + dy * 0.006));
        if(!nexus.running) drawNexus();
        return;
      }
      var h = nexusHit(e);
      if(h !== nexus.hot){ nexus.hot = h; renderNexusList(); if(!nexus.running) drawNexus(); }
      c.classList.toggle('hovering', h !== -1);
    });
    c.addEventListener('pointerup', function(e){
      if(!nexus.drag) return;
      var wasClick = !nexus.drag.moved;
      nexus.drag = null; c.classList.remove('dragging');
      if(wasClick){
        var h = nexusHit(e);
        if(h !== -1) switchView(nexus.items[h].target);
      }
    });
    c.addEventListener('pointercancel', function(){ nexus.drag = null; c.classList.remove('dragging'); });
    c.addEventListener('pointerleave', function(){
      if(!nexus.drag && nexus.hot !== -1){ nexus.hot = -1; renderNexusList(); c.classList.remove('hovering'); }
    });
    window.addEventListener('resize', function(){ if(nexus.w){ nexusResize(); drawNexus(); } });
    document.addEventListener('visibilitychange', nexusSync);
  }

  function computeAndRenderNexus(){
    var stats = computeCategoryStats();
    nexus.overall = Math.round((stats.ziele.pct+stats.habits.pct+stats.todos.pct+stats.fitness.pct+stats.routines.pct+stats.bewerbungen.pct)/6);
    nexus.items = NEXUS_CATS.map(function(cat){
      var hex = cssColor(cat.color);
      return {key:cat.key, label:cat.label, target:cat.target, hex:hex, rgb:hexRgb(hex),
              pct:stats[cat.key].pct, frac:nexusFrac(cat.key, stats), subs:nexusSubs(cat.key, stats)};
    });
    renderNexusList();
    nexusSync();
    drawNexus();
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

  /* ---------- sync (To-dos <-> LIFE OS API) ---------- */
  /* Verbindung liegt getrennt vom State, damit das Token nicht in Exporten/Backups landet. */
  var SYNC_KEY = 'lifeOsSync';
  var SYNC_BATCH = 200;
  var TOMBSTONE_TTL = 30 * 86400000;
  var syncTimer = null, syncBusy = false;
  var syncStatus = {state:'off', msg:''};

  function syncConfig(){
    try{ var c = JSON.parse(localStorage.getItem(SYNC_KEY) || 'null'); return c && c.url && c.token ? c : null; }
    catch(e){ return null; }
  }
  function apiUrl(cfg, path){ return cfg.url.replace(/\/+$/, '') + path; }

  function apiFetch(cfg, path, body, method){
    var ctrl = new AbortController();
    var timeout = setTimeout(function(){ ctrl.abort(); }, 15000);
    return fetch(apiUrl(cfg, path), {
      method: method || (body ? 'POST' : 'GET'),
      headers: {'Authorization':'Bearer ' + cfg.token, 'Content-Type':'application/json'},
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal
    }).then(function(res){
      clearTimeout(timeout);
      if(res.status === 401) throw {kind:'auth'};
      if(!res.ok) return res.json().catch(function(){ return {}; }).then(function(j){ throw {kind:'server', msg:j.error || ('HTTP ' + res.status)}; });
      return res.json();
    }, function(){ clearTimeout(timeout); throw {kind:'offline'}; });
  }

  function scheduleSync(delay){
    if(!syncConfig()) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(runSync, delay === undefined ? 800 : delay);
  }

  /* Server-Stand einarbeiten. Lokal ungesyncte, neuere Änderungen gewinnen. */
  function mergeRemote(todos){
    var changed = false;
    var byId = {};
    state.tasks.forEach(function(t){ byId[t.id] = t; });
    todos.forEach(function(r){
      var local = byId[r.id];
      if(!local){
        if(!r.deleted){ state.tasks.push(r); changed = true; }
        return;
      }
      if(state.sync.dirty[r.id] && local.updatedAt > r.updatedAt) return;
      if(local.updatedAt !== r.updatedAt || local.deleted !== r.deleted){ changed = true; }
      Object.keys(r).forEach(function(k){ local[k] = r[k]; });
      delete state.sync.dirty[r.id];
    });
    var cutoff = Date.now() - TOMBSTONE_TTL;
    state.tasks = state.tasks.filter(function(t){
      return !(t.deleted && !state.sync.dirty[t.id] && t.updatedAt < cutoff);
    });
    return changed;
  }

  function runSync(){
    var cfg = syncConfig();
    if(!cfg) return Promise.resolve();
    if(syncBusy){ scheduleSync(1500); return Promise.resolve(); }
    syncBusy = true;
    setSyncStatus('busy');

    var ids = Object.keys(state.sync.dirty).slice(0, SYNC_BATCH);
    var sent = {};
    var upserts = [];
    ids.forEach(function(id){
      var t = state.tasks.filter(function(x){ return x.id === id; })[0];
      if(!t){ delete state.sync.dirty[id]; return; }
      sent[id] = t.updatedAt;
      upserts.push(JSON.parse(JSON.stringify(t)));
    });

    return apiFetch(cfg, '/api/sync', {since: state.sync.cursor, upserts: upserts}).then(function(res){
      /* Nur als sauber markieren, was seit dem Senden nicht erneut geändert wurde */
      Object.keys(sent).forEach(function(id){
        var t = state.tasks.filter(function(x){ return x.id === id; })[0];
        if(!t || t.updatedAt === sent[id]) delete state.sync.dirty[id];
      });
      var changed = mergeRemote(res.todos || []);
      state.sync.cursor = res.cursor;
      state.sync.lastSync = Date.now();
      save();
      syncBusy = false;
      setSyncStatus('ok');
      if(changed) renderAll();
      if(Object.keys(state.sync.dirty).length) scheduleSync(300);
    }).catch(function(err){
      syncBusy = false;
      if(err && err.kind === 'auth') setSyncStatus('auth');
      else if(err && err.kind === 'server') setSyncStatus('error', err.msg);
      else setSyncStatus('offline');
    });
  }

  function setSyncStatus(st, msg){
    syncStatus = {state:st, msg:msg || ''};
    renderSyncBadge();
  }

  function renderSyncBadge(){
    var badge = document.getElementById('syncBadge');
    var pending = Object.keys(state.sync.dirty).length;
    var st = syncConfig() ? syncStatus.state : 'off';
    var last = state.sync.lastSync ? new Date(state.sync.lastSync).toLocaleTimeString('de-DE', {hour:'2-digit', minute:'2-digit'}) : '—';
    var text = {
      off: 'SYNC AUS',
      busy: 'SYNC …',
      ok: 'SYNC ✓ ' + last,
      offline: 'OFFLINE' + (pending ? ' · ' + pending + ' OFFEN' : ''),
      auth: 'TOKEN UNGÜLTIG',
      error: 'SYNC FEHLER'
    }[st] || 'SYNC';
    badge.textContent = text;
    badge.className = 'sync-badge ' + st;
    badge.title = syncStatus.msg || (st === 'ok' ? 'Zuletzt synchronisiert ' + last : '');
    var info = document.getElementById('syncInfo');
    if(info){
      info.textContent = syncConfig()
        ? 'Status: ' + text + ' · ' + pending + ' lokale Änderung(en) ausstehend · ' + liveTasks().length + ' To-dos'
        : 'Nicht verbunden — To-dos bleiben nur auf diesem Gerät.';
    }
  }

  /* Erstverbindung: erst den Server-Stand holen, dann nur lokale To-dos hochladen, die dort
     noch nicht (auch nicht mit gleichem Titel) existieren — verhindert Duplikate zwischen Geräten. */
  function connectSync(url, token){
    var cfg = {url:url.trim(), token:token.trim()};
    setSyncStatus('busy');
    return apiFetch(cfg, '/api/sync', {since:0, upserts:[]}).then(function(res){
      var remote = res.todos || [];
      var remoteIds = {}, remoteTitles = {};
      remote.forEach(function(r){
        remoteIds[r.id] = true;
        if(!r.deleted) remoteTitles[r.title.trim().toLowerCase()] = true;
      });
      localStorage.setItem(SYNC_KEY, JSON.stringify(cfg));
      state.sync = {cursor:0, dirty:{}, lastSync:0};
      state.tasks = state.tasks.filter(function(t){
        if(remoteIds[t.id]) return true;
        if(t.deleted) return false;
        if(remoteTitles[t.title.trim().toLowerCase()]) return false;
        state.sync.dirty[t.id] = true;
        return true;
      });
      mergeRemote(remote);
      state.sync.cursor = res.cursor;
      save();
      return runSync();
    }).then(function(){ renderAll(); });
  }

  function disconnectSync(){
    localStorage.removeItem(SYNC_KEY);
    state.sync = {cursor:0, dirty:{}, lastSync:0};
    save();
    setSyncStatus('off');
  }

  function initSync(){
    var dialog = document.getElementById('syncDialog');
    var urlIn = document.getElementById('syncUrl');
    var tokenIn = document.getElementById('syncToken');
    var err = document.getElementById('syncError');
    document.getElementById('syncBadge').onclick = function(){
      var cfg = syncConfig();
      urlIn.value = cfg ? cfg.url : '';
      tokenIn.value = cfg ? cfg.token : '';
      err.textContent = '';
      renderSyncBadge();
      dialog.showModal();
    };
    document.getElementById('syncConnectBtn').onclick = function(){
      if(!urlIn.value.trim() || !tokenIn.value.trim()){ err.textContent = 'URL und Token eintragen.'; return; }
      err.textContent = 'Verbinde …';
      connectSync(urlIn.value, tokenIn.value).then(function(){
        err.textContent = syncStatus.state === 'ok' ? 'Verbunden ✓' : '';
      }).catch(function(e){
        err.textContent = e && e.kind === 'auth' ? 'Token ungültig.'
          : e && e.kind === 'server' ? 'Serverfehler: ' + e.msg
          : 'Server nicht erreichbar — URL prüfen.';
        setSyncStatus(syncConfig() ? syncStatus.state : 'off');
      });
    };
    document.getElementById('syncNowBtn').onclick = function(){ runSync(); };
    document.getElementById('syncDisconnectBtn').onclick = function(){ disconnectSync(); renderSyncBadge(); };
    document.getElementById('syncCloseBtn').onclick = function(){ dialog.close(); };

    window.addEventListener('online', function(){ scheduleSync(0); });
    window.addEventListener('focus', function(){ scheduleSync(0); });
    document.addEventListener('visibilitychange', function(){ if(!document.hidden) scheduleSync(0); });
    setInterval(function(){ if(!document.hidden) scheduleSync(0); }, 60000);
    renderSyncBadge();
    scheduleSync(0);
  }

  /* ---------- Google Kalender (über die LIFE OS API, siehe backend/src/gcal.js) ---------- */
  /* Hin: Tagesplan-Blöcke als Termine, To-dos mit Fälligkeit als ganztägige Einträge.
     Zurück: Termine aus allen sichtbaren Google-Kalendern, nur angezeigt (Tagesplan, Woche, Home). */
  var CAL_PUSH_BATCH = 20;      // = MAX_PUSH im Backend
  var CAL_PAST_DAYS = 7;        // ältere Einträge werden nicht mehr abgeglichen
  var CAL_FETCH_EVERY = 5 * 60000;
  var calTimer = null, calBusy = false, calError = '';

  function calTimeZone(){
    try{ return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }catch(e){ return 'UTC'; }
  }
  function validTime(t){ return /^([01]\d|2[0-3]):[0-5]\d$/.test(t || ''); }
  function minutesOf(t){ var p = t.split(':'); return +p[0]*60 + +p[1]; }

  /* Alles, was im Kalender stehen soll, als {key, title, date, time?, endTime?, done, notes?}. */
  function calItems(){
    var cutoff = keyOffset(todayKey(), -CAL_PAST_DAYS);
    var items = [];
    Object.keys(state.dayplan).forEach(function(dk){
      if(dk < cutoff) return;
      var blocks = (state.dayplan[dk] || []).slice().sort(function(a,b){ return (a.time||'').localeCompare(b.time||''); });
      blocks.forEach(function(b, i){
        if(!b.label) return;
        var it = {key:'plan:' + dk + ':' + b.id, title:b.label, date:dk, done:!!b.done};
        if(validTime(b.time)){
          it.time = b.time;
          /* Block läuft bis zum nächsten, höchstens 3 h; sonst 60 Min. (Backend-Standard) */
          var next = blocks.slice(i + 1).filter(function(n){ return validTime(n.time) && n.time > b.time; })[0];
          if(next && minutesOf(next.time) - minutesOf(b.time) <= 180) it.endTime = next.time;
        }
        items.push(it);
      });
    });
    state.tasks.forEach(function(t){
      if(t.deleted || !t.due || t.due < cutoff) return;
      items.push({key:'todo:' + t.id, title:t.title, date:t.due, done:!!t.done, notes:t.notes || ''});
    });
    return items;
  }

  /* Unterschied zwischen dem, was zuletzt gepusht wurde, und dem jetzigen Stand. */
  function calDiff(){
    var cutoff = keyOffset(todayKey(), -CAL_PAST_DAYS);
    var pushed = state.gcal.pushed;
    var upserts = [], deletes = [], seen = {};
    calItems().forEach(function(it){
      seen[it.key] = true;
      var sig = JSON.stringify(it);
      if(!pushed[it.key] || pushed[it.key].sig !== sig) upserts.push(it);
    });
    Object.keys(pushed).forEach(function(key){
      if(seen[key]) return;
      if(pushed[key].date < cutoff) delete pushed[key]; // Vergangenes bleibt im Kalender stehen
      else deletes.push(key);
    });
    return {upserts:upserts, deletes:deletes};
  }

  function scheduleCal(delay, refetch){
    if(!state || !state.gcal || !syncConfig()) return;
    if(refetch) state.gcal.lastFetch = 0;
    clearTimeout(calTimer);
    calTimer = setTimeout(runCal, delay === undefined ? 2500 : delay);
  }

  /* Standardbereich: Vorwoche bis 6 Wochen voraus */
  function calBaseRange(){
    var from = keyOffset(mondayKeyOf(new Date()), -7);
    return {from:from, to:keyOffset(from, 7 * 7)};
  }

  /* Woche ausserhalb des geladenen Bereichs angezeigt -> Bereich erweitern und nachladen. */
  function ensureCalRange(monKey){
    var r = state.gcal.range;
    if(!state.gcal.connected || !r) return;
    var sunEnd = keyOffset(monKey, 7);
    if(monKey >= r.from && sunEnd <= r.to) return;
    state.gcal.range = {from:monKey < r.from ? monKey : r.from, to:sunEnd > r.to ? sunEnd : r.to};
    scheduleCal(0, true);
  }

  function fetchCalEvents(cfg){
    var base = calBaseRange();
    var r = state.gcal.range || base;
    /* Durch Blättern erweiterte Bereiche behalten, aber nie über 120 Tage (Backend-Limit) */
    r = {from:r.from < base.from ? r.from : base.from, to:r.to > base.to ? r.to : base.to};
    if(parseKey(r.to) - parseKey(r.from) > 119 * 86400000) r = base;
    return apiFetch(cfg, '/api/gcal/events?from=' + r.from + '&to=' + r.to).then(function(res){
      state.gcal.connected = !!res.connected;
      state.gcal.events = res.events || [];
      state.gcal.range = r;
      state.gcal.lastFetch = Date.now();
    });
  }

  function pushCal(cfg){
    var diff = calDiff();
    var ops = diff.upserts.map(function(it){ return {up:it}; })
      .concat(diff.deletes.map(function(k){ return {del:k}; }));
    if(!ops.length) return Promise.resolve();
    var batch = ops.slice(0, CAL_PUSH_BATCH);
    var body = {
      timeZone: calTimeZone(),
      upserts: batch.filter(function(o){ return o.up; }).map(function(o){ return o.up; }),
      deletes: batch.filter(function(o){ return o.del; }).map(function(o){ return o.del; })
    };
    return apiFetch(cfg, '/api/gcal/push', body).then(function(res){
      if(!res.connected){ state.gcal.connected = false; return; }
      var ok = {};
      (res.done || []).forEach(function(k){ ok[k] = true; });
      body.upserts.forEach(function(it){ if(ok[it.key]) state.gcal.pushed[it.key] = {sig:JSON.stringify(it), date:it.date}; });
      body.deletes.forEach(function(k){ if(ok[k]) delete state.gcal.pushed[k]; });
      if((res.failed || []).length){
        calError = res.failed.length + ' Eintrag/Einträge nicht übertragen (Google HTTP ' + res.failed[0].status + ')';
        return;
      }
      if(ops.length > batch.length) return pushCal(cfg);
    });
  }

  function runCal(){
    var cfg = syncConfig();
    if(!cfg) return Promise.resolve();
    if(calBusy){ scheduleCal(2000); return Promise.resolve(); }
    calBusy = true;
    calError = '';
    var stale = Date.now() - state.gcal.lastFetch > CAL_FETCH_EVERY;
    var fetched = stale || !state.gcal.connected;
    return (fetched ? fetchCalEvents(cfg) : Promise.resolve()).then(function(){
      return state.gcal.connected ? pushCal(cfg) : null;
    }).then(function(){
      calBusy = false;
      localStorage.setItem(STORE_KEY, JSON.stringify(state)); // nicht save(): würde erneut planen
      if(fetched) renderCalViews(); else renderCalStatus();
    }).catch(function(err){
      calBusy = false;
      calError = err && err.kind === 'server' ? err.msg
        : err && err.kind === 'auth' ? 'Token ungültig'
        : 'Server nicht erreichbar';
      renderCalStatus();
    });
  }

  /* Termine eines Tages in lokaler Zeit; time '' = ganztägig. */
  function calEventsOn(dk){
    if(!state.gcal.connected) return [];
    var out = [];
    state.gcal.events.forEach(function(ev){
      if(ev.allDay){
        if(ev.start <= dk && dk < ev.end) out.push({title:ev.title, time:'', ev:ev});
        return;
      }
      var s = new Date(ev.start);
      if(dateKey(s) !== dk) return;
      out.push({title:ev.title, time:pad2(s.getHours()) + ':' + pad2(s.getMinutes()), ev:ev});
    });
    return out.sort(function(a,b){ return a.time.localeCompare(b.time); });
  }

  /* Read-only Zeile für einen Termin; cls 'item' (Tagesplan) oder 'week-item' (Woche). */
  function calEventLi(c, cls){
    var li = el('li', cls + ' cal');
    if(c.ev.color) li.style.setProperty('--cal-color', c.ev.color);
    li.title = (c.ev.calendar || 'Google Kalender') + (c.ev.location ? ' · ' + c.ev.location : '');
    li.appendChild(el('span', 'cal-dot'));
    if(cls === 'item'){
      li.appendChild(el('span', 'plan-time', c.time || 'GANZT.'));
      li.appendChild(el('div', 'item-label', c.title));
    } else {
      li.appendChild(el('div', 'wlabel', (c.time ? c.time + ' ' : '') + c.title));
    }
    if(c.ev.link){
      li.classList.add('linked');
      li.onclick = function(){ window.open(c.ev.link, '_blank', 'noopener'); };
    }
    return li;
  }

  function renderCalViews(){
    renderDayplan();
    renderWeekplan();
    renderHome();
    renderCalStatus();
  }

  function renderCalStatus(){
    var info = document.getElementById('gcalInfo');
    if(!info) return;
    var linked = !!syncConfig();
    var g = state.gcal;
    info.textContent = !linked ? 'Erst oben mit der LIFE OS API verbinden.'
      : calError ? 'Fehler: ' + calError
      : g.connected ? 'Verbunden · ' + g.events.length + ' Termine geladen · ' + Object.keys(g.pushed).length + ' LIFE-OS-Einträge im Kalender'
      : 'Nicht verbunden.';
    var btn = document.getElementById('gcalConnectBtn');
    btn.disabled = !linked;
    btn.textContent = g.connected ? 'Neu verbinden' : 'Mit Google verbinden';
    document.getElementById('gcalDisconnectBtn').disabled = !linked || !g.connected;
  }

  function initCal(){
    var info = document.getElementById('gcalInfo');
    document.getElementById('gcalConnectBtn').onclick = function(){
      var cfg = syncConfig();
      if(!cfg) return;
      /* Fenster sofort im Klick öffnen (sonst Popup-Blocker), Google-URL danach setzen */
      var win = window.open('', '_blank');
      info.textContent = 'Öffne Google …';
      apiFetch(cfg, '/api/gcal/connect', {}).then(function(res){
        state.gcal.pushed = {}; // evtl. anderes Konto: alles neu übertragen
        if(win) win.location.href = res.url; else window.location.href = res.url;
        info.textContent = 'Im Google-Fenster anmelden und zustimmen, dann hierher zurückkehren.';
      }).catch(function(e){
        if(win) win.close();
        info.textContent = e && e.kind === 'server' ? e.msg : 'Server nicht erreichbar.';
      });
    };
    document.getElementById('gcalDisconnectBtn').onclick = function(){
      var cfg = syncConfig();
      if(!cfg) return;
      apiFetch(cfg, '/api/gcal', null, 'DELETE').then(function(){
        state.gcal = {connected:false, pushed:{}, events:[], range:null, lastFetch:0};
        localStorage.setItem(STORE_KEY, JSON.stringify(state));
        renderCalViews();
      }).catch(function(){ info.textContent = 'Trennen fehlgeschlagen — Server nicht erreichbar.'; });
    };
    /* Nach der Google-Anmeldung kommt man per Fokus zurück: dann sofort neu laden */
    window.addEventListener('focus', function(){ scheduleCal(0, true); });
    document.addEventListener('visibilitychange', function(){ if(!document.hidden) scheduleCal(0); });
    setInterval(function(){ if(!document.hidden) scheduleCal(0); }, 60000);
    renderCalStatus();
    scheduleCal(0, true);
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
    renderSyncBadge();
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
    else if(target.indexOf('todo-') === 0) addTask(val, target.slice(5));
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
    addTask(val, key);
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

  initNexus();
  initSync();
  initCal();
  forgivePenalties();
  settle();
  save();
  renderAll();
})();
