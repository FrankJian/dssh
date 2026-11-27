import type { CSSProperties } from "react";
import { Icon } from "../ui/Icon";
import { fileTypeIcon } from "./fileIconTheme";
import "./fileIcons.css";

interface FileEntryIconProps {
  name?: string;
  directory?: boolean;
  expanded?: boolean;
  symlink?: boolean;
}

export function FileEntryIcon({ name = "", directory, expanded, symlink }: FileEntryIconProps) {
  const file = directory ? null : fileTypeIcon(name);
  return (
    <span className="file-entry-icon" data-tone={directory ? "folder" : "seti"} data-seti={file?.id} aria-hidden="true"
      style={file ? { "--file-type-color": file.color, "--file-type-color-light": file.lightColor } as CSSProperties : undefined}>
      {file ? <span className="file-entry-icon__seti" data-glyph={file.glyph} /> : <Icon name={expanded ? "folderOpen" : "folder"} height="18" width="18" strokeWidth="1.65" />}
      {symlink ? <Icon className="file-entry-icon__link" name="arrowDownRight" width="9" height="9" strokeWidth="2.5" /> : null}
    </span>
  );
}
