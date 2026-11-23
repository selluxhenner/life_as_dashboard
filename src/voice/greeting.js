// Lina's hello when the app opens (or Ctrl+R): spoken, in German, because that is how Kevin talks to her. A few
// variants per time of day; something urgent (a meeting in a few minutes) comes first, then up to two things that
// matter, then a question so she can listen right after. Spoken language, not UI text (see tests/i18n.test.js).
const pick = list => list[Math.floor(Math.random() * list.length)];
export function greetingFor(s, agenda, now = new Date()) {
  const hr = now.getHours();
  const hello = hr < 5 ? pick(['Noch wach, Kevin?', 'Hey Kevin, späte Runde?']) : hr < 11 ? pick(['Guten Morgen, Kevin.', 'Morgen, Kevin.', 'Hey Kevin, guten Morgen.'])
    : hr < 18 ? pick(['Hey Kevin.', 'Hi Kevin.', 'Da bist du ja, Kevin.']) : pick(['Guten Abend, Kevin.', 'Hey Kevin, schönen Abend.']);
  const nowMin = hr * 60 + now.getMinutes();
  const next = agenda.filter(i => !i.allDay && i.start != null && i.start >= nowMin)[0];
  const inMin = next ? next.start - nowMin : null;
  if (next && inMin <= 15) return `${hello} ${inMin <= 1 ? 'Gleich' : `In ${inMin} Minuten`} startet ${next.title}. Bist du bereit?`;
  const news = [];
  if (s && s.server && s.server.status === 'fail') news.push('der Server braucht Aufmerksamkeit');
  if (s && s.approvals) news.push(s.approvals === 1 ? 'eine Freigabe wartet auf dich' : `${s.approvals} Freigaben warten auf dich`);
  const asks = s && s.workbench && s.workbench.link ? s.workbench.link.needs : 0;
  if (asks) news.push(asks === 1 ? 'Workbench braucht dich einmal' : `Workbench braucht dich ${asks} Mal`);
  if (s && s.unread) news.push(s.unread === 1 ? 'es gibt ein neues Update' : `es gibt ${s.unread} neue Updates`);
  if (next && inMin <= 90) news.push(`um ${next.time} hast du ${next.title}`);
  const lead = news.length ? ' Kurz: ' + news.slice(0, 2).join(', und ') + '.' : '';
  return hello + lead + ' ' + pick(['Was soll ich dir öffnen?', 'Was steht an?', 'Was möchtest du wissen?', 'Womit fangen wir an?']);
}

/* What Lina says about a page she just opened, when Live voice is on: the newest and most important, briefly.
   Asked as a request to her, so she looks it up with her tools. null: she stays quiet (settings, her own deck). */
const PAGE_BRIEF = {
  calendar: 'Ich habe gerade den Kalender geöffnet. Sag mir in zwei kurzen Sätzen, was heute und in den nächsten Tagen ansteht.',
  today: 'Ich habe gerade die Tagesansicht geöffnet. Was steht heute an, das Wichtigste zuerst, in zwei kurzen Sätzen?',
  inbox: 'Ich habe gerade die Inbox geöffnet. Was ist neu und wichtig in meinen Mails, in zwei kurzen Sätzen?',
  captures: 'Ich habe gerade die Captures geöffnet. Was liegt da, und ist etwas unsortiert? Zwei kurze Sätze.',
  news: 'Ich habe gerade die Weltkarte geöffnet. Was sind die zwei wichtigsten Nachrichten gerade, ganz kurz?',
  workbench: 'Ich habe gerade Workbench geöffnet. Was braucht mich, und wie ausgelastet sind PC und MacBook? Zwei kurze Sätze.',
  hub: 'Ich habe gerade den Hub geöffnet. Wartet etwas auf mich: Freigaben, Agent-Tasks, Server? Kurz.',
  goals: 'Ich habe gerade den Plan geöffnet. Wo stehen meine Ziele und das Board, kurz?',
  home: 'Ich habe gerade die Übersicht geöffnet. Was ist heute das Wichtigste, kurz?',
  jobs: 'Ich habe gerade die Jobsuche geöffnet. Wo stehe ich, und was ist der nächste Schritt? Kurz.',
  ai: 'Ich habe gerade die AI-Modelle geöffnet. Was hat sich zuletzt Wichtiges getan? Kurz.'
};
export const pageBrief = id => PAGE_BRIEF[id] || null;

/* A new ask of Workbench, as a question. The titles are what Workbench wrote, so they are only ever read out. A kind
   this build doesn't know still gets a question that a plain yes answers, or an open one. */
const spoken = t => String(t || '').replace(/[·|]/g, ',').replace(/\s+/g, ' ').trim().slice(0, 140);
const task = a => a.task || spoken(a.title);
/* What a plain yes would do, as the question: always the option Workbench marked, so she never asks one thing and a
   yes does another. */
const YES = {
  approve: 'Soll ich das freigeben?', ok: 'Soll er starten?', pass: 'Soll es weitergehen?', grant: 'Soll ich die Pfade freigeben?', retry: 'Soll ich den Task neu starten?',
  suggestion: 'Soll er es so machen, wie er vorschlägt?', merge: 'Darf er gemergt werden?', resume: 'Soll orch weiterlaufen?'
};
const WHAT = {
  'plan-approval': a => `Der Plan ${spoken(a.title)} wartet auf deine Freigabe.`,
  'start-ok': a => `${task(a)} ist riskant und wartet auf dein OK.`,
  'pull-request': a => `${task(a)} ist fertig und wartet auf dein OK zum Mergen.`,
  proposal: a => `Eine neue Session will starten: ${spoken(a.title)}.`,
  subsession: a => `Eine Session will eine Unter-Session starten: ${spoken(a.title)}.`
};
export function askLine(a, count = 1) {
  const what = WHAT[a.kind] ? WHAT[a.kind](a) : spoken(a.title) + '.';
  const question = a.yes ? YES[a.yes.id] || `Soll ich „${spoken(a.yes.label)}“ bestätigen?` : a.words ? 'Was soll ich antworten?' : 'Das entscheidest du in Workbench.';
  return (count > 1 ? `Workbench braucht dich ${count} Mal. Zuerst: ` : 'Kurz zu Workbench: ') + what + ' ' + question;
}
