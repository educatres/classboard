export function enableBoardPan(board) {
  board.addEventListener('pointerdown', (event) => {
    if (!shouldPanBoard(event)) return;

    event.preventDefault();
    const start = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      scrollLeft: board.scrollLeft,
      scrollTop: board.scrollTop,
    };

    board.classList.add('is-panning');
    board.setPointerCapture(event.pointerId);

    const move = (moveEvent) => {
      if (moveEvent.pointerId !== start.pointerId) return;
      board.scrollLeft = start.scrollLeft - (moveEvent.clientX - start.x);
      board.scrollTop = start.scrollTop - (moveEvent.clientY - start.y);
    };

    const end = (endEvent) => {
      if (endEvent.pointerId !== start.pointerId) return;
      board.classList.remove('is-panning');
      board.removeEventListener('pointermove', move);
      board.removeEventListener('pointerup', end);
      board.removeEventListener('pointercancel', end);
    };

    board.addEventListener('pointermove', move);
    board.addEventListener('pointerup', end);
    board.addEventListener('pointercancel', end);
  });
}

function shouldPanBoard(event) {
  if (!event.isPrimary || event.button !== 0) return false;
  if (event.target.closest('.note, button, a, input, textarea, select')) return false;
  return true;
}
