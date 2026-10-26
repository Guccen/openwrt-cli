import { BackupForm } from "@/components/settings/backup-form";
import { SettingsSection } from "@/components/settings/settings-section";

export function BackupPage() {
  return <SettingsSection>{(props) => <BackupForm {...props} />}</SettingsSection>;
}
