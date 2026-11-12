import { Icon, type IconName } from "../ui/Icon";

const fileTypes = [
  { icon: "fileCode", tone: "code", extensions: "c cc cpp cs css go h hpp html java js jsx kt lua php py rb rs scss swift ts tsx vue" },
  { icon: "fileBraces", tone: "config", extensions: "conf env ini json jsonc properties toml xml yaml yml", names: ".env .gitignore .gitattributes .editorconfig dockerfile containerfile" },
  { icon: "fileTerminal", tone: "code", extensions: "bat bash cmd fish ps1 sh zsh", names: ".bashrc .bash_profile .profile .zshrc .zprofile makefile" },
  { icon: "fileImage", tone: "image", extensions: "avif bmp gif heic ico jpeg jpg png psd svg tif tiff webp" },
  { icon: "fileMusic", tone: "media", extensions: "aac aiff flac m4a mp3 oga ogg opus wav" },
  { icon: "fileVideo", tone: "media", extensions: "avi m4v mkv mov mp4 mpeg mpg webm" },
  { icon: "fileSpreadsheet", tone: "data", extensions: "csv ods parquet tsv xls xlsx" },
  { icon: "fileArchive", tone: "archive", extensions: "7z bz2 gz rar tar tbz2 tgz txz xz zip zst" },
  { icon: "filePdf", tone: "pdf", extensions: "pdf" },
  { icon: "fileKey", tone: "config", extensions: "cer crt der key p12 pem pfx pub" },
  { icon: "fileText", tone: "neutral", extensions: "doc docx log md mdx odt rst rtf txt", names: "license readme" },
] as const satisfies readonly { icon: IconName; tone: string; extensions: string; names?: string }[];

const iconsByExtension = new Map(fileTypes.flatMap((type) =>
  type.extensions.split(" ").map((extension) => [extension, type] as const),
));
const iconsByName = new Map(fileTypes.flatMap((type) =>
  "names" in type ? type.names.split(" ").map((name) => [name, type] as const) : [],
));

interface FileEntryIconProps {
  name?: string;
  directory?: boolean;
  expanded?: boolean;
  symlink?: boolean;
}

export function FileEntryIcon({ name = "", directory, expanded, symlink }: FileEntryIconProps) {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  const file = iconsByName.get(lower) ?? (dot > 0 ? iconsByExtension.get(lower.slice(dot + 1)) : undefined);
  const icon = directory ? (expanded ? "folderOpen" : "folder") : file?.icon ?? "file";
  return (
    <span className="file-entry-icon" data-tone={directory ? "folder" : file?.tone ?? "neutral"} aria-hidden="true">
      <Icon name={icon} height="18" width="18" strokeWidth="1.65" />
      {symlink ? <Icon className="file-entry-icon__link" name="arrowDownRight" width="9" height="9" strokeWidth="2.5" /> : null}
    </span>
  );
}
