/**
 * Self-contained DOM dialog widgets: a non-blocking toast and a confirmation
 * modal. Both are pure presentation — they take a message (and, for confirm, a
 * callback) and know nothing about game state or sockets.
 */

// Module-scoped so repeated toasts reuse/replace the same dismissal timer.
let toastTimer: number | null = null;

/** Non-blocking notification, replacing native alert() dialogs. */
export function showToast(message: string, type: 'error' | 'info' = 'info'): void {
  const toast = document.getElementById('toast');
  if (!toast) {
    return;
  }

  toast.textContent = message;
  toast.className = `toast show toast-${type}`;

  if (toastTimer !== null) {
    window.clearTimeout(toastTimer);
  }
  toastTimer = window.setTimeout(() => {
    toast.className = 'toast';
  }, 3200);
}

/** Lightweight in-UI confirmation dialog (no native confirm()). */
export function showConfirm(
  message: string,
  onConfirm: () => void,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel'
): void {
  document.getElementById('confirmDialog')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'confirmDialog';
  overlay.className = 'modal-overlay';

  const card = document.createElement('div');
  card.className = 'modal-card';

  const text = document.createElement('p');
  text.className = 'modal-message';
  text.textContent = message;

  const actions = document.createElement('div');
  actions.className = 'modal-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn btn-secondary';
  cancelBtn.textContent = cancelLabel;

  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'btn btn-danger';
  confirmBtn.textContent = confirmLabel;

  const cleanup: Array<() => void> = [];
  const close = (): void => {
    overlay.remove();
    cleanup.forEach(fn => fn());
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      close();
    }
  };
  document.addEventListener('keydown', onKey);
  cleanup.push(() => document.removeEventListener('keydown', onKey));

  cancelBtn.addEventListener('click', close);
  confirmBtn.addEventListener('click', () => {
    close();
    onConfirm();
  });
  overlay.addEventListener('click', event => {
    if (event.target === overlay) {
      close();
    }
  });

  actions.append(cancelBtn, confirmBtn);
  card.append(text, actions);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}
