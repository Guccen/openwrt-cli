import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { registerApplyHandoff } from "./lib/apply-handoff";
import { bindSettingsSession } from "./stores/session-binding";
import { bindNotifications } from "./stores/notification-binding";
import { Toaster } from "./components/ui/sonner";
import "./index.css";

// 路由会在首次布局阶段跳转，必须先读取改址链接并接收原会话。
const cleanupBinding = bindSettingsSession();
const cleanupHandoff = registerApplyHandoff();
const cleanupNotifications = bindNotifications();
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    cleanupHandoff();
    cleanupNotifications();
    cleanupBinding();
  });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <Toaster />
  </StrictMode>,
);
