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
  if (s && s.unread) news.push(s.unread === 1 ? 'es gibt ein neues Update' : `es gibt ${s.unread} neue Updates`);
  if (next && inMin <= 90) news.push(`um ${next.time} hast du ${next.title}`);
  const lead = news.length ? ' Kurz: ' + news.slice(0, 2).join(', und ') + '.' : '';
  return hello + lead + ' ' + pick(['Was soll ich dir öffnen?', 'Was steht an?', 'Was möchtest du wissen?', 'Womit fangen wir an?']);
}
