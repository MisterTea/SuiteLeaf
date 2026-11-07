import { useCallback, useEffect, useRef, useState } from "react";
import type { MarpPages } from "./slide-marp-render";
import type { SlidesEditorState } from "./slide-editor-state";
import { CAST_NAMESPACE, castFrame, frameChunks, portableFrame, type CastFrame } from "./slide-cast-protocol";
import { castCancelled, castUnavailable, configureCast, loadCastSdk, type CastContext, type CastSession } from "./slide-cast-sdk";

/** A sender owns its session until the show ends or the editor unmounts. */
export function useSlideCast(state: SlidesEditorState, pages: MarpPages | null | undefined, beginShow: (index: number, notes: boolean, fullscreen: boolean) => void) {
  const appId = import.meta.env.VITE_SUITELEAF_CAST_APP_ID;
  const unavailable = castUnavailable(appId);
  const [reason, setReason] = useState<string | null>(unavailable ?? "Loading Google Cast…");
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [castError, setCastError] = useState("");
  const context = useRef<CastContext | null>(null);
  const session = useRef<CastSession | null>(null);
  const mounted = useRef(false);
  const request = useRef(0);
  const pending = useRef<CastFrame | null>(null);
  const sending = useRef(false);
  const { deck, showCursor, blankScreen, presenting } = state;

  const stopCast = useCallback(() => {
    request.current++;
    pending.current = null;
    if (session.current) context.current?.endCurrentSession(true);
    session.current = null;
    setConnected(false);
    setConnecting(false);
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (unavailable) return () => { mounted.current = false; };
    let active = true;
    let dispose: (() => void) | undefined;
    void loadCastSdk().then(() => {
      if (!active) return;
      const configured = configureCast(appId!);
      context.current = configured.context;
      const changed = () => {
        if (session.current && configured.context.getCurrentSession() !== session.current) {
          session.current = null;
          pending.current = null;
          setConnected(false);
          setCastError("Casting disconnected.");
        }
      };
      configured.context.addEventListener(configured.event, changed);
      dispose = () => configured.context.removeEventListener(configured.event, changed);
      setReason(null);
    }).catch((error: Error) => { if (active) setReason(error.message); });
    return () => {
      mounted.current = false;
      active = false;
      // This is a request generation, not a DOM ref; invalidate pending connections on cleanup.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      request.current++;
      dispose?.();
      if (session.current) context.current?.endCurrentSession(true);
      session.current = null;
      pending.current = null;
      context.current = null;
    };
  }, [appId, unavailable]);

  const startCast = (index: number) => {
    const target = context.current;
    if (reason || !target || connecting) return;
    const token = ++request.current;
    setCastError("");
    setConnecting(true);
    // Invoke directly from the menu selection to retain browser user activation.
    void target.requestSession().then(() => {
      if (!mounted.current || request.current !== token) {
        target.endCurrentSession(true);
        return;
      }
      const current = target.getCurrentSession();
      if (!current) throw new Error("The Cast device could not be connected.");
      session.current = current;
      setConnected(true);
      beginShow(index, true, false);
    }).catch((error: unknown) => {
      if (mounted.current && request.current === token && !castCancelled(error))
        setCastError("Could not start casting. Check that your Google Cast device is on the same Wi-Fi network and try again.");
    }).finally(() => { if (mounted.current && request.current === token) setConnecting(false); });
  };

  useEffect(() => {
    if (!presenting && connected) { stopCast(); return; }
    if (!connected || !presenting || !session.current) return;
    pending.current = castFrame(deck, showCursor.slideIndex, showCursor, blankScreen, pages);
    if (sending.current) return;
    sending.current = true;
    // Serialize transfers, coalescing fast navigation to the latest complete frame.
    void (async () => {
      try {
        while (pending.current && session.current) {
          const frame = pending.current;
          pending.current = null;
          const target = session.current;
          const chunks = frameChunks(await portableFrame(frame), crypto.randomUUID());
          for (const chunk of chunks) {
            if (target !== session.current) break;
            await target.sendMessage(CAST_NAMESPACE, chunk);
          }
        }
      } catch {
        if (mounted.current && session.current) {
          setCastError("The slide could not be sent to the Cast device. Try casting again.");
          stopCast();
        }
      } finally { sending.current = false; }
    })();
  }, [connected, presenting, deck, showCursor, blankScreen, pages, stopCast]);

  return { startCast, stopCast, castConnected: connected, castError, castReason: connecting ? "Connecting to Cast device…" : reason };
}
