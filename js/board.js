import { buildConfigFromParams, generateId } from './config.js';
import { submitEvent } from './google-form.js';
import { fetchSheetEvents } from './google-sheet.js';
import { reduceEventsToNotes } from './note-store.js';
import { enableBoardPan } from './board-pan.js';
import { enableUiVisibility } from './ui-visibility.js';

const SYNC_INTERVAL_MS = 5000;
const DEFAULT_NOTE = { width: 180, height: 120, color: 'yellow' };
const COLORS = ['yellow', 'pink', 'blue', 'green', 'purple', 'orange'];

const configError = document.querySelector('#config-error');
const boardApp = document.querySelector('#board-app');
const board = document.querySelector('#board');
const emptyState = document.querySelector('#empty-state');
const noteTemplate = document.querySelector('#note-template');
const addNoteButton = document.querySelector('#add-note');
const refreshButton = document.querySelector('#refresh-board');
const syncStatus = document.querySelector('#sync-status');
const noteCount = document.querySelector('#note-count');

const parsed = buildConfigFromParams();
const notes = new Map();
const editingNotes = new Set();
let config;
let syncTimer;
let maxZIndex = 1;

if (!parsed.ok) {
  configError.classList.remove('hidden');
} else {
  config = parsed.config;
  boardApp.classList.remove('hidden');
  boot();
}

function boot() {
  enableBoardPan(board);
  enableUiVisibility(boardApp);
  addNoteButton.addEventListener('click', createNote);
  refreshButton.addEventListener('click', () => syncFromSheet({ manual: true }));
  syncFromSheet();
  syncTimer = window.setInterval(syncFromSheet, SYNC_INTERVAL_MS);
  window.addEventListener('beforeunload', () => window.clearInterval(syncTimer));
}

async function syncFromSheet(options = {}) {
  setSyncStatus(options.manual ? '重新同步中...' : '同步中...');

  try {
    const events = await fetchSheetEvents(config);
    const remoteNotes = reduceEventsToNotes(events, config.boardId);
    mergeRemoteNotes(remoteNotes);
    setSyncStatus(`已同步 ${new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`);
  } catch (error) {
    console.error(error);
    setSyncStatus('無法讀取 Google Sheet，請確認試算表已公開檢視。', true);
  }
}

function mergeRemoteNotes(remoteNotes) {
  const remoteIds = new Set(remoteNotes.map((note) => note.note_id));

  for (const note of remoteNotes) {
    if (editingNotes.has(note.note_id)) continue;
    upsertNote(note, { submit: false });
  }

  for (const [noteId, note] of notes) {
    if (!remoteIds.has(noteId) && !note.pending) {
      note.element.remove();
      notes.delete(noteId);
    }
  }

  updateBoardMeta();
}

async function createNote() {
  const rect = board.getBoundingClientRect();
  const note = {
    note_id: generateId('note'),
    text: '雙擊編輯想法',
    x: Math.max(24, Math.round(board.scrollLeft + rect.width / 2 - DEFAULT_NOTE.width / 2)),
    y: Math.max(24, Math.round(board.scrollTop + rect.height / 2 - DEFAULT_NOTE.height / 2)),
    width: DEFAULT_NOTE.width,
    height: DEFAULT_NOTE.height,
    color: DEFAULT_NOTE.color,
    z_index: nextZIndex(),
    pending: true,
  };

  upsertNote(note, { submit: false });
  startEditing(note.note_id);
  await submitNoteEvent(note.note_id, 'create');
}

function upsertNote(note, options = {}) {
  const existing = notes.get(note.note_id);
  const element = existing?.element || createNoteElement(note.note_id);
  const state = {
    ...existing,
    ...note,
    element,
    pending: options.submit ? true : note.pending || false,
  };

  notes.set(note.note_id, state);
  maxZIndex = Math.max(maxZIndex, Number(state.z_index) || 1);
  renderNote(state);
  updateBoardMeta();
}

function createNoteElement(noteId) {
  const fragment = noteTemplate.content.cloneNode(true);
  const element = fragment.querySelector('.note');
  const text = element.querySelector('.note-text');
  const editor = element.querySelector('.note-editor');
  const color = element.querySelector('.note-color');
  const edit = element.querySelector('.edit-note');
  const remove = element.querySelector('.delete-note');
  const resizeHandle = element.querySelector('.resize-handle');

  element.dataset.noteId = noteId;
  board.append(element);

  element.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button, select, textarea, .resize-handle')) return;
    beginDrag(event, noteId);
  });
  resizeHandle.addEventListener('pointerdown', (event) => beginResize(event, noteId));
  text.addEventListener('dblclick', () => startEditing(noteId));
  text.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') startEditing(noteId);
  });
  edit.addEventListener('click', () => startEditing(noteId));
  remove.addEventListener('click', () => deleteNote(noteId));
  color.addEventListener('change', async () => {
    const note = notes.get(noteId);
    note.color = color.value;
    note.z_index = nextZIndex();
    renderNote(note);
    await submitNoteEvent(noteId, 'update');
  });
  editor.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      finishEditing(noteId);
    }
    if (event.key === 'Escape') {
      cancelEditing(noteId);
    }
  });
  editor.addEventListener('blur', () => finishEditing(noteId));

  return element;
}

