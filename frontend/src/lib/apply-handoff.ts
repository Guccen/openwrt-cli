import { useRouter } from "../stores/router";
import { useSettings, type PendingApply } from "../stores/settings";
import { ipv4 } from "./settings";
import { CONFIGS } from "./config-client";

const channel = "router-ui-apply-v1";
let outgoing: {
  window: Window;
  nonce: string;
  pending: PendingApply;
  retry?: ReturnType<typeof setInterval>;
} | null = null;
let incoming: { origin: string; nonce: string; accepted: boolean } | null = null;

function stopRetry() {
  if (outgoing?.retry) clearInterval(outgoing.retry);
}

function validPending(value: unknown, source: string): value is PendingApply {
  if (!value || typeof value !== "object") return false;
  const p = value as PendingApply;
  return (
    p.oldOrigin === source &&
    p.newOrigin === window.location.origin &&
    typeof p.label === "string" &&
    p.label.length < 80 &&
    typeof p.deadline === "number" &&
    p.deadline > Date.now() &&
    p.deadline < Date.now() + 125000 &&
    typeof p.address === "string" &&
    ipv4(p.address) !== null &&
    typeof p.previousAddress === "string" &&
    ipv4(p.previousAddress) !== null &&
    Array.isArray(p.configs) &&
    p.configs.length > 0 &&
    p.configs.length <= CONFIGS.length &&
    p.configs.every((name) => CONFIGS.includes(name))
  );
}

export function registerApplyHandoff() {
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    if (window.opener && window.location.hash.startsWith("#apply=")) {
      const data = JSON.parse(decodeURIComponent(window.location.hash.slice(7)));
      const url = new URL(data.from);
      if (
        ["http:", "https:"].includes(url.protocol) &&
        data.from === url.origin &&
        /^[a-f0-9]{32}$/.test(data.nonce)
      )
        incoming = { origin: url.origin, nonce: data.nonce, accepted: false };
    }
  } catch {
    /* 无效的恢复链接不参与会话传递。 */
  }
  const listener = (event: MessageEvent) => {
    const data = event.data;
    if (!data || data.channel !== channel) return;
    if (
      outgoing &&
      event.source === outgoing.window &&
      event.origin === outgoing.pending.newOrigin &&
      data.nonce === outgoing.nonce
    ) {
      const state = useSettings.getState();
      if (
        data.type === "ready" &&
        state.session &&
        state.pending === outgoing.pending &&
        Date.now() < state.pending.deadline
      ) {
        stopRetry();
        outgoing.window.postMessage(
          {
            channel,
            type: "credentials",
            nonce: outgoing.nonce,
            session: state.session,
            pending: state.pending,
          },
          event.origin,
        );
      } else if (data.type === "confirmed") {
        stopRetry();
        useSettings.getState().completedElsewhere(event.origin);
        outgoing = null;
      } else if (data.type === "restored") {
        stopRetry();
        void useSettings.getState().rollback();
        outgoing = null;
      }
    }
    if (
      incoming &&
      !incoming.accepted &&
      event.source === window.opener &&
      event.origin === incoming.origin &&
      data.nonce === incoming.nonce &&
      data.type === "credentials" &&
      typeof data.session === "string" &&
      /^[a-f0-9]{32}$/.test(data.session) &&
      validPending(data.pending, event.origin)
    ) {
      if (timer) clearInterval(timer);
      incoming.accepted = true;
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      useSettings.getState().adopt(data.session, data.pending);
      useRouter.getState().adoptSession(data.session);
      void useRouter.getState().refresh();
    }
  };
  window.addEventListener("message", listener);
  if (incoming && !incoming.accepted) {
    const ready = () =>
      window.opener?.postMessage(
        { channel, type: "ready", nonce: incoming?.nonce },
        incoming!.origin,
      );
    ready();
    timer = setInterval(ready, 500);
  }
  return () => {
    window.removeEventListener("message", listener);
    if (timer) clearInterval(timer);
    stopRetry();
  };
}

export function openApplyAddress(pending: PendingApply) {
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const fragment = encodeURIComponent(JSON.stringify({ from: window.location.origin, nonce }));
  const address = `${pending.newOrigin}/#apply=${fragment}`;
  const popup = window.open(address, `router-apply-${nonce}`);
  if (!popup) throw new Error("浏览器阻止了新页面，请允许弹出窗口后重试；设备仍会在超时后恢复");
  stopRetry();
  // fragment 只包含来源和随机标记，会话只通过严格校验来源的 postMessage 在内存中传递。
  outgoing = { window: popup, nonce, pending };
  const transfer = outgoing;
  // netifd 可能尚未完成改址。首次导航失败后，在设备计时结束前重试同一窗口。
  transfer.retry = setInterval(() => {
    if (
      outgoing !== transfer ||
      popup.closed ||
      useSettings.getState().pending !== pending ||
      Date.now() >= pending.deadline
    ) {
      if (transfer.retry) clearInterval(transfer.retry);
      return;
    }
    try {
      popup.location.href = address;
    } catch {
      /* 页面可能正在导航，下一轮再试；不会自动确认设置。 */
    }
  }, 8000);
}

export function notifyApplyComplete(confirmed: boolean) {
  if (incoming && window.opener)
    window.opener.postMessage(
      { channel, type: confirmed ? "confirmed" : "restored", nonce: incoming.nonce },
      incoming.origin,
    );
}
