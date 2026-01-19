'use client';

export const COLOR_EDIT_MODE_KEY = 'masterHub.ui:colorEditMode';

export function readColorEditMode(): boolean {
  try {
    const v = (window.localStorage.getItem(COLOR_EDIT_MODE_KEY) ?? '').trim();
    return v === '1';
  } catch {
    return false;
  }
}

export function writeColorEditMode(next: boolean) {
  try {
    window.localStorage.setItem(COLOR_EDIT_MODE_KEY, next ? '1' : '0');
    window.dispatchEvent(new CustomEvent('masterHub:colorEditModeUpdated'));
  } catch {
    // ignore
  }
}
