import { h } from '../core/dom.js';
import { state, save, notify } from '../core/store.js';
import { todayKey, fmt } from '../core/dates.js';
import { panel } from '../components/panel.js';
import { viewHead, seg, chip, select, iconBtn, empty, toggle } from '../components/ui.js';
import { liveJobs, addJob, updateJob, jobsAppliedThisWeek } from '../core/model.js';
import { JOB_STATUS, JOB_TYPES } from '../core/migrations.js';
import { tick } from '../core/fx.js';

const STATUS_LABEL = { saved: 'Saved', applied: 'Applied', interview: 'Interview', offer: 'Offer', rejected: 'Rejected' };
const TYPE_LABEL = { werkstudent: 'Werkstudent', 'part-time': 'Part-time', startup: 'Startup', minijob: 'Minijob', other: 'Other' };
const STATUS_COLOR = { saved: 'var(--ink-3)', applied: 'var(--signal)', interview: 'var(--amber)', offer: 'var(--pulse)', rejected: 'var(--flare)' };

let filterType = 'all';
let showArchived = false;
let editing = null;
let dragId = null;

function card(j) {
  const tk = todayKey();
  const overdue = j.nextActionDate && j.nextActionDate < tk && !['rejected', 'offer'].includes(j.status);
  const due = j.nextActionDate && j.nextActionDate === tk;
  return h('article.job-card' + (j.archived ? '.archived' : ''), {
    draggable: 'true', tabindex: 0, style: { '--c': STATUS_COLOR[j.status] },
    ondragstart: e => { dragId = j.id; e.dataTransfer.effectAllowed = 'move'; e.currentTarget.classList.add('dragging'); },
    ondragend: e => e.currentTarget.classList.remove('dragging'),
    onclick: () => { editing = j.id; notify(); },
    onkeydown: e => { if (e.key === 'Enter') { editing = j.id; notify(); } }
  },
    h('div.jc-top', h('span.jc-company', j.company || 'Untitled'), j.type !== 'other' ? chip(TYPE_LABEL[j.type], null, 'plain') : null),
    j.role ? h('div.jc-role', j.role) : null,
    h('div.jc-meta',
      j.location ? h('span', j.location) : null,
      j.hoursPerWeek ? h('span.data', j.hoursPerWeek + ' h/wk') : null,
      j.salary ? h('span.data', j.salary) : null),
    j.nextAction || j.nextActionDate ? h('div.jc-next' + (overdue ? '.overdue' : due ? '.due' : ''),
      h('span', j.nextAction || 'Next step'), j.nextActionDate ? h('span.data', fmt.short(j.nextActionDate)) : null) : null);
}

function editor(j) {
  const close = () => { editing = null; notify(); };
  const field = (label, key, attrs = {}) => h('label.ed-field', h('span.label', label),
    h('input.field', { value: j[key] ?? '', ...attrs, onchange: e => updateJob(j, { [key]: attrs.type === 'number' ? (parseFloat(e.target.value) || null) : e.target.value }) }));
  return panel({ title: j.company || 'New role', cls: 'job-editor', actions: [iconBtn('x', 'Close', close, 'sm ghost')] },
    h('div.grid.g-2',
      field('Company', 'company'), field('Role', 'role'),
      h('label.ed-field', h('span.label', 'Type'), select(JOB_TYPES.map(t => ({ value: t, label: TYPE_LABEL[t] })), j.type, v => updateJob(j, { type: v }), 'Type')),
      h('label.ed-field', h('span.label', 'Status'), select(JOB_STATUS.map(s => ({ value: s, label: STATUS_LABEL[s] })), j.status, v => updateJob(j, { status: v }), 'Status')),
      field('Location', 'location'), field('Hours per week', 'hoursPerWeek', { type: 'number', min: 0, max: 40 }),
      field('Salary', 'salary', { placeholder: 'e.g. 15 €/h' }), field('Applied on', 'appliedAt', { type: 'date' }),
      field('Next step', 'nextAction', { placeholder: 'e.g. Follow up by email' }), field('Next step date', 'nextActionDate', { type: 'date' }),
      field('Link', 'link', { type: 'url', placeholder: 'https://' }), field('Contact', 'contact')),
    h('label.ed-field', h('span.label', 'Notes'), h('textarea.field', { rows: 3, onchange: e => updateJob(j, { notes: e.target.value }) }, j.notes || '')),
    h('div.input-row', { style: { marginTop: '14px' } },
      j.link ? h('a.btn', { href: j.link, target: '_blank', rel: 'noopener' }, 'Open posting') : null,
      h('button.btn', { type: 'button', onclick: () => updateJob(j, { archived: !j.archived }) }, j.archived ? 'Unarchive' : 'Archive'),
      h('button.btn.danger', { type: 'button', onclick: () => { if (confirm('Delete this role?')) { updateJob(j, { deleted: true }); close(); } } }, 'Delete')));
}

