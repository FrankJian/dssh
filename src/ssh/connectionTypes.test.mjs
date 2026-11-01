import test from "node:test";
import assert from "node:assert/strict";
import { connectionTypeForProfile, isJumpServerProfile, isRdpProfile, jumpServerConnectionProfile } from "./connectionTypes.ts";

test("JumpServer platforms remain separate from SSH and RDP profiles in the shared library", () => {
  const p = jumpServerConnectionProfile({ id: "jumpserver:test", name: "Production", coreUrl: "https://jms.example:8443/", keyId: "test-key", orgId: "org-a", hasCredential: true });
  assert.equal(connectionTypeForProfile(p), "jumpserver");
  assert.equal(isJumpServerProfile(p), true);
  assert.equal(isRdpProfile(p), false);
  assert.equal(p.host, "jms.example");
  assert.equal(p.port, 8443);
  assert.equal(p.favorite, false);
  assert.deepEqual(p.tags, []);
  assert.equal("authMethod" in p, false);
  assert.equal("secret" in p, false);
});

test("existing SSH and RDP classification stays compatible", () => {
  assert.equal(connectionTypeForProfile({ id: "ssh:example" }), "ssh");
  assert.equal(connectionTypeForProfile({ id: "rdp:example", protocol: "rdp" }), "rdp");
  assert.equal(jumpServerConnectionProfile({ id: "jumpserver:test", coreUrl: "https://jms.example/" }).port, 443);
});

test("password profile identity survives the display adapter used by Edit", () => {
  const p = jumpServerConnectionProfile({ id: "jumpserver:password", name: "Prod", coreUrl: "https://jms.example/", authKind: "password", username: "alice", keyId: "", orgId: "org-a", hasCredential: false, sshProfileId: "saved-ssh" });
  assert.equal(p.username, "alice");
  assert.equal(p.authKind, "password");
  assert.equal(p.sshProfileId, "saved-ssh");
});
