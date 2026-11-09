import test from 'node:test';
import assert from 'node:assert/strict';
import { filterSftpProfiles } from './sftpLibrary.ts';
import { connectionTypeForProfile } from '../ssh/connectionTypes.ts';
import { profileToCloneDraft } from '../ssh/profileTypes.ts';
const profiles = [
 {id:'ssh',name:'Host 10',host:'api.test',username:'deploy',port:22,tags:['生产环境'],folder:'公司/华东'},
 {id:'sftp',connectionType:'sftp',name:'Host 2',host:'files.test',username:'upload',port:2222,tags:['backup'],folder:''},
];
test('SFTP library includes legacy SSH and independent SFTP once, in stable natural order',()=>{
 assert.deepEqual(filterSftpProfiles(profiles,'all','').map(p=>p.id),['sftp','ssh']);
 assert.deepEqual(filterSftpProfiles([...profiles].reverse(),'all','').map(p=>p.id),['sftp','ssh']);
 assert.deepEqual(filterSftpProfiles(profiles,'ssh','').map(p=>p.id),['ssh']);
 assert.deepEqual(filterSftpProfiles(profiles,'sftp','').map(p=>p.id),['sftp']);
});
test('SFTP search finds connection actions by tag, directory and multiword subsequences',()=>{
 assert.deepEqual(filterSftpProfiles(profiles,'all','华东 生环').map(p=>p.id),['ssh']);
 assert.deepEqual(filterSftpProfiles(profiles,'sftp','华东'),[]);
 assert.deepEqual(filterSftpProfiles(profiles,'all','2222 upl').map(p=>p.id),['sftp']);
});
test('SFTP classification and clone drafts preserve the preferred surface without credentials',()=>{
 assert.equal(connectionTypeForProfile(profiles[1]),'sftp');
 const clone=profileToCloneDraft({...profiles[1],authMethod:{type:'password'},favorite:false,icon:'ssh'});
 assert.equal(clone.connectionType,'sftp');assert.equal(clone.password,'');
 assert.equal(clone.name,'Host 2 克隆');assert.deepEqual(clone.tags,['backup']);
 assert.equal(connectionTypeForProfile(profiles[0]),'ssh');
});
