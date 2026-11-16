import { stringify } from "yaml";

function shellWords(input: string): string[] {
  const words: string[] = [];
  let word = "";
  let started = false;
  let quote = "";
  for (let index = 0; index < input.length; index++) {
    const character = input[index];
    if (character === "\\" && quote !== "'") {
      const next = input[++index];
      if (next === undefined) throw new Error("命令末尾缺少转义字符。");
      if (next === "\n") continue;
      if (next === "\r" && input[index + 1] === "\n") { index++; continue; }
      word += quote === '"' && !/["\\$\`]/.test(next) ? "\\" + next : next;
      started = true;
    } else if (quote) {
      if (character === quote) quote = "";
      else {
        if (quote === '"' && /[$`]/.test(character)) throw new Error("请先替换命令中的 Shell 变量或命令替换。");
        word += character;
      }
    } else if (character === "'" || character === '"') {
      quote = character;
      started = true;
    } else if (character === "\n" || character === "\r") {
      if (input.slice(index).trim()) throw new Error("请输入一条命令，多行命令请使用反斜杠续行。");
      break;
    } else if (/\s/.test(character)) {
      if (started) words.push(word);
      word = "";
      started = false;
    } else {
      if ((!started && (character === "~" || character === "#")) || /[;&|<>`$*?\[\]{}]/.test(character)) {
        throw new Error("请先替换 Shell 展开，并为包含特殊字符的参数加引号。");
      }
      word += character;
      started = true;
    }
  }
  if (quote) throw new Error("命令中有未闭合的引号。");
  if (started) words.push(word);
  return words;
}

const argumentFlags: Record<string, string> = {
  "--name": "container_name",
  "--hostname": "hostname", "-h": "hostname",
  "--user": "user", "-u": "user",
  "--workdir": "working_dir", "-w": "working_dir",
  "--restart": "restart",
  "--network": "network_mode", "--net": "network_mode",
  "--entrypoint": "entrypoint",
  "--publish": "ports", "-p": "ports",
  "--expose": "expose",
  "--env": "environment", "-e": "environment",
  "--env-file": "env_file",
  "--volume": "volumes", "-v": "volumes",
  "--label": "labels", "-l": "labels",
  "--add-host": "extra_hosts",
};
const listKeys = new Set(["ports", "expose", "environment", "env_file", "volumes", "labels", "extra_hosts"]);
const toggleFlags: Record<string, string | undefined> = {
  "--detach": undefined, "-d": undefined,
  "--interactive": "stdin_open", "-i": "stdin_open",
  "--tty": "tty", "-t": "tty",
  "--read-only": "read_only", "--privileged": "privileged", "--init": "init",
};

function composeLiteral(value: string): string {
  return value.replace(/\$/g, () => "$$");
}

export function dockerRunToCompose(input: string): string {
  const tokens = shellWords(input.trim());
  if (tokens[0] !== "docker") throw new Error("请输入 docker run 或 docker container run 命令。");
  let index = tokens[1] === "container" ? 2 : 1;
  if (tokens[index++] !== "run") throw new Error("请输入 docker run 或 docker container run 命令。");

  const service: Record<string, string | boolean | string[]> = { network_mode: "bridge" };
  const volumes = new Map<string, { name: string }>();
  const networks = new Map<string, { external: true }>();

  for (; index < tokens.length && tokens[index].startsWith("-"); index++) {
    const token = tokens[index];
    if (token === "--") { index++; break; }
    if (/^-[dit]{2,3}$/.test(token)) {
      for (const flag of token.slice(1)) {
        const key = toggleFlags[`-${flag}`];
        if (key) service[key] = true;
      }
      continue;
    }
    const equal = token.startsWith("--") ? token.indexOf("=") : -1;
    const flag = equal >= 0 ? token.slice(0, equal) : /^-[epvluwh].+/.test(token) ? token.slice(0, 2) : token;
    const inline = equal >= 0 ? token.slice(equal + 1) : flag !== token ? token.slice(2) : undefined;
    if (Object.prototype.hasOwnProperty.call(toggleFlags, flag)) {
      if (inline !== undefined && inline !== "true" && inline !== "false") throw new Error(`参数 ${flag} 需要布尔值。`);
      const key = toggleFlags[flag];
      if (key) service[key] = inline !== "false";
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(argumentFlags, flag)) {
      throw new Error(`暂不支持 Docker 参数 ${flag}。`);
    }
    const key = argumentFlags[flag];
    const argument = inline ?? tokens[++index];
    if (argument === undefined || (inline === undefined && argument.startsWith("-"))) {
      throw new Error(`缺少参数 ${flag} 的值。`);
    }
    if (key === "network_mode") {
      if (/^(bridge|host|none|container:[a-zA-Z0-9_.-]+)$/.test(argument)) {
        service.network_mode = argument;
        delete service.networks;
      } else if (/^[a-zA-Z0-9_.-]+$/.test(argument)) {
        delete service.network_mode;
        service.networks = [argument];
      } else throw new Error("网络名称无效。");
    } else if (listKeys.has(key)) {
      if (key === "volumes") {
        const named = /^([a-zA-Z0-9][a-zA-Z0-9_.-]*):\/[^:]+/.exec(argument);
        if (named) volumes.set(named[1], { name: named[1] });
      }
      const values = (service[key] as string[] | undefined) ?? [];
      values.push(composeLiteral(argument));
      service[key] = values;
    } else if (key === "entrypoint") {
      service.entrypoint = argument ? [composeLiteral(argument)] : [];
    } else {
      service[key] = composeLiteral(argument);
    }
  }

  const image = tokens[index++];
  if (!image || !/^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/.test(image)) throw new Error("请输入有效的 Docker 镜像名称。");
  if (service.network_mode === "host" && service.ports) throw new Error("host 网络与端口映射无法同时写入 Compose。");
  if (Array.isArray(service.networks)) networks.set(service.networks[0], { external: true });
  const name = typeof service.container_name === "string" ? service.container_name : "app";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) throw new Error("容器名称无效。");
  const command = tokens.slice(index).map(composeLiteral);
  if (command.length || service.entrypoint !== undefined) service.command = command;
  return stringify({
    services: { [name]: { image, ...service } },
    ...(volumes.size ? { volumes: Object.fromEntries(volumes) } : {}),
    ...(networks.size ? { networks: Object.fromEntries(networks) } : {}),
  });
}
