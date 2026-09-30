import { useCallback, useEffect, useState } from 'react';

const MIN_WIDTH = 320;
/** Siempre queda al menos esto para las tarjetas de proyectos. */
const MIN_FREE_SPACE = 360;

function readStored(key: string, fallback: number): number {
  try {
    const value = Number(window.localStorage.getItem(key));
    return Number.isFinite(value) && value >= MIN_WIDTH ? value : fallback;
  } catch {
    return fallback;
  }
}

function clamp(width: number): number {
  return Math.round(Math.min(Math.max(width, MIN_WIDTH), window.innerWidth - MIN_FREE_SPACE));
}

/**
 * Ancho de un panel lateral derecho que se ajusta arrastrando su borde izquierdo.
 * Se recuerda en este navegador; si el almacenamiento no está disponible, solo
 * dura mientras la página está abierta.
 */
export function useResizableWidth(storageKey: string, defaultWidth: number) {
  const [width, setWidth] = useState(() => readStored(storageKey, defaultWidth));
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, String(width));
    } catch {
      /* modo privado o almacenamiento bloqueado: no pasa nada */
    }
  }, [storageKey, width]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: PointerEvent) => setWidth(clamp(window.innerWidth - event.clientX));
    const onUp = () => setDragging(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    // Mientras se arrastra, que no se seleccione texto en toda la página.
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [dragging]);

  const startDrag = useCallback(() => setDragging(true), []);
  const reset = useCallback(() => setWidth(defaultWidth), [defaultWidth]);
  /** Alterna entre el ancho normal y casi toda la pantalla. */
  const toggleExpanded = useCallback(
    () => setWidth((current) => (current > defaultWidth * 1.4 ? defaultWidth : clamp(window.innerWidth * 0.75))),
    [defaultWidth],
  );

  return { width, dragging, startDrag, reset, toggleExpanded, expanded: width > defaultWidth * 1.4 };
}
