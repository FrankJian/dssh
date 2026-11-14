import type { ComponentPropsWithoutRef } from "react";

type SettingsSwitchProps = Omit<ComponentPropsWithoutRef<"input">, "type" | "role" | "className">;

export function SettingsSwitch(props: SettingsSwitchProps) {
  return <input {...props} className="settings-switch" type="checkbox" role="switch" />;
}
