import type { SettingsSnapshot } from "../../frontend/src/lib/settings";

export function settingsFixture(bypass = false): SettingsSnapshot {
  return {
    network: {
      lan: {
        ".type": "interface",
        proto: "static",
        device: "br-lan",
        ipaddr: bypass ? "192.168.68.2" : "192.168.69.1",
        netmask: "255.255.255.0",
        ...(bypass ? { gateway: "192.168.68.1", dns: ["192.168.68.1"] } : {}),
      },
    },
    dhcp: {
      cfg01411c: { ".type": "dnsmasq", domain: "lan", noresolv: "0" },
      lan: {
        ".type": "dhcp",
        interface: "lan",
        ignore: bypass ? "1" : "0",
        start: "100",
        limit: "150",
      },
    },
    wireless: {
      radio0: { ".type": "wifi-device", band: "2g", disabled: "1" },
      default_radio0: {
        ".type": "wifi-iface",
        device: "radio0",
        network: "lan",
        mode: "ap",
        encryption: "none",
        ssid: "OpenWrt-demo",
        disabled: "0",
      },
    },
  };
}
