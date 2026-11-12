export interface SmbProfile {
  id: string;
  name: string;
  folder: string;
  sharePath: string;
  driveLetter: string;
  favorite: boolean;
  tags: string[];
  description: string;
  createdAt: string;
  updatedAt: string;
}

export type SmbConnectionProfile = SmbProfile & {
  protocol: "smb";
  host: string;
  port: number;
  username: string;
};

export function smbConnectionProfile(profile: SmbProfile): SmbConnectionProfile {
  return { ...profile, protocol: "smb", host: profile.sharePath.split("\\")[2] ?? "", port: 445, username: "" };
}
