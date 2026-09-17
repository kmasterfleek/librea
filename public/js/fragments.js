// The add-fragment composer. What you may write, and who may read it, depends
// on who you are — the same rules the server enforces, said out loud.
import { api, h, state, status } from '/app.js';

const KIND_COPY = {
  self: ['In my own words', 'How something went, what you are working on, what you want people to know.'],
  artifact: ['Work I made', 'Describe a project, an essay, a performance. Put the story with the work.'],
  photo: ['A photo', 'An image with a caption.'],
  family: ['From home', 'What you see at home that school might not.'],
  observation: ['Observation', 'Something you noticed in class or in the hallway.'],
  note: ['Note', 'Free-form. Use staff-only for internal notes.'],
};

const BY_ROLE = {
  student: { kinds: ['self', 'artifact', 'photo'], visibility: ['private', 'family', 'school'], default: 'school' },
  family: { kinds: ['family', 'photo'], visibility: ['family', 'school'], default: 'school' },
  staff: { kinds: ['observation', 'note', 'photo'], visibility: ['school', 'staff'], default: 'school' },
  admin: { kinds: ['note', 'observation', 'photo'], visibility: ['school', 'staff'], default: 'school' },
};

const VIS_COPY = {
  private: 'Only me',
  family: 'Me and my family',
  school: 'Everyone involved (student, family, staff)',
  staff: 'Staff only',
};

const MAX_EDGE = 1600;

/** Returns a card that posts a fragment or photo for entityId, then calls onAdded(). */
export function composer(entityId, onAdded) {
  const rules = BY_ROLE[state.user?.role];
  if (!rules) return h('p.notice', 'This account cannot add to the record.');

  const kindSel = h('select', { id: 'fr-kind', onchange: () => sync() }, rules.kinds.map((k) => h('option', { value: k }, KIND_COPY[k]?.[0] || k)));
  kindSel.value = rules.kinds[0];
  const visSel = h('select', { id: 'fr-vis' }, rules.visibility.map((v) => h('option', { value: v }, VIS_COPY[v] || v)));
  visSel.value = rules.default;
  const text = h('textarea', { id: 'fr-text', placeholder: 'Write it the way you would say it.' });
  const hint = h('p.small.muted', { style: 'margin:4px 0 0' });
  const fileRow = h('div.field', { hidden: true },
    h('label', { for: 'fr-file' }, 'Photo'),
    h('input', { type: 'file', id: 'fr-file', accept: 'image/png,image/jpeg,image/webp', onchange: onPick }));
  const preview = h('div.thumbrow');
  const err = h('p.err', { role: 'alert' });
  const submit = h('button.btn', { type: 'submit' }, 'Add to the record');
  let picked = null;

  const form = h('form', { onsubmit: onSubmit },
    h('div.inline-form',
      h('div', h('label', { for: 'fr-kind' }, 'What is this?'), kindSel),
      h('div', h('label', { for: 'fr-vis' }, 'Who can read it?'), visSel)),
    hint,
    fileRow,
    preview,
    h('div.field', { style: 'margin-top:12px' }, h('label', { for: 'fr-text' }, 'Words'), text),
    err,
    submit,
  );
  sync();

  function sync() {
    const kind = kindSel.value;
    hint.textContent = KIND_COPY[kind]?.[1] || '';
    fileRow.hidden = kind !== 'photo';
    text.placeholder = kind === 'photo' ? 'Caption — what is happening here?' : 'Write it the way you would say it.';
    if (kind !== 'photo') { picked = null; preview.replaceChildren(); }
  }

  async function onPick(e) {
    const file = e.target.files?.[0];
    err.textContent = '';
    preview.replaceChildren();
    picked = null;
    if (!file) return;
    try {
      picked = await shrink(file);
      preview.appendChild(h('img', { src: picked.dataUrl, alt: 'Selected photo preview', style: 'max-height:150px;border-radius:9px;border:1px solid var(--line)' }));
      preview.appendChild(h('p.small.muted', `${picked.width}×${picked.height}, ${Math.round(picked.bytes / 1024)} KB after resizing on this device.`));
    } catch (ex) { err.textContent = 'Could not read that image: ' + ex.message; }
  }

  async function onSubmit(e) {
    e.preventDefault();
    err.textContent = '';
    const kind = kindSel.value;
    const body = text.value.trim();
    if (!body) { err.textContent = kind === 'photo' ? 'A caption is required — a photo without a story is just a file.' : 'Write something first.'; text.focus(); return; }
    if (kind === 'photo' && !picked) { err.textContent = 'Choose a photo.'; return; }
    submit.disabled = true;
    try {
      if (kind === 'photo') {
        await api(`/api/people/${encodeURIComponent(entityId)}/photo`, { method: 'POST', body: { caption: body, mime: picked.mime, data: picked.base64, visibility: visSel.value } });
      } else {
        await api(`/api/people/${encodeURIComponent(entityId)}/fragments`, { method: 'POST', body: { kind, text: body, visibility: visSel.value } });
      }
      text.value = '';
      picked = null;
      preview.replaceChildren();
      if (fileRow.querySelector('input')) fileRow.querySelector('input').value = '';
      status('Added to the record.');
      await onAdded();
    } catch (ex) { err.textContent = ex.message; }
    submit.disabled = false;
  }

  return h('div.card', { style: 'margin-bottom:18px' },
    h('h3', { style: 'margin-top:0' }, 'Add something'),
    form,
    h('p.small.muted', { style: 'margin-bottom:0' }, 'Photos are resized on this device before upload and stored in your own data folder.'));
}

/** Resize to fit MAX_EDGE on the long side, entirely in the browser. */
function shrink(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('unreadable file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('not an image'));
      img.onload = () => {
        const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const hgt = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = hgt;
        canvas.getContext('2d').drawImage(img, 0, 0, w, hgt);
        const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        const dataUrl = canvas.toDataURL(mime, 0.85);
        const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
        resolve({ dataUrl, base64, mime, width: w, height: hgt, bytes: Math.round(base64.length * 0.75) });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
