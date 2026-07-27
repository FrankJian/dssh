export type AppStatus = "ok" | "starting";

export interface AppHealth {
  appName: string;
  version: string;
  status: AppStatus;
}
