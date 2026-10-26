import { DnsForm } from "@/components/settings/dns-form";
import { SettingsSection } from "@/components/settings/settings-section";

export function DnsPage() {
  return <SettingsSection>{(props) => <DnsForm {...props} />}</SettingsSection>;
}
