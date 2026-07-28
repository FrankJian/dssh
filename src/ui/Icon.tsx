import type { SVGProps } from "react";

export type IconName =
  | "arrowUp"
  | "arrowDownRight"
  | "bell"
  | "bot"
  | "check"
  | "bucket"
  | "chevron-down"
  | "chevron-right"
  | "close"
  | "code"
  | "command"
  | "connections"
  | "download"
  | "copy"
  | "database"
  | "edit"
  | "eye"
  | "externalWindow"
  | "file"
  | "fileArchive"
  | "fileCode"
  | "fileImage"
  | "fileMusic"
  | "fileSpreadsheet"
  | "fileText"
  | "fileVideo"
  | "folder"
  | "folderPlus"
  | "forward"
  | "gauge"
  | "gitBranch"
  | "info"
  | "maximize"
  | "minimize"
  | "monitor"
  | "moon"
  | "panelLeft"
  | "panelRight"
  | "pin"
  | "play"
  | "plus"
  | "power"
  | "refresh"
  | "restore"
  | "search"
  | "send"
  | "sessions"
  | "shield"
  | "settings"
  | "splitH"
  | "splitV"
  | "ssh"
  | "star"
  | "stop"
  | "sun"
  | "system"
  | "terminalTool"
  | "toolbox"
  | "trash"
  | "unplug"
  | "upload"
  | "zap";

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
}

