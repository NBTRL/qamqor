import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Modal } from './ui';
describe('Modal', () => {
  it('renders an accessible dialog, closes with Escape and restores focus', () => {
    const close = vi.fn();
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const view = render(
      <Modal open onClose={close} title="Окно">
        <button>Содержимое</button>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Окно' });
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(close).toHaveBeenCalledOnce();
    view.rerender(
      <Modal open={false} onClose={close} title="Окно">
        Текст
      </Modal>,
    );
    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
  it('closes by the close button and backdrop but not content clicks', () => {
    const close = vi.fn();
    render(
      <Modal open onClose={close} title="Проверка">
        <p>Текст</p>
      </Modal>,
    );
    fireEvent.click(screen.getByText('Текст'));
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть окно' }));
    fireEvent.click(screen.getByRole('dialog'));
    expect(close).toHaveBeenCalledTimes(2);
  });
});
