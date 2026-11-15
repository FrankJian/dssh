import { bcryptHash, bcryptVerify, decryptToolText, encryptToolText } from "./cryptoTools";
import { receiveLocalTool } from "./localToolWorker";

receiveLocalTool(({ id, input, other, option }) => {
  switch (id) {
    case "bcrypt": return option === "verify" ? bcryptVerify(input, other) : bcryptHash(input, Number(option));
    case "aes-encryption": return option === "decrypt" ? decryptToolText(input, other) : encryptToolText(input, other);
    default: throw new Error("未知的密码学操作。");
  }
});