function renderNote(note) {
  const element = note.element;
  const text = element.querySelector('.note-text');
  const editor = element.querySelector('.note-editor');
  const color = element.querySelector('.note-color');

  element.style.left = `${note.x}px`;
  element.style.top = `${note.y}px`;
  element.style.width = `${note.width}px`;
  element.style.height = `${note.height}px`;
  element.style.zIndex = note.z_index;
  element.dataset.color = COLORS.includes(note.color) ? note.color : 'yellow';
  text.textContent = note.text || '空白便條貼';
  editor.value = note.text || '';
  color.value = COLORS.includes(note.color) ? note.color : 'yellow';
}

function startEditing(noteId) {
  const note = notes.get(noteId);
  if (!note) return;

  editingNotes.add(noteId);
  note.element.classList.add('is-editing');
  const editor = note.element.querySelector('.note-editor');
  editor.value = note.text || '';
  window.setTimeout(() => {
    editor.focus();
    editor.select();
  }, 0);
}

async function finishEditing(noteId) {
  if (!editingNotes.has(noteId)) return;
  const note = notes.get(noteId);
  if (!note) return;

  const editor = note.element.querySelector('.note-editor');
  const nextText = editor.value.trim();
  editingNotes.delete(noteId);
  note.element.classList.remove('is-editing');

  if (nextText !== note.text) {
    note.text = nextText;
    note.z_index = nextZIndex();
    renderNote(note);
    await submitNoteEvent(noteId, 'update');
  }
}

function cancelEditing(noteId) {
  const note = notes.get(noteId);
  if (!note) return;
  editingNotes.delete(noteId);
  note.element.classList.remove('is-editing');
  renderNote(note);
}

async function deleteNote(noteId) {
  const note = notes.get(noteId);
  if (!note) return;
  if (!window.confirm('確定要刪除這張便條貼嗎？')) return;

  note.element.remove();
  notes.delete(noteId);
  updateBoardMeta();
  await submitDeletedEvent(note);
}

function beginDrag(event, noteId) {
  const note = notes.get(noteId);
  if (!note) return;

  event.preventDefault();
  note.z_index = nextZIndex();
  renderNote(note);

  const start = {
    pointerId: event.pointerId,
    pointerX: event.clientX,
    pointerY: event.clientY,
    x: note.x,
    y: note.y,
  };

  note.element.setPointerCapture(event.pointerId);
  const move = (moveEvent) => {
    if (moveEvent.pointerId !== start.pointerId) return;
    note.x = Math.max(0, start.x + moveEvent.clientX - start.pointerX);
    note.y = Math.max(0, start.y + moveEvent.clientY - start.pointerY);
    renderNote(note);
  };
  const end = async (endEvent) => {
    if (endEvent.pointerId !== start.pointerId) return;
    note.element.removeEventListener('pointermove', move);
    note.element.removeEventListener('pointerup', end);
    note.element.removeEventListener('pointercancel', end);
    await submitNoteEvent(noteId, 'update');
  };

  note.element.addEventListener('pointermove', move);
  note.element.addEventListener('pointerup', end);
  note.element.addEventListener('pointercancel', end);
}

function beginResize(event, noteId) {
  const note = notes.get(noteId);
  if (!note) return;

  event.preventDefault();
  event.stopPropagation();
  note.z_index = nextZIndex();
  renderNote(note);

  const start = {
    pointerId: event.pointerId,
    pointerX: event.clientX,
    pointerY: event.clientY,
    width: note.width,
    height: note.height,
  };

  note.element.setPointerCapture(event.pointerId);
  const move = (moveEvent) => {
    if (moveEvent.pointerId !== start.pointerId) return;
    note.width = clamp(start.width + moveEvent.clientX - start.pointerX, 120, 600);
    note.height = clamp(start.height + moveEvent.clientY - start.pointerY, 80, 400);
    renderNote(note);
  };
  const end = async (endEvent) => {
    if (endEvent.pointerId !== start.pointerId) return;
    note.element.removeEventListener('pointermove', move);
    note.element.removeEventListener('pointerup', end);
    note.element.removeEventListener('pointercancel', end);
    await submitNoteEvent(noteId, 'update');
  };

  note.element.addEventListener('pointermove', move);
  note.element.addEventListener('pointerup', end);
  note.element.addEventListener('pointercancel', end);
}

async function submitNoteEvent(noteId, action) {
  const note = notes.get(noteId);
  if (!note) return;

  try {
    await submitEvent(config, toEvent(note, action));
    note.pending = false;
    setSyncStatus('已送出，資料同步可能需要幾秒鐘。');
  } catch (error) {
    console.error(error);
    note.pending = true;
    setSyncStatus('已更新本機畫面，但 Google Form 送出可能失敗。', true);
  }
}

async function submitDeletedEvent(note) {
  try {
    await submitEvent(config, toEvent(note, 'delete'));
    setSyncStatus('已送出刪除事件，資料同步可能需要幾秒鐘。');
  } catch (error) {
    console.error(error);
    setSyncStatus('本機已刪除，但 Google Form 送出可能失敗。', true);
  }
}

function toEvent(note, action) {
  return {
    board_id: config.boardId,
    note_id: note.note_id,
    action,
    text: note.text || '',
    x: note.x,
    y: note.y,
    width: note.width,
    height: note.height,
    color: note.color || 'yellow',
    z_index: note.z_index || 1,
    timestamp_client: new Date().toISOString(),
  };
}

function updateBoardMeta() {
  const count = notes.size;
  noteCount.textContent = `${count} 張`;
  emptyState.classList.toggle('hidden', count > 0);
}

function setSyncStatus(message, isError = false) {
  syncStatus.textContent = message;
  syncStatus.classList.toggle('is-error', isError);
}

function nextZIndex() {
  maxZIndex += 1;
  return maxZIndex;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
