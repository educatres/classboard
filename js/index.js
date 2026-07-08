import { FIELD_KEYS, buildBoardUrl, generateId } from './config.js';
import { renderQr } from './qr.js';

const form = document.querySelector('#setup-form');
const resultPanel = document.querySelector('#result-panel');
const studentLink = document.querySelector('#student-link');
const copyButton = document.querySelector('#copy-link');
const openBoard = document.querySelector('#open-board');
const copyStatus = document.querySelector('#copy-status');
const resetBoardIdButton = document.querySelector('#reset-board-id');
const qrCode = document.querySelector('#qr-code');
const prefillUrl = document.querySelector('#prefill-url');
const parsePrefillButton = document.querySelector('#parse-prefill');
const fillSampleMarkersButton = document.querySelector('#fill-sample-markers');
const prefillStatus = document.querySelector('#prefill-status');

let boardId = generateId('board');

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const values = readFormValues();
  const boardUrl = buildBoardUrl({ board_id: boardId, ...values });

  studentLink.value = boardUrl;
  openBoard.href = boardUrl;
  renderQr(qrCode, boardUrl);
  resultPanel.classList.remove('hidden');
  copyStatus.textContent = '白板連結已產生。';
});

resetBoardIdButton.addEventListener('click', () => {
  boardId = generateId('board');
  copyStatus.textContent = '已重產 board_id，請重新按「產生白板連結」。';
});

parsePrefillButton.addEventListener('click', () => {
  const result = parsePrefillUrl(prefillUrl.value);

  for (const [key, entryId] of Object.entries(result.fields)) {
    const input = form.elements.namedItem(`field_${key}`);
    if (input) input.value = entryId;
  }

  if (result.formUrl && !form.elements.namedItem('form_url').value.trim()) {
    form.elements.namedItem('form_url').value = result.formUrl;
  }

  if (result.missing.length === 0) {
    prefillStatus.textContent = '已自動帶入全部 entry ID。';
    return;
  }

  prefillStatus.textContent = `已帶入 ${Object.keys(result.fields).length} 個，還缺：${result.missing.join('、')}。請確認預填連結中每題的答案就是欄位名稱。`;
});

fillSampleMarkersButton.addEventListener('click', () => {
  prefillUrl.value = FIELD_KEYS.map((key) => key).join('\n');
  prefillStatus.textContent = '請在 Google Form 的預填連結頁，把每一題依序填成這些欄位名稱，再複製產生的預填連結貼回來。';
});

copyButton.addEventListener('click', async () => {
  if (!studentLink.value) return;

  try {
    await navigator.clipboard.writeText(studentLink.value);
    copyStatus.textContent = '已複製連結。';
  } catch {
    studentLink.select();
    document.execCommand('copy');
    copyStatus.textContent = '已選取並嘗試複製連結。';
  }
});

function readFormValues() {
  const formData = new FormData(form);
  const values = {
    sheet_id: clean(formData.get('sheet_id')),
    sheet_name: clean(formData.get('sheet_name')),
    gid: clean(formData.get('gid')),
    form_url: normalizeFormUrl(clean(formData.get('form_url'))),
  };

  for (const key of FIELD_KEYS) {
    values[`field_${key}`] = clean(formData.get(`field_${key}`));
  }

  return values;
}

function clean(value) {
  return String(value || '').trim();
}

function normalizeFormUrl(url) {
  if (!url) return '';
  return url.replace('/viewform', '/formResponse').replace('/edit', '/formResponse');
}

function parsePrefillUrl(rawUrl) {
  const fields = {};
  const missing = [];

  try {
    const url = new URL(rawUrl.trim());
    const formUrl = normalizeFormUrl(`${url.origin}${url.pathname}`);

    for (const [paramKey, paramValue] of url.searchParams.entries()) {
      if (!paramKey.startsWith('entry.')) continue;
      const normalizedValue = normalizeMarker(paramValue);
      const matchedKey = FIELD_KEYS.find((key) => normalizeMarker(key) === normalizedValue);
      if (matchedKey) fields[matchedKey] = paramKey;
    }

    for (const key of FIELD_KEYS) {
      if (!fields[key]) missing.push(key);
    }

    return { fields, missing, formUrl };
  } catch {
    return { fields, missing: [...FIELD_KEYS], formUrl: '' };
  }
}

function normalizeMarker(value) {
  return String(value || '').trim().toLowerCase().replaceAll('-', '_').replaceAll(' ', '_');
}
