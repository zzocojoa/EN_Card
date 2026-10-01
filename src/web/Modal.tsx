import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';

type Props = {
  label: string;
  busy: boolean;
  returnFocus: HTMLElement | null;
  onClose: () => void;
  children: ReactNode;
};

export function Modal({ label, busy, returnFocus, onClose, children }: Props): ReactElement {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    const opener =
      returnFocus ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    node.showModal();
    node.querySelector<HTMLElement>('h2')?.focus();
    return () => {
      node.close();
      if (opener?.isConnected) opener.focus();
    };
  }, [returnFocus]);
  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-label={label}
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'a[href],button,input,select,textarea,[tabindex]',
          ),
        ).filter(
          (node) =>
            node.tabIndex >= 0 && !node.matches(':disabled') && node.getClientRects().length > 0,
        );
        const first = controls[0];
        const last = controls.at(-1);
        const active = document.activeElement;
        if (!first) {
          event.preventDefault();
          event.currentTarget.querySelector<HTMLElement>('h2')?.focus();
        } else if (
          event.shiftKey &&
          (active === first || !controls.some((node) => node === active))
        ) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      {children}
    </dialog>
  );
}
