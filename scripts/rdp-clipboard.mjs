import { copyFileSync } from "node:fs";
import { join } from "node:path";

// Keep upstream implementations and their license notices. All replacements
// are checked against the pinned archive by build-rdp's strict adapt helper.
export function adaptClipboard(source, sdl, adapt) {
  const fileBridge = join(source, "client/common/client_cliprdr_file.c");
  adapt(fileBridge, '#include <freerdp/client/client_cliprdr_file.h>', '#include <freerdp/client/client_cliprdr_file.h>\n#include "../SDL/SDL3/dssh_visibility_state.h"');
  adapt(fileBridge, '\tCliprdrClientContext* cliprdr = file->context;', '\tif (dssh_desktop_locked()) return FALSE;\n\tCliprdrClientContext* cliprdr = file->context;');
  adapt(fileBridge, '\t/*\n\t * MS-RDPECLIP 2.2.5.3 File Contents Request PDU', '\tif (dssh_desktop_locked()) return cliprdr_file_context_send_file_contents_failure(file, fileContentsRequest);\n\t/*\n\t * MS-RDPECLIP 2.2.5.3 File Contents Request PDU');
  const clip = join(sdl, "sdl_clip.cpp");
  adapt(clip, '#include "sdl_clip.hpp"', '#include "sdl_clip.hpp"\n#include "dssh_clipboard.h"');
  adapt(clip, '\treturn cliprdr_file_context_init(_file, _ctx);', `    const bool initialized = cliprdr_file_context_init(_file, _ctx);
    if (initialized && !dssh_clipboard_files(_ctx->rdpcontext->settings)) {
        _ctx->ServerFileContentsRequest = dssh_clipboard_deny_file_request;
        _ctx->ServerFileContentsResponse = dssh_clipboard_ignore_file_response;
    }
    return initialized;`);
  adapt(clip, '\t\tstd::string local_mime = clipboard_mime_formats[i];', `\t\tstd::string local_mime = clipboard_mime_formats[i];
        if (!mime_is_text(local_mime) &&
            !(dssh_clipboard_files(_ctx->rdpcontext->settings) &&
              (mime_is_file(local_mime) || local_mime == s_type_file_url))) continue;`);
  // The SDL path is used by macOS. Do not publish or read a global clipboard
  // update for a background desktop; focus gain refreshes the local formats.
  adapt(clip, '\tstd::unique_ptr<char*, decltype(&SDL_free)> current(nullptr, SDL_free);', '\tif (dssh_desktop_locked() || !SDL_GetKeyboardFocus()) return true;\n\tstd::unique_ptr<char*, decltype(&SDL_free)> current(nullptr, SDL_free);');
  adapt(clip, '\tconst CLIPRDR_FORMAT_DATA_REQUEST request = { { CB_TYPE_NONE, 0, 0 }, formatID };', '\tif (dssh_desktop_locked()) return ERROR_ACCESS_DENIED;\n\tconst CLIPRDR_FORMAT_DATA_REQUEST request = { { CB_TYPE_NONE, 0, 0 }, formatID };');
  adapt(clip, '\t\tconst CLIPRDR_FORMAT* format = &formatList->formats[i];', `\t\tconst CLIPRDR_FORMAT* format = &formatList->formats[i];
        if (!dssh_clipboard_format(context->rdpcontext->settings, format->formatId, format->formatName)) continue;`);
  adapt(clip, '\t\tconst UINT32 fileId =\n\t\t    ClipboardRegisterFormat(clipboard->_system, s_type_FileGroupDescriptorW);', `        const char* requestedName = ClipboardGetFormatName(clipboard->_system, formatDataRequest->requestedFormatId);
        if (!SDL_GetKeyboardFocus()) return clipboard->SendDataResponse(nullptr, 0);
        if (!dssh_clipboard_format(context->rdpcontext->settings, formatDataRequest->requestedFormatId, requestedName))
            return clipboard->SendDataResponse(nullptr, 0);
\t\tconst UINT32 fileId =
\t\t    ClipboardRegisterFormat(clipboard->_system, s_type_FileGroupDescriptorW);`);
  // FileContents callbacks are installed by the common file context. Text-only
  // must not advertise file capabilities even to a server probing formats.
  adapt(clip, 'CB_USE_LONG_FORMAT_NAMES | cliprdr_file_context_current_flags(_file)',
    'CB_USE_LONG_FORMAT_NAMES | (dssh_clipboard_files(_ctx->rdpcontext->settings) ? cliprdr_file_context_current_flags(_file) : 0)');

  const channels = join(sdl, "sdl_channels.cpp");
  adapt(channels, '#include "sdl_channels.hpp"', '#include "sdl_channels.hpp"\n#include "dssh_clipboard.h"');
  adapt(channels, '\t\tif (!sdl->getClipboardChannelContext().init(clip))', `#ifdef _WIN32
        if (!dssh_win_clipboard_init(sdl->context(), clip))
#else
\t\tif (!sdl->getClipboardChannelContext().init(clip))
#endif`);
  adapt(channels, '\t\tif (!sdl->getClipboardChannelContext().uninit(clip))', `#ifdef _WIN32
        if (!dssh_win_clipboard_uninit(sdl->context(), clip))
#else
\t\tif (!sdl->getClipboardChannelContext().uninit(clip))
#endif`);

  const win = join(sdl, "dssh_clipboard_win.c");
  copyFileSync(join(source, "client/Windows/wf_cliprdr.c"), win);
  adapt(win, '#include "wf_cliprdr.h"', '#include "dssh_clipboard.h"\n#include <freerdp/freerdp.h>\n#include <freerdp/channels/channels.h>');
  adapt(win, '\twfContext* wfc;', '\trdpContext* rdp;\n\tBOOL wasForeground;\n\tDWORD localFileSequence;');
  adapt(win, '#define WM_CLIPRDR_MESSAGE (WM_USER + 156)', `static BOOL dssh_clipboard_foreground(void)
{
    if (dssh_desktop_locked()) return FALSE;
    DWORD pid = 0;
    GetWindowThreadProcessId(GetForegroundWindow(), &pid);
    return pid == GetCurrentProcessId();
}

#define WM_CLIPRDR_MESSAGE (WM_USER + 156)`);
  adapt(win, '\t/* Ignore if other app is holding clipboard */', `    if (!dssh_clipboard_foreground()) return CHANNEL_RC_OK;
    if (GetClipboardOwner() == clipboard->hwnd ||
        (clipboard->data_obj && OleIsCurrentClipboard(clipboard->data_obj) == S_OK)) return CHANNEL_RC_OK;
\t/* Ignore if other app is holding clipboard */`);
  adapt(win, '\t\tcase WM_CLIPBOARDUPDATE:', `        case WM_TIMER:
        {
            const BOOL active = dssh_clipboard_foreground();
            if (active && !clipboard->wasForeground && clipboard->sync)
                cliprdr_send_format_list(clipboard);
            clipboard->wasForeground = active;
            break;
        }
\t\tcase WM_CLIPBOARDUPDATE:`);
  adapt(win, '\t\t\tclipboard->hwnd = hWnd;', '\t\t\tclipboard->hwnd = hWnd;\n\t\t\tSetTimer(hWnd, 1, 250, nullptr);');
  adapt(win, '\t\tcase WM_CLOSE:\n\t\t\tDEBUG_CLIPRDR("info: WM_CLOSE");', `\t\tcase WM_CLOSE:
\t\t\tDEBUG_CLIPRDR("info: WM_CLOSE");
            KillTimer(hWnd, 1);
            if (clipboard->data_obj && OleIsCurrentClipboard(clipboard->data_obj) == S_OK)
                OleSetClipboard(nullptr);`);
  adapt(win, '\t\t\t\tclipboard->RemoveClipboardFormatListener(hWnd);\n\n\t\t\tbreak;', '\t\t\t\tclipboard->RemoveClipboardFormatListener(hWnd);\n\t\t\tDestroyWindow(hWnd);\n\t\t\tPostQuitMessage(0);\n\t\t\tbreak;');
  adapt(win, '\t\tPostMessage(clipboard->hwnd, WM_QUIT, 0, 0);', '\t\tPostMessage(clipboard->hwnd, WM_CLOSE, 0, 0);');
  adapt(win, '\tif (file_transferring(clipboard))\n\t{\n\t\tif (PostMessage', '\tif (!dssh_clipboard_foreground()) return CHANNEL_RC_OK;\n\tif (file_transferring(clipboard))\n\t{\n\t\tif (PostMessage');
  adapt(win, 'BOOL wf_cliprdr_init(wfContext* wfc, CliprdrClientContext* cliprdr)', 'BOOL dssh_win_clipboard_init(rdpContext* context, CliprdrClientContext* cliprdr)');
  adapt(win, '\trdpContext* context = (rdpContext*)wfc;\n', '');
  adapt(win, '\twfc->clipboard = (wfClipboard*)calloc(1, sizeof(wfClipboard));\n\n\tif (!wfc->clipboard)\n\t\treturn FALSE;\n\n\tclipboard = wfc->clipboard;\n\tclipboard->wfc = wfc;', '\tclipboard = (wfClipboard*)calloc(1, sizeof(wfClipboard));\n\tif (!clipboard) return FALSE;\n\tcliprdr->custom = clipboard;\n\tclipboard->rdp = context;');
  adapt(win, '\tcliprdr->custom = (void*)wfc->clipboard;', '\tcliprdr->custom = clipboard;');
  adapt(win, '\twf_cliprdr_uninit(wfc, cliprdr);', '\tdssh_win_clipboard_uninit(context, cliprdr);');
  adapt(win, 'BOOL wf_cliprdr_uninit(wfContext* wfc, CliprdrClientContext* cliprdr)', 'BOOL dssh_win_clipboard_uninit(rdpContext* context, CliprdrClientContext* cliprdr)');
  adapt(win, '\tif (!wfc || !cliprdr)', '\tif (!context || !cliprdr)');
  adapt(win, '\tclipboard = wfc->clipboard;', '\tclipboard = (wfClipboard*)cliprdr->custom;');
  // User clipboard APIs may enumerate just CF_HDROP; two virtual file formats
  // are then emitted, so reserve at least two slots.
  adapt(win, '\t\tnumFormats = (UINT32)count;', '\t\tnumFormats = (UINT32)((count < 2) ? 2 : count);');
  adapt(win, 'CB_USE_LONG_FORMAT_NAMES | CB_STREAM_FILECLIP_ENABLED | CB_FILECLIP_NO_FILE_PATHS;', 'CB_USE_LONG_FORMAT_NAMES | (dssh_clipboard_files(clipboard->rdp->settings) ? (CB_STREAM_FILECLIP_ENABLED | CB_FILECLIP_NO_FILE_PATHS) : 0);');
  adapt(win, '\tcliprdr->ServerFileContentsResponse = wf_cliprdr_server_file_contents_response;', `\tcliprdr->ServerFileContentsResponse = wf_cliprdr_server_file_contents_response;
    if (!dssh_clipboard_files(context->settings)) {
        cliprdr->ServerFileContentsRequest = dssh_clipboard_deny_file_request;
        cliprdr->ServerFileContentsResponse = dssh_clipboard_ignore_file_response;
    }`);
  adapt(win, '\tformatList.numFormats = numFormats;', `    UINT32 kept = 0;
    for (UINT32 i = 0; i < numFormats; i++) {
        if (dssh_clipboard_format(clipboard->rdp->settings, formats[i].formatId, formats[i].formatName))
            formats[kept++] = formats[i];
        else free(formats[i].formatName);
    }
    numFormats = kept;
\tformatList.numFormats = numFormats;`);
  adapt(win, '\t\tformat = &(formatList->formats[i]);\n\t\tmapping = &(clipboard->format_mappings[i]);', `\t\tformat = &(formatList->formats[i]);
        if (!dssh_clipboard_format(clipboard->rdp->settings, format->formatId, format->formatName)) continue;
\t\tmapping = &(clipboard->format_mappings[clipboard->map_size]);`);
  adapt(win, '\tconst UINT32 requestedFormatId = formatDataRequest->requestedFormatId;', `\tconst UINT32 requestedFormatId = formatDataRequest->requestedFormatId;
    char requestedName[256] = {0};
    GetClipboardFormatNameA(requestedFormatId, requestedName, sizeof(requestedName));
    if (!dssh_clipboard_foreground() || !dssh_clipboard_format(clipboard->rdp->settings, requestedFormatId, requestedName)) {
        CLIPRDR_FORMAT_DATA_RESPONSE denied = {0};
        denied.common.msgType = CB_FORMAT_DATA_RESPONSE;
        denied.common.msgFlags = CB_RESPONSE_FAIL;
        return context->ClientFormatDataResponse(context, &denied);
    }`);
  adapt(win, '\tremoteFormatId = get_remote_format_id(clipboard, formatId);', '\tif (dssh_desktop_locked()) return ERROR_ACCESS_DENIED;\n\tremoteFormatId = get_remote_format_id(clipboard, formatId);');
  adapt(win, '\tfileContentsRequest.streamId = (UINT32)(ULONG_PTR)streamid;', '\tif (dssh_desktop_locked()) return ERROR_ACCESS_DENIED;\n\tfileContentsRequest.streamId = (UINT32)(ULONG_PTR)streamid;');
  adapt(win, '\t\tres = wf_cliprdr_get_filedescriptor(clipboard, &requestedFormatData);', '\t\tres = wf_cliprdr_get_filedescriptor(clipboard, &requestedFormatData);\n\t\tclipboard->localFileSequence = GetClipboardSequenceNumber();');
  adapt(win, '\tcbRequested = fileContentsRequest->cbRequested;', `    if (dssh_desktop_locked() || fileContentsRequest->cbRequested > 4 * 1024 * 1024 ||
        clipboard->localFileSequence != GetClipboardSequenceNumber())
        return dssh_clipboard_deny_file_request(context, fileContentsRequest);
\tcbRequested = fileContentsRequest->cbRequested;`);
  // Bound native waits, and wake pending reads before destroying the channel.
  adapt(win, 'WaitForSingleObject(clipboard->response_data_event, INFINITE)', 'WaitForSingleObject(clipboard->response_data_event, 15000)');
  adapt(win, 'WaitForSingleObject(clipboard->req_fevent, INFINITE)', 'WaitForSingleObject(clipboard->req_fevent, 15000)');
  adapt(win, '\tcliprdr->custom = nullptr;\n', '\tcliprdr->custom = nullptr;\n\tif (clipboard->response_data_event) SetEvent(clipboard->response_data_event);\n\tif (clipboard->req_fevent) SetEvent(clipboard->req_fevent);');
}
