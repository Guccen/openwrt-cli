import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { ConfigPlan } from "@/lib/settings";

export function ApplyReviewDialog({
  plan,
  currentAddress,
  onClose,
  onApply,
}: {
  plan: ConfigPlan | null;
  currentAddress?: string;
  onClose: () => void;
  onApply: (plan: ConfigPlan) => void;
}) {
  return (
    <AlertDialog
      open={!!plan}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认应用{plan?.label}</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-medium text-destructive">
              应用后有 120 秒确认连接，未确认会自动恢复。
            </span>
            请不要在确认前关闭或刷新页面。
            {plan &&
              currentAddress &&
              plan.address !== currentAddress &&
              ` 新管理地址：${plan.address}。`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              if (plan) onApply(plan);
            }}
          >
            应用并开始计时
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
