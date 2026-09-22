// Invites: a code, and a message you can actually send. This is how a school
// with no IT department gets families and staff their own accounts.
import { api, h, clear, status, when } from '/app.js';
import { t, word, edition, copy, fill } from '/js/edition.js';
import { field, input, select, copyBox, table } from '/js/ui.js';

export const joinUrl = (code) => `${location.origin}/#/join/${code}`;

/** Copy keys an edition may set, per role, most specific first. */
const COPY_KEYS = {
  family: ['invite_family', 'inviteFamily', 'inviteEmailFamily', 'inviteGuardian', 'invite_guardian'],
  staff: ['invite_guide', 'inviteGuide', 'inviteEmailGuide', 'invite_staff', 'inviteStaff'],
  student: ['invite_student', 'inviteStudent', 'inviteEmailStudent'],
  admin: ['invite_admin', 'inviteAdmin', 'inviteStaff'],
};

const DEFAULT = {
  family: 'You are invited to {school}.\n\nThis is the record we keep for your child. It runs on a computer we own, here — nothing about your family is sent to a company.\n\nGo to {url} and enter the code {code} to make your login. Once you are in you can read everything we hold, correct anything wrong, and add to it yourself.\n\n— {inviter}, {school}',
  staff: 'You are invited to {school}.\n\nThis is where we keep the record: the register, each student’s plan, the paperwork we have to keep current, and the running story of the work.\n\nGo to {url} and enter the code {code} to make your login.\n\n— {inviter}, {school}',
  student: 'This is your page at {school}.\n\nEverything the school records about you lives here, and you can add to it in your own words.\n\nGo to {url} and enter the code {code} to make your login.\n\n— {inviter}',
  admin: 'You are invited to administer {school}.\n\nGo to {url} and enter the code {code} to make your login.\n\n— {inviter}',
};

/** Turn an invite into a message, using this edition's wording when it has one. */
export function inviteMessage(invite, { orgName = '', who = '', child = '', inviter = '' } = {}) {
  const template = copy(...(COPY_KEYS[invite.role] || [])) || DEFAULT[invite.role] || DEFAULT.family;
  const named = who || invite.displayName || '';
  const kid = child || (invite.role === 'family' ? '' : named);
  const vars = { code: invite.code, url: joinUrl(invite.code), inviter: inviter || 'the office', name: named, invitee: named };
  for (const base of ['school', 'district']) { vars[base] = orgName; vars[word(base)] = orgName; }
  // A family invite is written *about* the child, so the student words name them.
  for (const base of ['student', 'teacher']) { vars[base] = kid || named; vars[word(base)] = vars[base]; }
  for (const base of ['family', 'staff']) { vars[base] = named; vars[word(base)] = named; }
  vars.org = orgName; vars.orgName = orgName; vars.child = vars.student;
  const body = fill(template, vars);
  // An edition may write the human half and leave the mechanics to us.
  const mechanics = /\{(url|code)\}/.test(template) ? '' :
    `\n\nGo to ${vars.url} and enter the code ${invite.code} to make your login.${vars.inviter ? `\n\n— ${vars.inviter}` : ''}`;
  return body + mechanics;
}

/**
 * The invite composer. `opts`: { role, entityId, entityIds, displayName, orgName,
 * who, inviter, onCreated }. Everything is optional; the form asks for the rest.
 */
