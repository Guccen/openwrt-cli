import type { CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from "lucide-react";

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      position="top-right"
      visibleToasts={3}
      closeButton
      richColors
      offset={{
        top: "calc(env(safe-area-inset-top) + 16px)",
        right: "calc(env(safe-area-inset-right) + 16px)",
      }}
      mobileOffset={{
        top: "calc(env(safe-area-inset-top) + 12px)",
        left: "calc(max(env(safe-area-inset-left), env(safe-area-inset-right)) + 12px)",
        right: "calc(max(env(safe-area-inset-left), env(safe-area-inset-right)) + 12px)",
      }}
      containerAriaLabel="操作通知"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as CSSProperties
      }
      toastOptions={{
        closeButtonAriaLabel: "关闭通知",
        classNames: {
          toast: "cn-toast",
          title: "break-words",
          description: "break-words",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
