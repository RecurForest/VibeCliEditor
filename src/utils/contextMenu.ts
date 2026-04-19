import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

interface ContextMenuAnchor {
  x: number;
  y: number;
}

interface ContextMenuPosition {
  left: number;
  top: number;
}

const CONTEXT_MENU_VIEWPORT_MARGIN = 8;

export function useViewportConstrainedMenuPosition(
  anchor: ContextMenuAnchor | null,
  menuRef: RefObject<HTMLElement | null>,
) {
  const [position, setPosition] = useState<ContextMenuPosition | null>(null);

  useLayoutEffect(() => {
    if (!anchor) {
      setPosition(null);
      return;
    }

    const menuElement = menuRef.current;
    if (!menuElement) {
      setPosition({
        left: anchor.x,
        top: anchor.y,
      });
      return;
    }

    setPosition(resolveConstrainedPosition(anchor, menuElement));
  }, [anchor, menuRef]);

  useEffect(() => {
    if (!anchor) {
      return;
    }

    const currentAnchor = anchor;

    function handleViewportResize() {
      const menuElement = menuRef.current;
      if (!menuElement) {
        return;
      }

      setPosition(resolveConstrainedPosition(currentAnchor, menuElement));
    }

    window.addEventListener("resize", handleViewportResize);

    return () => {
      window.removeEventListener("resize", handleViewportResize);
    };
  }, [anchor, menuRef]);

  if (!anchor) {
    return undefined;
  }

  return position ?? {
    left: anchor.x,
    top: anchor.y,
  };
}

function resolveConstrainedPosition(anchor: ContextMenuAnchor, menuElement: HTMLElement) {
  const menuRect = menuElement.getBoundingClientRect();
  const maxLeft = Math.max(
    CONTEXT_MENU_VIEWPORT_MARGIN,
    window.innerWidth - menuRect.width - CONTEXT_MENU_VIEWPORT_MARGIN,
  );
  const maxTop = Math.max(
    CONTEXT_MENU_VIEWPORT_MARGIN,
    window.innerHeight - menuRect.height - CONTEXT_MENU_VIEWPORT_MARGIN,
  );

  return {
    left: clamp(anchor.x, CONTEXT_MENU_VIEWPORT_MARGIN, maxLeft),
    top: clamp(anchor.y, CONTEXT_MENU_VIEWPORT_MARGIN, maxTop),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