function quickAdd() {
  const company = h('input.field', { placeholder: 'Company', 'aria-label': 'Company' });
  const role = h('input.field', { placeholder: 'Role, e.g. Werkstudent Frontend', 'aria-label': 'Role' });
  let type = 'werkstudent';
  const submit = () => {
    if (!company.value.trim()) { company.focus(); return; }
    tick('ok');
    const j = addJob({ company: company.value.trim(), role: role.value.trim(), type });
    editing = j.id; notify();
  };
  role.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  company.addEventListener('keydown', e => { if (e.key === 'Enter') role.focus(); });
  return h('div.input-row.job-add', company, role,
    select(JOB_TYPES.map(t => ({ value: t, label: TYPE_LABEL[t] })), type, v => { type = v; }, 'Type', 'field narrow'),
    h('button.btn.primary', { type: 'button', onclick: submit }, 'Add role'));
}

export default {
  id: 'jobs',
  render(root) {
    const all = liveJobs();
    const jobs = all.filter(j => (showArchived || !j.archived) && (filterType === 'all' || j.type === filterType));
    const active = all.filter(j => !j.archived && j.status !== 'rejected');
    const archivedCount = all.filter(j => j.archived).length;
    const board = h('div.kanban');
    for (const s of JOB_STATUS) {
      const list = jobs.filter(j => j.status === s).sort((a, b) => (a.nextActionDate || '9').localeCompare(b.nextActionDate || '9'));
      const col = h('section.k-col', {
        style: { '--c': STATUS_COLOR[s] }, 'aria-label': STATUS_LABEL[s],
        ondragover: e => { e.preventDefault(); col.classList.add('over'); },
        ondragleave: () => col.classList.remove('over'),
        ondrop: e => { e.preventDefault(); col.classList.remove('over'); const j = all.find(x => x.id === dragId); if (j && j.status !== s) { tick('ok'); updateJob(j, { status: s }); } }
      },
        h('header.k-head', h('i'), STATUS_LABEL[s], h('span.data', String(list.length))),
        h('div.k-list', list.length ? list.map(card) : h('div.k-empty', s === 'saved' ? 'Roles you want to apply for' : 'Drop here')));
      board.append(col);
    }
    const ed = editing && all.find(j => j.id === editing);
    root.append(h('div.view.jobs',
      viewHead('Job hunt', 'Part-time, Werkstudent and startup roles in Berlin.',
        seg([{ value: 'all', label: 'All' }, ...['werkstudent', 'part-time', 'startup', 'minijob'].map(t => ({ value: t, label: TYPE_LABEL[t] }))], filterType, v => { filterType = v; notify(); }, 'Filter by type')),
      h('div.grid.g-4.job-stats',
        panel({}, h('div.stat', h('div.k', 'Active'), h('div.v', String(active.length)))),
        panel({}, h('div.stat', h('div.k', 'Applied this week'), h('div.v', String(jobsAppliedThisWeek()), h('small', 'goal 2')))),
        panel({}, h('div.stat', h('div.k', 'Interviews'), h('div.v', String(active.filter(j => j.status === 'interview').length)))),
        panel({}, h('div.stat', h('div.k', 'Follow-ups due'), h('div.v', String(active.filter(j => j.nextActionDate && j.nextActionDate <= todayKey()).length))))),
      panel({ cls: 'job-add-panel' }, quickAdd(),
        h('div.archive-toggle', toggle(showArchived, v => { showArchived = v; notify(); }, 'Show archived'), h('span.dim', `Show archived (${archivedCount} from the Swiss internship round)`))),
      ed ? editor(ed) : null,
      jobs.length || active.length ? board : panel({}, empty('No roles yet', 'Add a company above. Drag cards between columns as things move.'))));
  }
};
