import forge from "node-forge";

export function generateRsaPair(): string {
  // Always rely on a platform CSPRNG, including WebViews without SubtleCrypto.
  if (!globalThis.crypto?.getRandomValues) throw new Error("当前窗口无法使用系统随机数。");
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 65537, prng: {
    getBytesSync(count: number) {
      return String.fromCharCode(...crypto.getRandomValues(new Uint8Array(count)));
    },
  } });
  const publicKey = forge.pki.publicKeyToPem(keys.publicKey);
  const privateKey = forge.pki.privateKeyInfoToPem(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(keys.privateKey)));
  return publicKey.replace(/\r\n/g, "\n") + "\n" + privateKey.replace(/\r\n/g, "\n");
}
