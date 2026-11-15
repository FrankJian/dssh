import { findRegexMatches } from "./regexMatch";

interface RegexJob {
  pattern: string;
  flags: string;
  input: string;
}

self.onmessage = ({ data }: MessageEvent<RegexJob>) => {
  try {
    self.postMessage({ result: findRegexMatches(data.pattern, data.flags, data.input) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "正则匹配失败。" });
  }
};
