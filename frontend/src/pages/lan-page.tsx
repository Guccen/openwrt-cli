import { LanForm } from "@/components/settings/lan-form";
import { SettingsSection } from "@/components/settings/settings-section";

export function LanPage() {
  return <SettingsSection>{(props) => <LanForm {...props} />}</SettingsSection>;
}
