import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type { SshProfile } from '../models';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import { SelectMenu } from '../ui/SelectMenu';
import { ConnectionAddress } from '../ssh/ConnectionAddress';
import { profileIconName } from '../ssh/profileIcons';
import { buildConnectionFolders, isInConnectionFolder, renamedConnectionFolderPath, type ConnectionFolderNode } from '../ssh/connectionFolders';
import { RenameFolderDialog } from '../ssh/RenameFolderDialog';
import { RenameTagDialog } from '../ssh/RenameTagDialog';
import { filterSftpProfiles, type SftpSource } from './sftpLibrary';

type Group = { kind: 'folder' | 'tag'; value: string };
type Target = { kind: 'profile'; profile: SshProfile } | Group;
interface Props {
  profiles: SshProfile[]; selectedId?: string; loading: boolean; error: string | null;
  onOpen: (profile: SshProfile) => void; onOpenTerminal: (profile: SshProfile) => void;
  onCreate: (tags: string[], folder: string) => void;
  onEdit: (profile: SshProfile) => void; onClone: (profile: SshProfile) => void; onDelete: (profile: SshProfile) => void;
  onRenameFolder: (path: string, name: string) => Promise<void>; onRenameTag: (tag: string, name: string) => Promise<void>;
}
export function SftpConnectionSidebar({profiles, selectedId, loading, error, onOpen, onOpenTerminal, onCreate, onEdit, onClone, onDelete, onRenameFolder, onRenameTag}: Props) {
  const [query,setQuery] = useState('');
  const [source,setSource] = useState<SftpSource>('all');
  const [view,setView] = useState<'folder'|'tag'|'list'>('folder');
  const [expanded,setExpanded] = useState(new Set(['folder:']));
  const [selectedGroup,setSelectedGroup] = useState<Group>({kind:'folder',value:''});
  const [menu,setMenu] = useState<{target:Target;x:number;y:number}|null>(null);
  const [renaming,setRenaming] = useState<Group|null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement|null>(null);
  const filtered = filterSftpProfiles(profiles,source,query);
  const tags = [...new Set(profiles.flatMap(profile=>profile.tags))].sort((a,b)=>a.localeCompare(b));
  const folders = buildConnectionFolders(filtered);
  useEffect(()=> {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const outside = (event:PointerEvent) => {if(!menuRef.current?.contains(event.target as Node))setMenu(null);};
    const close = () => setMenu(null);
    document.addEventListener('pointerdown',outside); window.addEventListener('resize',close);
    return ()=>{document.removeEventListener('pointerdown',outside);window.removeEventListener('resize',close);};
  },[menu]);
  function showMenu(target:Target,element:HTMLElement,x:number,y:number) {
    triggerRef.current=element;
    setMenu({target,x:Math.max(8,Math.min(x,window.innerWidth-236)),y:Math.max(8,Math.min(y,window.innerHeight-224))});
  }
  function context(event:MouseEvent<HTMLElement>,target:Target) {event.preventDefault();showMenu(target,event.currentTarget,event.clientX,event.clientY);}
  function contextKey(event:KeyboardEvent<HTMLElement>,target:Target) {
    if(event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10')) {event.preventDefault();const rect=event.currentTarget.getBoundingClientRect();showMenu(target,event.currentTarget,rect.left,rect.bottom);}
  }
  function create(group=selectedGroup) {onCreate(group.kind==='tag'?[group.value]:[],group.kind==='folder'?group.value:'');}
  function toggle(group:Group) {
    setSelectedGroup(group);const key=`${group.kind}:${group.value}`;
    setExpanded(current=>{const next=new Set(current);if(next.has(key))next.delete(key);else next.add(key);return next;});
  }
  function row(profile:SshProfile) {
    return <li key={profile.id} className={`sftp-library__connection${profile.id===selectedId?' is-active':''}`} onContextMenu={event=>context(event,{kind:'profile',profile})}>
      <button className="sftp-library__open" type="button" title={`打开 ${profile.name} 的文件管理`} aria-label={`打开 SFTP ${profile.name}`} aria-current={profile.id===selectedId?'page':undefined}
        onClick={()=>onOpen(profile)} onKeyDown={event=>contextKey(event,{kind:'profile',profile})}>
        <span className="sftp-library__connection-title"><Icon name={profileIconName(profile.icon)} width="16" height="16"/><span title={profile.name}>{profile.name}</span><small title={profile.connectionType==='sftp'?'独立 SFTP 配置':'复用 SSH 配置'}>{profile.connectionType==='sftp'?'SFTP':'SSH'}</small></span>
        <ConnectionAddress address={`${profile.username}@${profile.host.includes(':')&&!profile.host.startsWith('[')?`[${profile.host}]`:profile.host}:${profile.port}`} focusable={false}/>
      </button>
      <div className="sftp-library__row-actions">
        <IconButton label={`打开 ${profile.name} 的 SSH 终端`} onClick={()=>onOpenTerminal(profile)}><Icon name="terminalTool" width="14" height="14"/></IconButton>
        <IconButton label={`${profile.name} 的操作`} aria-haspopup="menu" onClick={event=>{const rect=event.currentTarget.getBoundingClientRect();showMenu({kind:'profile',profile},event.currentTarget,rect.left,rect.bottom);}}><Icon name="ellipsis" width="14" height="14"/></IconButton>
      </div>
    </li>;
  }
  function folderNodes(nodes:ConnectionFolderNode[]) {
    return nodes.map(node=>{
      const group:Group={kind:'folder',value:node.path};const open=!!query.trim()||expanded.has(`folder:${node.path}`);
      return <li key={node.path}><button type="button" className="sftp-library__group" data-selected={selectedGroup.kind==='folder'&&selectedGroup.value===node.path} aria-expanded={open} title={node.path||'根目录'}
        onClick={()=>toggle(group)} onContextMenu={event=>context(event,group)} onKeyDown={event=>contextKey(event,group)}>
        <Icon name={node.path?'folder':'house'} height="15" width="15"/>
        <span>{node.name}</span><small>{node.count}</small><Icon className="sftp-library__chevron" name={open?'chevron-down':'chevron-right'} height="12" width="12"/></button>
        {open?<ul>{folderNodes(node.children)}{filtered.filter(profile=>(profile.folder??'')===node.path).map(row)}</ul>:null}</li>;
    });
  }
  const target=menu?.target;
  return <aside className="sidebar sftp-library is-glass-chrome" aria-label="SFTP 连接库">
    <header className="sftp-library__header">
      <div className="sftp-library__heading"><h2>SFTP</h2><span>{profiles.length}</span></div>
      <button className="sftp-library__new" type="button" onClick={()=>create()} aria-label="新建 SFTP 连接" title={selectedGroup.value ? `在${selectedGroup.kind==='folder'?'目录':'标签'}“${selectedGroup.value}”中新建 SFTP 连接` : '新建 SFTP 连接'}><Icon name="plus" width="14" height="14"/><span>新建</span></button>
    </header>
    <div className="sftp-library__search"><Icon name="search" width="14" height="14"/>
      <input aria-label="搜索 SFTP 连接" placeholder="搜索连接、目录或标签" value={query} onChange={event=>setQuery(event.target.value)} onKeyDown={event=>{if(event.key==='Escape'&&query){event.stopPropagation();setQuery('');}}}/>
      {query?<IconButton label="清除搜索" onClick={()=>setQuery('')}><Icon name="close" width="12" height="12"/></IconButton>:null}
    </div>
    <div className="sftp-library__filters">
      <SelectMenu ariaLabel="SFTP 来源" value={source} onChange={value=>setSource(value as SftpSource)} options={[{value:'all',label:'全部来源'},{value:'ssh',label:'来自 SSH'},{value:'sftp',label:'独立 SFTP'}]}/>
      <div className="sftp-library__views" role="group" aria-label="SFTP 分组方式">
        {([{id:'folder',label:'目录分组',icon:'folder'},{id:'tag',label:'标签分组',icon:'tag'},{id:'list',label:'平铺列表',icon:'connections'}] as const).map(option=><IconButton key={option.id} label={option.label} aria-pressed={view===option.id} active={view===option.id}
          onClick={()=>{setView(option.id);setSelectedGroup({kind:'folder',value:''});}}><Icon name={option.icon} width="14" height="14"/></IconButton>)}
      </div>
    </div>
    <div className="sftp-library__content">
      {error?<p className="form-errors" role="alert">{error}</p>:null}
      {loading?<p className="sftp-library__empty">正在加载连接…</p>:filtered.length===0?<div className="sftp-library__empty"><Icon name="folder" width="24" height="24"/><p>{profiles.length?'没有匹配的连接':'还没有 SFTP 连接'}</p><small>{profiles.length?'试试其他关键词或来源。':'新建 SFTP 连接，或保存一个 SSH 配置。'}</small><button className="button" type="button" onClick={()=>profiles.length?(setQuery(''),setSource('all')):create({kind:'folder',value:''})}>{profiles.length?'清除筛选':'新建 SFTP 连接'}</button></div>:
        <ul className="sftp-library__tree">{view==='folder'?folderNodes([{name:'根目录',path:'',count:filtered.length,children:folders}]):view==='list'?filtered.map(row):
          [...new Set(filtered.flatMap(profile=>profile.tags))].sort((a,b)=>a.localeCompare(b)).concat(filtered.some(profile=>!profile.tags.length)?['']:[]).map(tag=>{
            const group:Group={kind:'tag',value:tag};const open=!!query.trim()||expanded.has(`tag:${tag}`);
            const items=filtered.filter(profile=>tag?profile.tags.includes(tag):!profile.tags.length);
            return <li key={tag}><button type="button" className="sftp-library__group" aria-expanded={open} onClick={()=>tag?toggle(group):setExpanded(current=>{const next=new Set(current);if(next.has('tag:'))next.delete('tag:');else next.add('tag:');return next;})}
              onContextMenu={tag?event=>context(event,group):undefined} onKeyDown={tag?event=>contextKey(event,group):undefined}>
              <Icon name="tag" height="15" width="15"/><span>{tag||'无标签'}</span><small>{items.length}</small><Icon className="sftp-library__chevron" name={open?'chevron-down':'chevron-right'} height="12" width="12"/></button>{open?<ul>{items.map(row)}</ul>:null}</li>;
          })}</ul>}
    </div>
    <footer className="sftp-library__footer"><span>{query||source!=='all'?`${filtered.length} / ${profiles.length}`:profiles.length} 个连接</span><span>点击打开文件</span></footer>
    {menu?createPortal(<div className="context-menu is-glass-overlay" role="menu" aria-label="SFTP 连接操作" ref={menuRef} style={{left:menu.x,top:menu.y}}
      onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();setMenu(null);triggerRef.current?.focus();}else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const items=Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button')??[]);const index=items.indexOf(document.activeElement as HTMLButtonElement);items[event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();}}}>
      {target?.kind==='profile'?<>
        <button className="context-menu__item" role="menuitem" type="button" onClick={()=>{setMenu(null);onOpen(target.profile);}}><Icon name="folder"/>打开 SFTP</button>
        <button className="context-menu__item" role="menuitem" type="button" onClick={()=>{setMenu(null);onOpenTerminal(target.profile);}}><Icon name="terminalTool"/>打开 SSH 终端</button>
        <button className="context-menu__item" role="menuitem" type="button" onClick={()=>{setMenu(null);onEdit(target.profile);}}><Icon name="edit"/>编辑 {target.profile.connectionType==='sftp'?'SFTP':'SSH'} 配置</button>
        <button className="context-menu__item" role="menuitem" type="button" onClick={()=>{setMenu(null);onClone(target.profile);}}><Icon name="copy"/>克隆连接</button>
        <button className="context-menu__item" role="menuitem" type="button" onClick={()=>{setMenu(null);onDelete(target.profile);}}><Icon name="trash"/>删除共享配置</button>
      </>:target?<>
        <button className="context-menu__item" role="menuitem" type="button" onClick={()=>{setMenu(null);create(target);}}><Icon name="plus"/>在此新建 SFTP</button>
        {target.value?<button className="context-menu__item" role="menuitem" type="button" onClick={()=>{setMenu(null);setRenaming(target);}}><Icon name="edit"/>重命名{target.kind==='folder'?'目录':'标签'}</button>:null}
      </>:null}
    </div>,document.body):null}
    {renaming?.kind==='folder'?<RenameFolderDialog path={renaming.value} count={profiles.filter(profile=>isInConnectionFolder(profile,renaming.value)).length} onClose={()=>{setRenaming(null);triggerRef.current?.focus();}}
      onRename={async name=>{const oldPath=renaming.value;await onRenameFolder(oldPath,name);const path=renamedConnectionFolderPath(oldPath,name);setSelectedGroup({kind:'folder',value:path});setExpanded(current=>new Set([...current].map(key=>key===`folder:${oldPath}`||key.startsWith(`folder:${oldPath}/`)?`folder:${path}${key.slice(7+oldPath.length)}`:key)));}}/>:null}
    {renaming?.kind==='tag'?<RenameTagDialog tag={renaming.value} allTags={tags} count={profiles.filter(profile=>profile.tags.includes(renaming.value)).length} onClose={()=>{setRenaming(null);triggerRef.current?.focus();}}
      onRename={async name=>{await onRenameTag(renaming.value,name);setSelectedGroup({kind:'tag',value:name});setExpanded(current=>new Set([...current,`tag:${name}`]));}}/>:null}
  </aside>;
}
