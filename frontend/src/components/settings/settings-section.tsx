import { useEffect, useState, type ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorAlert } from "@/components/status/error-alert";
import { lanDraft, type ConfigPlan, type SettingsSnapshot } from "@/lib/settings";
import { useSettings } from "@/stores/settings";
import { ApplyReviewDialog } from "./apply-review-dialog";

export interface SettingsFormProps {
  snapshot: SettingsSnapshot;
  disabled: boolean;
  review: (makePlan: () => ConfigPlan) => void;
}
export function SettingsSection({
  children,
}: {
  children: (props: SettingsFormProps) => ReactNode;
}) {
  const {
    session,
    snapshot,
    load,
    loading,
    pending,
    staged,
    discard,
    apply,
    error,
    destination,
    revision,
  } = useSettings();
  const [candidate, setCandidate] = useState<{ plan: ConfigPlan; revision: number } | null>(null);
  const [invalid, setInvalid] = useState<{ message: string; revision: number } | null>(null);
  const [initialRevision] = useState(revision);
  const ready = revision > initialRevision;
  const plan = candidate?.revision === revision ? candidate.plan : null;
  const validation = invalid?.revision === revision ? invalid.message : null;
  useEffect(() => {
    // 路由切换时先读取当前配置，避免用户输入被稍后到达的 revision 更新清空。
    if (session) void load();
  }, [load, session]);
  const review: SettingsFormProps["review"] = (makePlan) => {
    try {
      const value = makePlan();
      if (!value.edits.length) throw new Error("没有需要应用的改动");
      setCandidate({ plan: value, revision });
      setInvalid(null);
    } catch (e) {
      setInvalid({ message: e instanceof Error ? e.message : "请检查输入", revision });
    }
  };
  let unsupported: string | null = null;
  try {
    if (snapshot) lanDraft(snapshot);
  } catch (e) {
    unsupported = e instanceof Error ? e.message : "无法读取配置";
  }
  const disabled = loading || !!pending || staged || !!destination;
  return (
    <div className="space-y-3">
      <ErrorAlert message={validation || error || unsupported} />
      {staged && !pending && (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            当前会话有未应用改动，请先丢弃；如果设备仍在恢复中，请稍后重试。
            <Button size="sm" variant="outline" disabled={loading} onClick={() => void discard()}>
              丢弃暂存改动
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {(!ready || !snapshot) && !pending && !error && <Skeleton className="h-64" />}
      {ready && snapshot && !unsupported && (
        <div key={revision}>{children({ snapshot, disabled, review })}</div>
      )}
      <ApplyReviewDialog
        plan={plan}
        currentAddress={snapshot ? String(snapshot.network.lan.ipaddr) : undefined}
        onClose={() => setCandidate(null)}
        onApply={(value) => void apply(value, window.location.origin)}
      />
    </div>
  );
}
