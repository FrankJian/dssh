#include "dssh_clipboard.h"
#include <cstdio>
#include <initializer_list>

static bool deniedRequest = false;
static bool locked = false;
extern "C" bool dssh_desktop_locked(void) { return locked; }
static UINT receiveDenied(CliprdrClientContext*, const CLIPRDR_FILE_CONTENTS_RESPONSE* response)
{
    deniedRequest = response->common.msgFlags == CB_RESPONSE_FAIL &&
        response->streamId == 42 && response->cbRequested == 0 && !response->requestedData;
    return 0;
}

int main()
{
    auto settings = freerdp_settings_new(0);
    if (!settings) return 1;
    freerdp_settings_set_bool(settings, FreeRDP_RedirectClipboard, FALSE);
    freerdp_settings_set_uint32(settings, FreeRDP_ClipboardFeatureMask, CLIPRDR_FLAG_DEFAULT_MASK);
    if (dssh_clipboard_format(settings, 13, nullptr) || dssh_clipboard_files(settings)) return 2;
    freerdp_settings_set_bool(settings, FreeRDP_RedirectClipboard, TRUE);
    for (bool files : {false, true}) {
        freerdp_settings_set_uint32(settings, FreeRDP_ClipboardFeatureMask,
            CLIPRDR_FLAG_LOCAL_TO_REMOTE | CLIPRDR_FLAG_REMOTE_TO_LOCAL |
            (files ? CLIPRDR_FLAG_LOCAL_TO_REMOTE_FILES | CLIPRDR_FLAG_REMOTE_TO_LOCAL_FILES : 0));
        if (!dssh_clipboard_format(settings, 13, nullptr) ||
            !dssh_clipboard_format(settings, 13, "CF_UNICODETEXT") ||
            !dssh_clipboard_format(settings, 1, "CF_TEXT") ||
            !dssh_clipboard_format(settings, 7, nullptr)) return 3;
        if (dssh_clipboard_format(settings, 8, nullptr) ||
            dssh_clipboard_format(settings, 0xc100, "HTML Format") ||
            dssh_clipboard_format(settings, 0xc101, "image/png") ||
            dssh_clipboard_format(settings, 0xc102, "unknown")) return 4;
        if (bool(dssh_clipboard_format(settings, 0xc103, "FileGroupDescriptorW")) != files ||
            bool(dssh_clipboard_format(settings, 0xc104, "FileContents")) != files) return 5;
        if (!files && dssh_clipboard_format(settings, 13, "FileGroupDescriptorW")) return 6;
    }
    CliprdrClientContext channel = {};
    channel.ClientFileContentsResponse = receiveDenied;
    CLIPRDR_FILE_CONTENTS_REQUEST request = {};
    request.streamId = 42;
    request.cbRequested = 1024 * 1024;
    if (dssh_clipboard_deny_file_request(&channel, &request) || !deniedRequest) return 7;
    locked = true;
    if (dssh_clipboard_files(settings) || dssh_clipboard_format(settings, 13, nullptr) ||
        dssh_clipboard_format(settings, 0xc103, "FileGroupDescriptorW")) return 8;
    freerdp_settings_free(settings);
    std::puts("Clipboard off/text/files policy and denied file response passed");
    return 0;
}
