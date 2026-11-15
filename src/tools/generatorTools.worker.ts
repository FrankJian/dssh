import forge from "node-forge";
import zxcvbn from "zxcvbn";
import { receiveLocalTool } from "./localToolWorker";

receiveLocalTool(({ id, input }) => {
  if (id === "rsa-key") {
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
  if (id === "password-strength") {
    if (!input || input.length > 128) throw new Error("请输入 1–128 个字符的密码。");
    const result = zxcvbn(input);
    const guesses = Number.isFinite(result.guesses) ? result.guesses.toExponential(2) : "超出估算范围";
    return [`估算等级  ${result.score} / 4`, `估算猜测次数  ${guesses}`,
      "估算基于常见口令、模式和字符组合。"].join("\n");
  }
  throw new Error("未知的生成操作。");
});
