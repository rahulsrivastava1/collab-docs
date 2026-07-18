import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true",
  );
}

type UseDialogFocusOptions = {
  open: boolean;
  onClose: () => void;
  /** Element to focus first; defaults to first focusable inside container */
  initialFocusRef?: RefObject<HTMLElement | null>;
};

/**
 * Escape close, focus trap, restore focus, and body scroll lock for modal dialogs.
 */
export function useDialogFocus(
  containerRef: RefObject<HTMLElement | null>,
  { open, onClose, initialFocusRef }: UseDialogFocusOptions,
) {
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    previousFocusRef.current = document.activeElement as HTMLElement | null;
    document.body.classList.add("dialog-open");

    const container = containerRef.current;
    const focusTarget =
      initialFocusRef?.current ?? (container ? getFocusable(container)[0] : null);

    // Defer so the dialog DOM is painted
    const frame = window.requestAnimationFrame(() => {
      focusTarget?.focus();
    });

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== "Tab" || !containerRef.current) return;

      const focusable = getFocusable(containerRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (active === first || !containerRef.current.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !containerRef.current.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown, true);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown, true);
      document.body.classList.remove("dialog-open");
      previousFocusRef.current?.focus?.();
    };
  }, [open, onClose, containerRef, initialFocusRef]);
}