export function Icon({ name, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width="18"
      {...props}
    >
      {name === "monitor" ? (
        <>
          <rect height="12" rx="2" width="18" x="3" y="4" />
          <path d="M8 20h8M12 16v4" />
        </>
      ) : null}
      {name === "edit" ? (
        <>
          <path d="M12 20h9" />
          <path d="m16.5 3.5 4 4L8 20H4v-4L16.5 3.5Z" />
        </>
      ) : null}
      {name === "eye" ? (
        <>
          <path d="M2.8 12s3.3-6 9.2-6 9.2 6 9.2 6-3.3 6-9.2 6-9.2-6-9.2-6Z" />
          <circle cx="12" cy="12" r="2.7" />
        </>
      ) : null}
      {name === "moon" ? <path d="M20 15.4A8 8 0 0 1 8.6 4 7 7 0 1 0 20 15.4Z" /> : null}
      {name === "play" ? <path d="m8 5 11 7-11 7V5Z" /> : null}
      {name === "plus" ? <path d="M12 5v14M5 12h14" /> : null}
      {name === "settings" ? (
        <>
          <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
          <path d="M19.4 15a1.8 1.8 0 0 0 .36 1.98l.05.05a2.1 2.1 0 0 1-2.97 2.97l-.05-.05a1.8 1.8 0 0 0-1.98-.36 1.8 1.8 0 0 0-1.1 1.66V21.3a2.1 2.1 0 0 1-4.2 0v-.08a1.8 1.8 0 0 0-1.1-1.66 1.8 1.8 0 0 0-1.98.36l-.05.05a2.1 2.1 0 0 1-2.97-2.97l.05-.05A1.8 1.8 0 0 0 4.6 15a1.8 1.8 0 0 0-1.66-1.1H2.7a2.1 2.1 0 0 1 0-4.2h.08a1.8 1.8 0 0 0 1.66-1.1 1.8 1.8 0 0 0-.36-1.98l-.05-.05A2.1 2.1 0 0 1 7 3.6l.05.05A1.8 1.8 0 0 0 9 4.01 1.8 1.8 0 0 0 10.1 2.35V2.1a2.1 2.1 0 0 1 4.2 0v.08a1.8 1.8 0 0 0 1.1 1.66 1.8 1.8 0 0 0 1.98-.36l.05-.05A2.1 2.1 0 0 1 20.4 6.4l-.05.05A1.8 1.8 0 0 0 20 8.4a1.8 1.8 0 0 0 1.66 1.1h.24a2.1 2.1 0 0 1 0 4.2h-.08A1.8 1.8 0 0 0 19.4 15Z" />
        </>
      ) : null}
      {name === "ssh" ? (
        <>
          <rect height="14" rx="2.5" width="18" x="3" y="5" />
          <path d="M7 9h10M8 13h3M13 13h3" />
        </>
      ) : null}
      {name === "sun" ? (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </>
      ) : null}
      {name === "star" ? (
        <path d="m12 3.8 2.45 4.96 5.48.8-3.96 3.86.93 5.45L12 16.3l-4.9 2.57.93-5.45-3.96-3.86 5.48-.8L12 3.8Z" />
      ) : null}
      {name === "system" ? (
        <>
          <rect height="12" rx="2" width="18" x="3" y="4" />
          <path d="M8 20h8M12 16v4M7 8h4M7 11h7" />
        </>
      ) : null}
      {name === "trash" ? (
        <>
          <path d="M4 7h16M9 7V5h6v2M9 11v6M15 11v6M6 7l1 14h10l1-14" />
        </>
      ) : null}
      {name === "refresh" ? (
        <>
          <path d="M20 11a8 8 0 1 0-.9 4.5" />
          <path d="M20 4v6h-6" />
        </>
      ) : null}
      {name === "minimize" ? <path d="M6 12h12" /> : null}
      {name === "maximize" ? <rect height="13" rx="1.5" width="13" x="5.5" y="5.5" /> : null}
      {name === "restore" ? (
        <>
          <rect height="10" rx="1.5" width="10" x="8" y="8" />
          <path d="M8 8V6.5A1.5 1.5 0 0 1 9.5 5H17a1.5 1.5 0 0 1 1.5 1.5V14a1.5 1.5 0 0 1-1.5 1.5H16" />
        </>
      ) : null}
      {name === "close" ? <path d="M6 6l12 12M18 6 6 18" /> : null}
      {name === "folder" ? (
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
      ) : null}
      {name === "folderPlus" ? (
        <>
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
          <path d="M12 10v6M9 13h6" />
        </>
      ) : null}
      {name === "database" ? (
        <>
          <ellipse cx="12" cy="5" rx="8" ry="3" />
          <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
        </>
      ) : null}
      {name === "bucket" ? (
        <>
          <path d="M5 7h14l-1.5 13h-11L5 7Z" />
          <path d="M8 7V5a4 4 0 0 1 8 0v2" />
        </>
      ) : null}
      {name === "copy" ? (
        <>
          <rect height="13" rx="2" width="13" x="8" y="8" />
          <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
        </>
      ) : null}
      {name === "shield" ? (
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      ) : null}
      {name === "file" ? (
        <>
          <path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
          <path d="M14 3v5h5" />
        </>
      ) : null}
      {name === "fileText" ? (
        <>
          <path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
          <path d="M14 3v5h5M8.5 12h7M8.5 16h7" />
        </>
      ) : null}
      {name === "fileCode" ? (
        <>
          <path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
          <path d="M14 3v5h5M10 12l-2 2 2 2M14 12l2 2-2 2" />
        </>
      ) : null}
      {name === "fileImage" ? (
        <>
          <path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
          <path d="M14 3v5h5M8 17l3-3 2 2 2-2 2 3M9.5 11.5h.01" />
        </>
      ) : null}
      {name === "fileArchive" ? (
        <>
          <path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
          <path d="M14 3v5h5M11 8h2M11 11h2M11 14h2M10 17h4" />
        </>
      ) : null}
      {name === "fileMusic" ? (
        <>
          <path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
          <path d="M14 3v5h5M14 12v5.5a1.5 1.5 0 1 1-1-1.3M14 12l3-1v5.5a1.5 1.5 0 1 1-1-1.3" />
        </>
      ) : null}
      {name === "fileVideo" ? (
        <>
          <path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
          <path d="M14 3v5h5M10 12l5 3-5 3v-6Z" />
        </>
      ) : null}
      {name === "fileSpreadsheet" ? (
        <>
          <path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
          <path d="M14 3v5h5M8 12h8M8 16h8M12 10v8" />
        </>
      ) : null}
      {name === "download" ? (
        <>
          <path d="M12 4v11" />
          <path d="m7 11 5 5 5-5" />
          <path d="M5 20h14" />
        </>
      ) : null}
      {name === "upload" ? (
        <>
          <path d="M12 20V9" />
          <path d="m7 13 5-5 5 5" />
          <path d="M5 4h14" />
        </>
      ) : null}
      {/* Port forwarding: traffic routed between two endpoints. */}
      {name === "forward" ? (
        <>
          <circle cx="6" cy="19" r="3" />
          <circle cx="18" cy="5" r="3" />
          <path d="M9 19h6.5a3.5 3.5 0 0 0 0-7h-6a3.5 3.5 0 0 1 0-7H15" />
        </>
      ) : null}
      {name === "arrowUp" ? (
        <>
          <path d="M12 20V6" />
          <path d="m6 12 6-6 6 6" />
        </>
      ) : null}
      {name === "chevron-right" ? <path d="m9 6 6 6-6 6" /> : null}
      {name === "chevron-down" ? <path d="m6 9 6 6 6-6" /> : null}
      {name === "check" ? <path d="m5 12 5 5 9-11" /> : null}
      {name === "send" ? (
        <>
          <path d="M4.5 12 20 4l-3.5 16-4.5-6-7.5-2Z" />
          <path d="m12 13 4.5-9" />
        </>
      ) : null}
      {name === "stop" ? <rect height="10" rx="1.5" width="10" x="7" y="7" /> : null}
      {name === "externalWindow" ? (
        <>
          <path d="M14 4h6v6" />
          <path d="M20 4 12 12" />
          <path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" />
        </>
      ) : null}
      {/* AI assistant: a bot head. */}
      {name === "bot" ? (
        <>
          <rect height="11" rx="3" width="16" x="4" y="8" />
          <path d="M12 4.8V8" />
          <circle cx="12" cy="3.4" r="1.4" />
          <path d="M2 13.5h1.5M20.5 13.5H22" />
          <path d="M9.5 12.5h.01M14.5 12.5h.01M9.5 16h5" />
        </>
      ) : null}
      {name === "terminalTool" ? (
        <>
          <rect height="15" rx="2" width="18" x="3" y="4.5" />
          <path d="m7 9 3 3-3 3M12.5 15h4" />
        </>
      ) : null}
      {name === "pin" ? (
        <>
          <path d="M12 17v5" />
          <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1v3.76z" />
        </>
      ) : null}
      {name === "info" ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5" />
          <path d="M12 8h.01" />
        </>
      ) : null}
      {/* Active sessions: a hub radiating to live nodes. */}
      {name === "sessions" ? (
        <>
          <circle cx="12" cy="12" r="2.6" />
          <circle cx="5" cy="5.5" r="2" />
          <circle cx="19" cy="5.5" r="2" />
          <circle cx="12" cy="20" r="2" />
          <path d="m6.5 7 3.6 3.3M17.5 7l-3.6 3.3M12 14.6V18" />
        </>
      ) : null}
      {/* Saved connections: a stack of server racks. */}
      {name === "connections" ? (
        <>
          <rect height="7" rx="2" width="18" x="3" y="4" />
          <rect height="7" rx="2" width="18" x="3" y="13" />
          <path d="M7 7.5h.01M7 16.5h.01M11 7.5h6M11 16.5h6" />
        </>
      ) : null}
      {/* Host tools: a toolbox. */}
      {name === "toolbox" ? (
        <>
          <path d="M3 10a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8Z" />
          <path d="M9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
          <path d="M3 13h18M10.5 13v2.5h3V13" />
        </>
      ) : null}
      {name === "gauge" ? (
        <>
          <path d="m12 14 4-4" />
          <path d="M3.34 19a10 10 0 1 1 17.32 0" />
        </>
      ) : null}
      {name === "gitBranch" ? (
        <>
          <path d="M6 3v12" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        </>
      ) : null}
      {name === "bell" ? (
        <>
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </>
      ) : null}
      {name === "panelLeft" ? (
        <>
          <rect height="18" rx="2" width="18" x="3" y="3" />
          <path d="M9 3v18" />
        </>
      ) : null}
      {name === "panelRight" ? (
        <>
          <rect height="18" rx="2" width="18" x="3" y="3" />
          <path d="M15 3v18" />
        </>
      ) : null}
      {name === "zap" ? <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" /> : null}
      {name === "search" ? (
        <>
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </>
      ) : null}
      {name === "command" ? (
        <path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />
      ) : null}
      {name === "splitH" ? (
        <>
          <path d="M8 19H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3" />
          <path d="M16 5h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-3" />
          <path d="M12 4v16" />
        </>
      ) : null}
      {name === "splitV" ? (
        <>
          <path d="M19 8V5a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v3" />
          <path d="M5 16v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" />
          <path d="M4 12h16" />
        </>
      ) : null}
      {/* Disconnect: a plug pulled apart. */}
      {name === "unplug" ? (
        <>
          <path d="m19 5 3-3" />
          <path d="m2 22 3-3" />
          <path d="M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z" />
          <path d="M7.5 13.5 10 11" />
          <path d="M10.5 16.5 13 14" />
          <path d="m12 6 6 6 2.3-2.3a2.4 2.4 0 0 0 0-3.4l-2.6-2.6a2.4 2.4 0 0 0-3.4 0Z" />
        </>
      ) : null}
      {name === "power" ? (
        <>
          <path d="M12 2v10" />
          <path d="M18.4 6.6a9 9 0 1 1-12.8 0" />
        </>
      ) : null}
      {name === "arrowDownRight" ? (
        <>
          <path d="m7 7 10 10" />
          <path d="M17 7v10H7" />
        </>
      ) : null}
      {name === "code" ? (
        <>
          <path d="m16 18 6-6-6-6" />
          <path d="m8 6-6 6 6 6" />
        </>
      ) : null}
    </svg>
  );
}
