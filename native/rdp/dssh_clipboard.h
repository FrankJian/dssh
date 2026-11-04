#pragma once
#include <string.h>
#include <freerdp/settings.h>
#include <freerdp/channels/cliprdr.h>
#include <freerdp/client/cliprdr.h>
#include "dssh_visibility_state.h"

/* Shared allowlist: the UI modes never imply image / HTML / arbitrary format
 * sharing. Check both advertisements and requests, not just command flags. */
static inline BOOL dssh_clipboard_files(const rdpSettings* settings)
{
    return !dssh_desktop_locked() && freerdp_settings_get_bool(settings, FreeRDP_RedirectClipboard) &&
        (freerdp_settings_get_uint32(settings, FreeRDP_ClipboardFeatureMask) &
         (CLIPRDR_FLAG_LOCAL_TO_REMOTE_FILES | CLIPRDR_FLAG_REMOTE_TO_LOCAL_FILES));
}

static inline BOOL dssh_clipboard_format(const rdpSettings* settings, UINT32 id, const char* name)
{
    if (dssh_desktop_locked() || !freerdp_settings_get_bool(settings, FreeRDP_RedirectClipboard)) return FALSE;
    if (!name || !*name) return id == 1 || id == 7 || id == 13; /* CF_TEXT/OEM/UNICODETEXT */
    if ((id == 1 && strcmp(name, "CF_TEXT") == 0) ||
        (id == 7 && strcmp(name, "CF_OEMTEXT") == 0) ||
        (id == 13 && strcmp(name, "CF_UNICODETEXT") == 0)) return TRUE;
    return dssh_clipboard_files(settings) &&
        (strcmp(name, "FileGroupDescriptorW") == 0 || strcmp(name, "FileContents") == 0);
}

static inline UINT dssh_clipboard_deny_file_request(CliprdrClientContext* clip,
                                                    const CLIPRDR_FILE_CONTENTS_REQUEST* request)
{
    CLIPRDR_FILE_CONTENTS_RESPONSE denied = {0};
    denied.common.msgType = CB_FILECONTENTS_RESPONSE;
    denied.common.msgFlags = CB_RESPONSE_FAIL;
    denied.streamId = request->streamId;
    return clip->ClientFileContentsResponse(clip, &denied);
}

static inline UINT dssh_clipboard_ignore_file_response(CliprdrClientContext* clip,
                                                       const CLIPRDR_FILE_CONTENTS_RESPONSE* response)
{
    (void)clip; (void)response;
    return 0;
}

#ifdef __cplusplus
extern "C" {
#endif
#ifdef _WIN32
BOOL dssh_win_clipboard_init(rdpContext* context, CliprdrClientContext* clip);
BOOL dssh_win_clipboard_uninit(rdpContext* context, CliprdrClientContext* clip);
#endif
#ifdef __cplusplus
}
#endif
