#include "dssh_window.hpp"
#include "dssh_chrome.h"
#include "dssh_visibility.h"
#include <cstring>
#include <cstdlib>
#include <cstdio>
#if defined(_WIN32)
#include <windows.h>
#include <imm.h>
#endif

int main(int argc, char** argv)
{
    const bool previewMode = (argc == 2 && std::strcmp(argv[1], "--preview") == 0) || std::getenv("DSSH_RDP_CHROME_PREVIEW");
    DsshChromeReveal reveal = {};
    if (dssh_chrome_reveal(&reveal, false, true, false, 0)) return 16;
    if (!dssh_chrome_reveal(&reveal, true, true, false, 10)) return 17;
    if (!dssh_chrome_reveal(&reveal, true, false, true, 20)) return 18;
    if (!dssh_chrome_reveal(&reveal, true, false, false, 669)) return 19;
    if (dssh_chrome_reveal(&reveal, true, false, false, 670)) return 20;
    if (!dssh_chrome_reveal(&reveal, true, true, false, 680)) return 21;
    if (dssh_chrome_reveal(&reveal, false, false, true, 690)) return 22;
    DsshChromePosition position = {0.5f, 0};
    auto barFrame = dssh_chrome_frame(position, 1000, 700, 460, 38);
    if (barFrame.x != 270 || barFrame.y != 0) return 60;
    dssh_chrome_move(&position, 900, -50, 540, 662);
    barFrame = dssh_chrome_frame(position, 1000, 700, 460, 38);
    if (barFrame.x != 540 || barFrame.y != 0) return 61;
    dssh_chrome_move(&position, -500, 900, 540, 662);
    barFrame = dssh_chrome_frame(position, 300, 200, 460, 38);
    if (barFrame.x != 0 || barFrame.y != 162 || barFrame.w != 300) return 62;
    barFrame = dssh_chrome_frame(position, 300, 20, 460, 38);
    if (barFrame.x != 0 || barFrame.y != 0 || barFrame.h != 20) return 63;
    dssh_chrome_move(&position, 1, 1, 0, 0);
    if (position.x != 0 || position.y != 1) return 64;
    SDL_Event closeEvent = {};
    closeEvent.type = SDL_EVENT_WINDOW_CLOSE_REQUESTED;
    if (!dssh_is_system_close(closeEvent, true)) return 25;
    if (dssh_is_system_close(closeEvent, false)) return 26;
    closeEvent.type = SDL_EVENT_QUIT;
    if (!dssh_is_system_close(closeEvent, false)) return 27;
    closeEvent.type = SDL_EVENT_WINDOW_MINIMIZED;
    if (dssh_is_system_close(closeEvent, true)) return 28;
    auto settings = freerdp_settings_new(0);
    if (!settings) return 13;
    freerdp_settings_set_bool(settings, FreeRDP_Fullscreen, TRUE);
    freerdp_settings_set_bool(settings, FreeRDP_UseMultimon, TRUE);
    freerdp_settings_set_bool(settings, FreeRDP_ForceMultimon, TRUE);
    freerdp_settings_set_bool(settings, FreeRDP_SpanMonitors, TRUE);
    freerdp_settings_set_bool(settings, FreeRDP_Decorations, FALSE);
    freerdp_settings_set_bool(settings, FreeRDP_SmartSizing, FALSE);
    const bool policy = dssh_apply_window_policy(settings) &&
        !freerdp_settings_get_bool(settings, FreeRDP_Fullscreen) &&
        !freerdp_settings_get_bool(settings, FreeRDP_UseMultimon) &&
        !freerdp_settings_get_bool(settings, FreeRDP_ForceMultimon) &&
        !freerdp_settings_get_bool(settings, FreeRDP_SpanMonitors) &&
        freerdp_settings_get_bool(settings, FreeRDP_Decorations) &&
        freerdp_settings_get_bool(settings, FreeRDP_SmartSizing);
    for (const bool adaptive : {true, false, true}) {
        freerdp_settings_set_bool(settings, FreeRDP_DynamicResolutionUpdate, adaptive);
        freerdp_settings_set_bool(settings, FreeRDP_SmartSizing, adaptive);
        if (!dssh_apply_window_policy(settings) ||
            bool(freerdp_settings_get_bool(settings, FreeRDP_DynamicResolutionUpdate)) != adaptive ||
            bool(freerdp_settings_get_bool(settings, FreeRDP_SmartSizing)) == adaptive) return 66;
    }
    freerdp_settings_free(settings);
    if (!policy) return 14;
    // Oversized desktop on a secondary monitor, with a taskbar / title bar.
    const SDL_Rect usable{-1920, 40, 1920, 1000};
    const auto rect = dssh_window_geometry(3840, 2160, usable, 32, 8, 8, 8);
    if (rect.x - 8 < usable.x || rect.y - 32 < usable.y ||
        rect.x + rect.w + 8 > usable.x + usable.w ||
        rect.y + rect.h + 8 > usable.y + usable.h) return 1;
    if (std::abs(double(rect.w) / rect.h - 3840.0 / 2160.0) > 0.01) return 2;
    const auto compactWindow = dssh_window_geometry(640, 480, usable, 32, 8, 8, 8);
    if (compactWindow.w != 640 || compactWindow.h != 480) return 3;
#if defined(__APPLE__)
    // Keep this short-lived CI fixture off macOS Spaces; exercise SDL desktop
    // fullscreen without an asynchronous system Space animation.
    SDL_SetHint(SDL_HINT_VIDEO_MAC_FULLSCREEN_SPACES, "0");
#endif
    if (!SDL_Init(SDL_INIT_VIDEO)) return 4;
    auto window = SDL_CreateWindow("Duo SSH window regression", 3840, 2160, SDL_WINDOW_RESIZABLE);
    if (!window) { SDL_Quit(); return 5; }
    const auto display = SDL_GetDisplayForWindow(window);
    // Exercise a real fullscreen -> decorated-window transition, not only a
    // newly created window that was already windowed.
    if (!previewMode) {
        SDL_SetWindowFullscreen(window, true);
        SDL_SyncWindow(window);
        if (!(SDL_GetWindowFlags(window) & SDL_WINDOW_FULLSCREEN)) return 15;
    }
    dssh_prepare_desktop_window(window, display);
    dssh_chrome_attach(window);
    if (previewMode) {
        SDL_RaiseWindow(window);
        SDL_SyncWindow(window);
        bool running = true;
        while (running) {
            dssh_chrome_tick();
            SDL_SetWindowTitle(window, dssh_chrome_test_visible(window) ? "Preview - toolbar visible" : "Preview - toolbar hidden");
            SDL_Event event = {};
            if (!SDL_WaitEventTimeout(&event, 60)) continue;
            if (event.type == SDL_EVENT_QUIT || event.type == SDL_EVENT_WINDOW_CLOSE_REQUESTED) running = false;
            if (event.type != SDL_EVENT_USER) continue;
            switch (event.user.code) {
                case DSSH_CHROME_MINIMIZE: SDL_MinimizeWindow(window); break;
                case DSSH_CHROME_MAXIMIZE:
                    if (SDL_GetWindowFlags(window) & SDL_WINDOW_FULLSCREEN) dssh_prepare_desktop_window(window, display);
                    else if (SDL_GetWindowFlags(window) & SDL_WINDOW_MAXIMIZED) SDL_RestoreWindow(window);
                    else SDL_MaximizeWindow(window);
                    break;
                case DSSH_CHROME_FULLSCREEN:
                    if (SDL_GetWindowFlags(window) & SDL_WINDOW_FULLSCREEN) dssh_prepare_desktop_window(window, display);
                    else SDL_SetWindowFullscreen(window, true);
                    break;
                case DSSH_CHROME_CLOSE: running = false; break;
            }
        }
        dssh_chrome_detach(window);
        SDL_DestroyWindow(window); SDL_Quit(); return 0;
    }
    for (int action = DSSH_CHROME_MINIMIZE; action <= DSSH_CHROME_CLOSE; action++) {
        // Exercise delivery even when a previous SDL poll cycle ended before
        // the callback queued its event. PollEvent may stop at this sentinel.
        SDL_Event sentinel = {};
        sentinel.type = SDL_EVENT_POLL_SENTINEL;
        if (!SDL_PushEvent(&sentinel)) {
            std::fprintf(stderr, "Could not queue poll sentinel: %s\n", SDL_GetError());
            return 29;
        }
        if (!dssh_chrome_test_click(window, action)) {
            std::fprintf(stderr, "Native toolbar click failed: action=%d SDL=%s\n", action, SDL_GetError());
            return 23;
        }
        SDL_PumpEvents();
        SDL_Event event = {};
        bool received = false;
        // Native button callbacks enqueue synchronously. Read their exact
        // event range, independent of unrelated window events and sentinels.
        int count = 0;
        while ((count = SDL_PeepEvents(&event, 1, SDL_GETEVENT, SDL_EVENT_USER, SDL_EVENT_USER)) > 0)
            if (event.type == SDL_EVENT_USER && event.user.code == action && event.user.windowID == SDL_GetWindowID(window)) received = true;
        SDL_FlushEvent(SDL_EVENT_POLL_SENTINEL);
        if (count < 0 || !received) {
            std::fprintf(stderr, "Missing toolbar event: action=%d window=%u queue=%d SDL=%s\n",
                         action, SDL_GetWindowID(window), count, SDL_GetError());
            return 24;
        }
    }
    if (!dssh_chrome_test_drag(window)) {
        std::fprintf(stderr, "Native toolbar drag failed\n");
        return 65;
    }
    const auto originalId = SDL_GetWindowID(window);
    auto alreadyHidden = SDL_CreateWindow("Hidden fixture", 100, 100, SDL_WINDOW_HIDDEN | SDL_WINDOW_NOT_FOCUSABLE);
    if (!alreadyHidden) return 35;
    dssh_request_desktop_lock(true);
    dssh_visibility_tick();
    dssh_visibility_tick(); // repeated idle checks must not overwrite restore state
    if (!(SDL_GetWindowFlags(window) & SDL_WINDOW_HIDDEN) ||
        !(SDL_GetWindowFlags(window) & SDL_WINDOW_NOT_FOCUSABLE) ||
        dssh_chrome_test_visible(window)) return 36;
    SDL_Event blocked = {};
    blocked.type = SDL_EVENT_KEY_DOWN;
    if (!dssh_visibility_blocks(&blocked)) return 37;
    blocked.type = SDL_EVENT_QUIT;
    if (dssh_visibility_blocks(&blocked)) return 38;
    SDL_ShowWindow(window); // a queued focus / show must not bypass the lock
    dssh_visibility_tick();
    if (!(SDL_GetWindowFlags(window) & SDL_WINDOW_HIDDEN)) return 39;
    auto createdHidden = SDL_CreateWindow("Created while locked", 100, 100, SDL_WINDOW_HIDDEN);
    if (!createdHidden) return 40;
    dssh_visibility_created(createdHidden);
    dssh_visibility_tick();
    if (!(SDL_GetWindowFlags(createdHidden) & SDL_WINDOW_HIDDEN)) return 41;
    dssh_request_desktop_lock(false);
    dssh_visibility_tick();
    SDL_SyncWindow(window);
    if (SDL_GetWindowID(window) != originalId || (SDL_GetWindowFlags(window) & (SDL_WINDOW_HIDDEN | SDL_WINDOW_NOT_FOCUSABLE))) return 42;
    if (SDL_GetWindowFlags(createdHidden) & SDL_WINDOW_HIDDEN) return 43;
    if (!(SDL_GetWindowFlags(alreadyHidden) & SDL_WINDOW_HIDDEN) ||
        !(SDL_GetWindowFlags(alreadyHidden) & SDL_WINDOW_NOT_FOCUSABLE)) return 44;
    SDL_DestroyWindow(createdHidden);
    SDL_DestroyWindow(alreadyHidden);
    SDL_SetWindowFullscreen(window, true);
    SDL_SyncWindow(window);
    dssh_request_desktop_lock(true);
    dssh_visibility_tick();
    dssh_request_desktop_lock(false);
    dssh_visibility_tick();
    SDL_SyncWindow(window);
    if (!(SDL_GetWindowFlags(window) & SDL_WINDOW_FULLSCREEN)) return 45;
    dssh_prepare_desktop_window(window, display);
    SDL_MinimizeWindow(window);
    SDL_SyncWindow(window);
    dssh_request_desktop_lock(true);
    dssh_visibility_tick();
    dssh_request_desktop_lock(false);
    dssh_visibility_tick();
    SDL_SyncWindow(window);
    if (!(SDL_GetWindowFlags(window) & SDL_WINDOW_MINIMIZED)) return 46;
    SDL_RestoreWindow(window);
    SDL_SyncWindow(window);
    const auto flags = SDL_GetWindowFlags(window);
    int width = 0, height = 0;
    SDL_GetWindowSize(window, &width, &height);
    SDL_Rect work = {};
    SDL_GetDisplayUsableBounds(display, &work);
    int result = 0;
    if (!(flags & SDL_WINDOW_RESIZABLE) || (flags & (SDL_WINDOW_BORDERLESS | SDL_WINDOW_FULLSCREEN))) result = 6;
    if (width >= work.w || height >= work.h) result = 7;
    int x = 0, y = 0, top = 0, left = 0, bottom = 0, right = 0;
    SDL_GetWindowPosition(window, &x, &y);
    if (SDL_GetWindowBordersSize(window, &top, &left, &bottom, &right) &&
        (x - left < work.x || y - top < work.y ||
         x + width + right > work.x + work.w || y + height + bottom > work.y + work.h)) result = 10;
    if (!SDL_SetWindowSize(window, width / 2, height / 2)) result = 8;
    SDL_SyncWindow(window);
    int resizedWidth = 0, resizedHeight = 0;
    SDL_GetWindowSize(window, &resizedWidth, &resizedHeight);
    if (resizedWidth != width / 2 || resizedHeight != height / 2) result = 9;
    SDL_SetWindowPosition(window, work.x + 48, work.y + 96);
    SDL_SyncWindow(window);
    int movedX = 0, movedY = 0;
    SDL_GetWindowPosition(window, &movedX, &movedY);
    if (movedX != work.x + 48 || movedY != work.y + 96) result = 11;
#if defined(_WIN32)
    auto hwnd = static_cast<HWND>(SDL_GetPointerProperty(SDL_GetWindowProperties(window),
                                                        SDL_PROP_WINDOW_WIN32_HWND_POINTER, nullptr));
    const LONG_PTR controls = WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX;
    if (!hwnd || (GetWindowLongPtrW(hwnd, GWL_STYLE) & controls) != controls) result = 12;
    auto context = ImmGetContext(hwnd);
    if (context) { ImmReleaseContext(hwnd, context); result = 30; }
    if (SDL_TextInputActive(window)) result = 31;
    dssh_restore_desktop_input(window);
    // Attach a real local IME context, then verify repeated focus preparation
    // detaches it and restores the same handle without destroying SDL's owner.
    auto fixture = ImmCreateContext();
    if (!fixture) { std::fprintf(stderr, "ImmCreateContext failed: %lu\n", GetLastError()); result = 32; }
    else {
        auto previous = ImmAssociateContext(hwnd, fixture);
        dssh_prepare_desktop_input(window);
        dssh_prepare_desktop_input(window);
        auto detached = ImmGetContext(hwnd);
        if (detached) { ImmReleaseContext(hwnd, detached); result = 33; }
        dssh_restore_desktop_input(window);
        auto restored = ImmGetContext(hwnd);
        if (restored != fixture) result = 34;
        if (restored) ImmReleaseContext(hwnd, restored);
        ImmAssociateContext(hwnd, previous);
        ImmDestroyContext(fixture);
    }
#endif
    dssh_chrome_detach(window);
    dssh_restore_desktop_input(window);
    SDL_DestroyWindow(window);
    SDL_Quit();
    return result;
}
