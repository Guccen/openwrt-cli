import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { reservations, reservationPlan, type Reservation } from "@/lib/reservations";
import type { SettingsFormProps } from "./settings-section";

function Row({
  initial,
  snapshot,
  disabled,
  review,
}: SettingsFormProps & { initial: Reservation }) {
  const [draft, setDraft] = useState(initial);
  return (
    <form
      className="space-y-3 rounded-lg border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        review(() => reservationPlan(snapshot, draft));
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        {(
          [
            ["name", "主机名（可选）"],
            ["mac", "MAC 地址"],
            ["ip", "保留 IPv4 地址"],
          ] as const
        ).map(([key, title]) => (
          <div className="space-y-1.5" key={key}>
            <Label htmlFor={`reservation-${initial.section || "new"}-${key}`}>{title}</Label>
            <Input
              id={`reservation-${initial.section || "new"}-${key}`}
              disabled={disabled || !initial.editable}
              required={key !== "name"}
              autoComplete="off"
              value={draft[key]}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
            />
          </div>
        ))}
      </div>
      {initial.editable ? (
        <div className="flex flex-wrap gap-2">
          <Button disabled={disabled}>{initial.section ? "保存地址保留" : "添加地址保留"}</Button>
          {initial.section && (
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={() => review(() => reservationPlan(snapshot, draft, true))}
            >
              删除地址保留
            </Button>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">此记录包含高级选项，请通过 SSH 管理。</p>
      )}
    </form>
  );
}
export function ReservationsForm(props: SettingsFormProps) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>DHCP 地址保留</CardTitle>
        <CardDescription>
          按 MAC 分配固定 IPv4 地址。客户端重新获取租约后生效；设备使用随机 MAC
          时需先固定其私有地址。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {reservations(props.snapshot).map((row) => (
          <Row {...props} key={row.section} initial={row} />
        ))}
        <Row {...props} initial={{ section: "", name: "", mac: "", ip: "", editable: true }} />
      </CardContent>
    </Card>
  );
}
