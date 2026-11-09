import type { SshProfile } from '../models/sshProfile';
import { filterPaletteItems } from '../app/paletteSearch.ts';

export type SftpSource = 'all' | 'ssh' | 'sftp';
export function filterSftpProfiles(profiles: SshProfile[], source: SftpSource, query: string): SshProfile[] {
  const candidates = profiles.filter(profile => source === 'all' || (profile.connectionType ?? 'ssh') === source);
  const matches = new Set(filterPaletteItems(candidates.map(profile => ({ id: profile.id, label: profile.name,
    keywords: `${profile.username} ${profile.host} ${profile.port} ${profile.folder ?? ''} ${profile.tags.join(' ')} ${profile.description ?? ''}`, run: () => {} })), query).map(item => item.id));
  return candidates.filter(profile => matches.has(profile.id))
    .sort((a,b) => a.name.localeCompare(b.name, undefined, {numeric:true}) || a.id.localeCompare(b.id));
}
