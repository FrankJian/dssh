import test from 'node:test';
import assert from 'node:assert/strict';
import { connectionGroupPaletteItems, connectionSearchKeywords } from './connectionPalette.ts';
import { filterPaletteItems } from './paletteSearch.ts';

const profiles = [
  { folder: 'home/production/web', tags: ['web', 'production'], host: 'api.example.test', username: 'deploy' },
  { folder: 'home/production/database', tags: ['production'], host: 'db.example.test' },
  { folder: 'home/staging', tags: ['web'], host: 'stage.example.test' },
  { folder: 'other', tags: [], host: 'other.example.test' },
];

test('palette contains ancestor directories and distinct tag groups with correct counts and destinations', () => {
  let selected;
  const items = connectionGroupPaletteItems(profiles, scope => selected = scope);
  assert.equal(items.filter(item => item.id === 'conn-group:tag:production').length, 1);
  const home = items.find(item => item.id === 'conn-group:folder:home');
  assert.match(home.hint, /3 个连接/);
  const production = items.find(item => item.id === 'conn-group:folder:home/production');
  assert.match(production.hint, /2 个连接/);
  production.run();
  assert.equal(selected, 'folder:home/production');
  const tag = items.find(item => item.id === 'conn-group:tag:production');
  tag.run();
  assert.equal(selected, 'tag:production');
  assert.deepEqual(connectionGroupPaletteItems([], () => {}), []);
});

test('directory and tag groups support case-insensitive fuzzy and multiword queries', () => {
  const items = connectionGroupPaletteItems(profiles, () => {});
  assert.ok(filterPaletteItems(items, 'HMPRDWB').some(item => item.id === 'conn-group:folder:home/production/web'));
  assert.ok(filterPaletteItems(items, 'web prod').some(item => item.id === 'conn-group:folder:home/production/web'));
  assert.ok(filterPaletteItems(items, '标签 prd').some(item => item.id === 'conn-group:tag:production'));
  assert.ok(filterPaletteItems(items, 'HOME\\production').some(item => item.id === 'conn-group:folder:home/production'));
  assert.deepEqual(filterPaletteItems(items, 'home nonexistent'), []);
});

test('connection results match directories and tags without depending on keyword order', () => {
  const items = profiles.map((profile, index) => ({ label: `连接 SSH：Server ${index}`, keywords: connectionSearchKeywords(profile) }));
  assert.deepEqual(filterPaletteItems(items, 'WEB PROD').map(item => item.label), ['连接 SSH：Server 0']);
  assert.deepEqual(filterPaletteItems(items, 'database production').map(item => item.label), ['连接 SSH：Server 1']);
  assert.equal(filterPaletteItems(items, 'web deploy').length, 1);
});

test('exact contiguous names rank above subsequences and empty search preserves item order', () => {
  const items = [{ label: 'Production', keywords: 'web' }, { label: 'prd' }, { label: 'Other', keywords: 'prd' }];
  assert.deepEqual(filterPaletteItems(items, '  '), items);
  assert.deepEqual(filterPaletteItems(items, 'prd').map(item => item.label), ['prd', 'Other', 'Production']);
});

test('Chinese directories and tags remain searchable', () => {
  const items = connectionGroupPaletteItems([{ folder: '生产/华东/应用', tags: ['核心服务'] }], () => {});
  assert.ok(filterPaletteItems(items, '华东 生产').some(item => item.label === '目录：生产/华东'));
  assert.ok(filterPaletteItems(items, '标签 核服').some(item => item.label === '标签：核心服务'));
});

test('tag matches expose open and edit actions for every matching connection ahead of group navigation', async () => {
  const { connectionActionPaletteItems } = await import('./connectionPalette.ts');
  const sources = [
    ...profiles.map((profile, index) => ({ ...profile, id: `ssh-${index}`, name: `Server ${index}`, port: 22, username: 'deploy' })),
    { id: 'rdp-test', protocol: 'rdp', name: 'Desktop', host: 'windows.test', port: 3389, username: 'operator', folder: 'home/windows', tags: ['production'] },
    { id: 'jms-test', protocol: 'jumpserver', name: 'Platform', coreUrl: 'https://jms.test', folder: 'home/gateways', tags: [] },
  ];
  const calls = [];
  const actions = connectionActionPaletteItems(sources, { onOpen: profile => calls.push(['open', profile.id]), onEdit: profile => calls.push(['edit', profile.id]) });
  const groups = connectionGroupPaletteItems(sources, () => calls.push(['group']));
  const results = filterPaletteItems([...groups, ...actions], '标签 production');
  const operationResults = results.filter(item => !item.id.startsWith('conn-group:'));
  assert.equal(operationResults.length, 6);
  assert.ok(results.slice(0, 6).every(item => !item.id.startsWith('conn-group:')));
  for (const id of ['ssh-0', 'ssh-1', 'rdp-test']) {
    assert.ok(operationResults.some(item => item.id.endsWith(`:${id}`) && item.icon === 'edit'));
    assert.ok(operationResults.some(item => item.id.endsWith(`:${id}`) && item.icon !== 'edit'));
  }
  assert.equal(calls.length, 0);
  actions.find(item => item.id === 'conn:ssh-0').run();
  actions.find(item => item.id === 'conn:edit:ssh-0').run();
  actions.find(item => item.id === 'rdp:edit:rdp-test').run();
  actions.find(item => item.id === 'jumpserver:jms-test').run();
  actions.find(item => item.id === 'jumpserver:edit:jms-test').run();
  assert.deepEqual(calls, [['open', 'ssh-0'], ['edit', 'ssh-0'], ['edit', 'rdp-test'], ['open', 'jms-test'], ['edit', 'jms-test']]);
});

test('Chinese tag and folder prefixes also find direct connection actions', async () => {
  const { connectionActionPaletteItems } = await import('./connectionPalette.ts');
  const items = connectionActionPaletteItems([{ id: 'one', name: 'API', host: 'api.test', port: 22, username: 'deploy', folder: '生产/华东/应用', tags: ['核心服务'] }], { onOpen: () => {}, onEdit: () => {} });
  assert.equal(filterPaletteItems(items, '标签 核服').length, 2);
  assert.equal(filterPaletteItems(items, '目录 华东').length, 2);
  assert.ok(filterPaletteItems(items, '编辑 核服').every(item => item.icon === 'edit'));
});

test('independent SFTP entries default to file actions and retain edit and group keywords',async()=>{
 const {connectionActionPaletteItems}=await import('./connectionPalette.ts');
 let opened='';const profile={id:'upload',connectionType:'sftp',name:'Upload',host:'files.test',username:'u',port:22,tags:['backup'],folder:'storage'};
 const items=connectionActionPaletteItems([profile],{onOpen:p=>opened=p.id,onEdit:()=>{}});
 const action=items.find(item=>item.label.startsWith('打开 SFTP'));
 assert.equal(action.icon,'folder');action.run();assert.equal(opened,'upload');
 assert.equal(filterPaletteItems(items,'backup').length,2);
});
