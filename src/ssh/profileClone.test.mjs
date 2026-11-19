import assert from 'node:assert/strict';
import test from 'node:test';
import { profileToCloneDraft } from './profileTypes.ts';

test('clone draft copies connection settings, appends the suffix and keeps tags independent', () => {
  const source = { name: 'Production', host: 'example.test', port: 2222, username: 'deploy',
    authMethod: { type: 'privateKey', keyName: 'deployment.key' },
    proxy: { proxyType: 'socks5', host: 'proxy.example.test', port: 1081, username: 'proxy-user' },
    description: 'API host', folder: 'production/api', favorite: true, icon: 'ubuntu', tags: ['production', 'api'] };
  const draft = profileToCloneDraft(source);
  assert.equal(draft.name, 'Production 克隆');
  assert.equal(draft.folder, 'production/api');
  assert.equal(draft.host, source.host);
  assert.equal(draft.port, '2222');
  assert.equal(draft.username, source.username);
  assert.equal(draft.authType, 'privateKey');
  assert.equal(draft.keyName, 'deployment.key');
  assert.equal(draft.useProxy, true);
  assert.equal(draft.proxyHost, source.proxy.host);
  assert.equal(draft.proxyPort, '1081');
  assert.equal(draft.proxyUsername, 'proxy-user');
  assert.equal(draft.description, source.description);
  assert.equal(draft.icon, source.icon);
  assert.equal(draft.favorite, true);
  assert.deepEqual(draft.tags, source.tags);
  for (const field of ['password', 'keyFilePath', 'passphrase', 'proxyPassword']) assert.equal(draft[field], '');
  draft.tags.push('clone');
  assert.deepEqual(source.tags, ['production', 'api']);
  assert.equal(source.name, 'Production');
});


test("clone draft keeps the shared credential reference", () => {
  const draft = profileToCloneDraft({
    name: "Upload", host: "files.test", port: 22, username: "deploy",
    credentialId: "ssh-credential:team", authMethod: { type: "privateKey", keyName: "team.key" },
  });
  assert.equal(draft.authSource, "ssh-credential:team");
  assert.equal(draft.keyName, "");
  assert.equal(draft.keyFilePath, "");
});
