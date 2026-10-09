"use client";

import { Copy, Download, Pencil, Reply, TextSelect, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { haptic } from "@/lib/chatClient";
import { createLongPress, menuActions, placeMenu, plainText, showFeedback, type Feedback, type MenuActionId } from "@/lib/messageMenu";

/** What a long-pressed bubble carries into the menu. */
export type MenuTarget = {
  key: string;
  role: "user" | "assistant";
  content: string;
  messageId?: number;
  feedback?: Feedback | null;
  /** First image attachment (data URL thumb) offered for Download. */
  image?: { src: string; name: string };
  canEdit?: boolean;
};

type Opened = { target: MenuTarget; element: HTMLElement; rowClass: string; point: { x: number; y: number } };

/**
 * Long-press (≈450ms, touch or mouse) or right-click on a bubble opens the menu.
 * bind(target) returns the handlers to spread on the bubble element.
 */
export function useMessageMenu() {
  const [opened, setOpened] = useState<Opened | null>(null);
  const openRef = useRef(false);
  const historyRef = useRef(false);
  const pressRef = useRef<{ element: HTMLElement; target: MenuTarget } | null>(null);

  const open = useCallback((element: HTMLElement, target: MenuTarget, point: { x: number; y: number }) => {
    if (openRef.current) return;
    openRef.current = true;
    haptic(10);
    try { window.getSelection()?.removeAllRanges(); } catch { /* ignore */ }
    // Back gesture closes the menu: a same-URL history entry that keeps the router's own state.
    try { window.history.pushState({ ...(window.history.state || {}), elMenu: true }, "", window.location.href); historyRef.current = true; } catch { historyRef.current = false; }
    const row = element.closest(".el-row");
    setOpened({ target, element, rowClass: row ? row.className : "", point });
  }, []);

  const close = useCallback(() => {
    if (!openRef.current) return;
    openRef.current = false;
    setOpened(null);
    if (historyRef.current) { historyRef.current = false; if (window.history.state?.elMenu) window.history.back(); }
  }, []);

  useEffect(() => {
    const onPop = () => { if (!historyRef.current) return; historyRef.current = false; openRef.current = false; setOpened(null); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const [press] = useState(() => createLongPress({ onFire: (point) => { const current = pressRef.current; if (current) open(current.element, current.target, point); } }));

  const bind = useCallback((target: MenuTarget) => ({
    "data-menu-bubble": "",
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      pressRef.current = { element: event.currentTarget, target };
      press.down(event.clientX, event.clientY);
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => press.move(event.clientX, event.clientY),
    onPointerUp: () => press.up(),
    onPointerCancel: () => press.cancel(),
    onPointerLeave: () => press.cancel(),
    onContextMenu: (event: ReactMouseEvent<HTMLElement>) => {
      // Right-click, or Android's own long-press event (which may land after our timer already opened the menu).
      event.preventDefault();
      press.cancel();
      open(event.currentTarget, target, { x: event.clientX, y: event.clientY });
    },
    onClickCapture: (event: ReactMouseEvent<HTMLElement>) => {
      // The click that ends a long-press must not follow links, copy code or fold sections.
      if (press.consumeFired()) { event.preventDefault(); event.stopPropagation(); }
    },
  }), [open, press]);

  return { opened, bind, close };
}

const ICONS: Record<MenuActionId, typeof Copy> = { copy: Copy, select: TextSelect, reply: Reply, edit: Pencil, download: Download };

export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back */ }
  try {
    const area = document.createElement("textarea");
    area.value = text; area.setAttribute("readonly", ""); area.style.position = "fixed"; area.style.opacity = "0";
    document.body.appendChild(area); area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch { return false; }
}

/** Blurred backdrop, the pressed bubble kept sharp in place, and the menu card under (or above) it. */
export function MessageMenu({ opened, onClose, onAction, onFeedback }: { opened: Opened; onClose: () => void; onAction: (action: MenuActionId, target: MenuTarget) => void; onFeedback: (rating: Feedback | null, target: MenuTarget) => void }) {
  const { target, element, rowClass, point } = opened;
  const menuRef = useRef<HTMLDivElement>(null);
  const cloneHost = useRef<HTMLDivElement>(null);
  const [rect] = useState(() => element.getBoundingClientRect());
  const [position, setPosition] = useState<{ top: number; left: number; side: string } | null>(null);
  const hasText = Boolean(target.content.trim());
  const actions = menuActions({ role: target.role, hasText, hasImage: Boolean(target.image), canEdit: target.canEdit });
  const feedback = showFeedback({ role: target.role, hasText, messageId: target.messageId });

  // Keep the pressed bubble sharp: a non-interactive copy above the blur at the same spot.
  useLayoutEffect(() => {
    const host = cloneHost.current;
    if (!host) return;
    const copy = element.cloneNode(true) as HTMLElement;
    copy.removeAttribute("id");
    copy.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
    copy.setAttribute("aria-hidden", "true");
    copy.classList.add("el-menu-clone-bubble");
    host.replaceChildren(copy);
  }, [element]);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const box = menu.getBoundingClientRect();
    setPosition(placeMenu({ rect, menuWidth: box.width, menuHeight: box.height, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight, align: target.role === "user" ? "end" : "start", pressY: point.y }));
  }, [rect, target.role, point.y]);

  const close = onClose;

  // Focus the first item; Escape closes; Tab stays inside; arrows move between items.
  useEffect(() => {
    const menu = menuRef.current;
    const previous = document.activeElement as HTMLElement | null;
    const items = () => Array.from(menu?.querySelectorAll<HTMLElement>("[role=menuitem],[role=menuitemradio]") || []);
    items()[0]?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      const list = items();
      if (!list.length) return;
      const index = list.indexOf(document.activeElement as HTMLElement);
      if (event.key === "Tab") { event.preventDefault(); list[(index + (event.shiftKey ? -1 : 1) + list.length) % list.length].focus(); }
      else if (event.key === "ArrowDown" || event.key === "ArrowRight") { event.preventDefault(); list[(index + 1) % list.length].focus(); }
      else if (event.key === "ArrowUp" || event.key === "ArrowLeft") { event.preventDefault(); list[(index - 1 + list.length) % list.length].focus(); }
      else if (event.key === "Home") { event.preventDefault(); list[0].focus(); }
      else if (event.key === "End") { event.preventDefault(); list[list.length - 1].focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // Give focus back unless an action (Reply, Edit) already moved it somewhere useful.
      const active = document.activeElement;
      if ((!active || active === document.body || menu?.contains(active)) && previous && !/^(INPUT|TEXTAREA)$/.test(previous.tagName)) { try { previous?.focus({ preventScroll: true }); } catch { /* gone */ } }
    };
  }, [close]);

  // A scroll or resize underneath moves the bubble: just close.
  useEffect(() => {
    const onResize = () => close();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [close]);

  const cloneStyle: CSSProperties = { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
  const menuStyle: CSSProperties = position ? { top: position.top, left: position.left } : { top: -9999, left: -9999, visibility: "hidden" };
  const pick = (action: MenuActionId) => { close(); onAction(action, target); };
  const rate = (rating: Feedback) => { onFeedback(target.feedback === rating ? null : rating, target); close(); };

  return createPortal(<div className="el-menu-layer">
    <div className="el-menu-backdrop" aria-hidden="true" onPointerDown={(event) => { event.preventDefault(); close(); }} onContextMenu={(event) => { event.preventDefault(); close(); }} />
    <div className={`el-menu-clone ${rowClass}`} style={cloneStyle} ref={cloneHost} aria-hidden="true" />
    <div ref={menuRef} className={`el-msg-menu ${position?.side || ""}`} style={menuStyle} role="menu" aria-label={target.role === "assistant" ? "Message from Elias" : "Your message"} aria-orientation="vertical">
      {feedback ? <>
        <div className="el-msg-menu-rate" role="group" aria-label="Rate this reply">
          <button type="button" role="menuitemradio" aria-checked={target.feedback === "up"} aria-label="Good reply" className={target.feedback === "up" ? "on" : ""} onClick={() => rate("up")}><ThumbsUp size={20} /></button>
          <button type="button" role="menuitemradio" aria-checked={target.feedback === "down"} aria-label="Bad reply" className={target.feedback === "down" ? "on" : ""} onClick={() => rate("down")}><ThumbsDown size={20} /></button>
        </div>
        {actions.length ? <div className="el-msg-menu-divider" role="separator" /> : null}
      </> : null}
      {actions.map((item) => { const Icon = ICONS[item.id]; return <button key={item.id} type="button" role="menuitem" className="el-msg-menu-item" onClick={() => pick(item.id)}><span>{item.label}</span><Icon size={19} aria-hidden="true" /></button>; })}
    </div>
  </div>, document.body);
}

/** Bottom sheet with the message as plain, freely selectable text. */
export function SelectTextSheet({ text, onClose }: { text: string; onClose: () => void }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    bodyRef.current?.focus({ preventScroll: true });
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return <div className="el-overlay el-overlay-sheet" onClick={onClose}>
    <section className="el-sheet el-select-sheet" role="dialog" aria-modal="true" aria-label="Select text" onClick={(event) => event.stopPropagation()}>
      <span className="el-sheet-grip" aria-hidden="true" />
      <header className="el-sheet-head"><TextSelect size={18} /><strong>Select text</strong><button type="button" className="el-icon-btn" onClick={onClose} aria-label="Close"><X size={19} /></button></header>
      <div ref={bodyRef} className="el-select-text" tabIndex={0}>{plainText(text)}</div>
    </section>
  </div>;
}

/** Small transient pill ("Copied"). */
export function MenuToast({ text }: { text: string | null }) {
  return text ? <div className="el-menu-toast" role="status" aria-live="polite">{text}</div> : null;
}
