import zxcvbn from "zxcvbn";
import { receiveLocalTool } from "./localToolWorker";

receiveLocalTool(({ input }) => {
  if (!input || input.length > 128) throw new Error("请输入 1–128 个字符的密码。");
  const result = zxcvbn(input);
  const guesses = Number.isFinite(result.guesses) ? result.guesses.toExponential(2) : "超出估算范围";
  return [`估算等级  ${result.score} / 4`, `估算猜测次数  ${guesses}`,
    "估算基于常见口令、模式和字符组合。"].join("\n");
});
