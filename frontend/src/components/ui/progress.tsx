import * as React from "react";
import { cn } from "cn";
import { Progress as ProgressPrimitive } from "radix-ui";

function Progress({
  className,
  value,
  max = 100,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  const limit = Number.isFinite(max) && max > 0 ? max : 100;
  const current =
    value === null
      ? null
      : Math.max(
          0,
          Math.min(limit, typeof value === "number" && Number.isFinite(value) ? value : 0),
        );
  const percent = ((current ?? 0) / limit) * 100;
  const color =
    percent >= 90
      ? "bg-rose-500 dark:bg-rose-400"
      : percent >= 75
        ? "bg-amber-500 dark:bg-amber-400"
        : "bg-blue-500 dark:bg-blue-400";
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={current}
      max={limit}
      className={cn(
        "relative flex h-1 w-full items-center overflow-x-hidden rounded-md bg-muted",
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn(
          "size-full flex-1 transition-transform duration-300 motion-reduce:transition-none",
          color,
        )}
        style={{ transform: `translateX(-${100 - percent}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