export function inviteComposer(opts = {}) {
  const roles = (edition().roles || ['admin', 'staff', 'student', 'family']);
  const role = select(roles, opts.role || 'family');
  const entity = input({ value: opts.entityId || '', placeholder: 'STU-0001' });
  const name = input({ value: opts.displayName || '', placeholder: 'Who is this for?' });
  const days = input({ type: 'number', value: '14', min: '1', max: '365' });
  const out = h('div');
  const err = h('p.err', { role: 'alert' });

  const form = h('form', { onsubmit: submit },
    h('div.formgrid',
      h('div', field('Role', role, 'What this person will see when they sign in.')),
      h('div', field('Linked record id', entity, t('A student id links a student or family account to their record.'))),
      h('div', field('Name on the invite', name)),
      h('div', field('Good for (days)', days)),
    ),
    err,
    h('button.btn', { type: 'submit' }, t('Make an invite')),
  );

  async function submit(e) {
    e.preventDefault();
    err.textContent = '';
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const body = { role: role.value, displayName: name.value.trim(), days: Number(days.value) || 14 };
      const id = entity.value.trim();
      if (id) { if (role.value === 'family') body.entityIds = [id]; else body.entityId = id; }
      if (opts.entityIds?.length && !id) body.entityIds = opts.entityIds;
      const { invite } = await api('/api/invites', { method: 'POST', body });
      clear(out).appendChild(inviteCard(invite, { ...opts, who: name.value.trim() || opts.who }));
      status(t(`Invite ${invite.code} is ready to send.`));
      await opts.onCreated?.(invite);
    } catch (ex) { err.textContent = ex.message; }
    btn.disabled = false;
  }

  return h('div', form, out);
}

/** The made invite: the code, the link, and a message ready to paste. */
export function inviteCard(invite, ctx = {}) {
  const msg = inviteMessage(invite, ctx);
  return h('div.card', { style: 'margin-top:14px;border-left:3px solid var(--accent)' },
    h('div.spread', h('h3', { style: 'margin:0' }, t('Invite for ') + (invite.displayName || invite.role)),
      h('span.chip', invite.role)),
    h('p.small.muted', { style: 'margin:4px 0' },
      t('Send this to them however you already talk to them. The code works once, and expires '), when(invite.expiresAt) + '.'),
    h('div.codebox', h('span.code', invite.code), h('span.small.muted.mono', joinUrl(invite.code))),
    h('label', { style: 'margin-top:10px' }, t('Ready to send')),
    copyBox(msg, t('Copy the message')),
  );
}

/** The open-invite list, with revoke. */
export function inviteList(ctx = {}) {
  const body = h('div', h('p.small.muted', 'Loading…'));
  load();
  async function load() {
    try {
      const { invites } = await api('/api/invites');
      const open = invites.filter((i) => !i.usedBy && i.expiresAt > new Date().toISOString());
      const used = invites.filter((i) => i.usedBy);
      clear(body);
      if (!open.length) body.appendChild(h('p.empty', t('No invites are waiting to be used.')));
      else body.appendChild(table([
        ['code', 'Code', (v) => h('span.mono', { style: 'font-weight:650' }, v)],
        ['role', 'Role'],
        ['displayName', 'For'],
        [(i) => [i.entityId, ...(i.entityIds || [])].filter(Boolean).join(', '), 'Linked'],
        ['expiresAt', 'Expires', when],
        [(i) => h('div.row', { style: 'gap:6px;flex-wrap:nowrap' },
          h('button.btn.ghost.small', { onclick: () => navigator.clipboard?.writeText(inviteMessage(i, ctx)).then(() => status(t('Message copied.')), () => {}) }, t('Copy')),
          h('button.btn.danger.small', { onclick: () => revoke(i) }, t('Revoke'))), ''],
      ], open));
      if (used.length) body.appendChild(h('p.small.muted', { style: 'margin-top:10px' },
        t(`${used.length} invite${used.length === 1 ? ' has' : 's have'} already been used.`)));
    } catch (e) { clear(body).appendChild(h('p.err', e.message)); }
  }
  async function revoke(i) {
    if (!window.confirm(t(`Revoke ${i.code}? Whoever has it will not be able to make an account.`))) return;
    try { await api(`/api/invites/${encodeURIComponent(i.code)}/revoke`, { method: 'POST', body: {} }); status(t('Invite revoked.')); await load(); }
    catch (e) { status(e.message, true); }
  }
  return { node: h('div', body), reload: load };
}
