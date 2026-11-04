#include "dssh_visibility.h"
#include "dssh_chrome.h"
#include <atomic>
#include <cstdio>
#ifdef _WIN32
#include <windows.h>
#include <dwmapi.h>
#endif

namespace {
std::atomic_bool requested{false};
std::atomic_uint64_t generation{0};
uint64_t applied = 0;
constexpr const char* restore = "dssh.lock.restore";
constexpr const char* focusable = "dssh.lock.focusable";
constexpr const char* state = "dssh.lock.window-state";
}

extern "C" bool dssh_desktop_locked(void) { return requested.load(); }
extern "C" bool dssh_input_lock_entered(void)
{
    static bool previous = false;
    const bool locked = dssh_desktop_locked();
    const bool entering = locked && !previous;
    previous = locked;
    return entering;
}
extern "C" void dssh_request_desktop_lock(bool locked)
{
    requested.store(locked);
    generation.fetch_add(1);
}

extern "C" void dssh_visibility_created(SDL_Window* window)
{
    if (!window || !dssh_desktop_locked()) return;
    // Desktop windows created during connection were deliberately born hidden.
    SDL_SetBooleanProperty(SDL_GetWindowProperties(window), restore, true);
    SDL_HideWindow(window);
}

extern "C" void dssh_visibility_tick(void)
{
    const auto serial = generation.load();
    const bool locked = dssh_desktop_locked();
    const bool platformSafe = dssh_chrome_set_locked(locked);
    int count = 0;
    auto windows = SDL_GetWindows(&count);
    bool success = platformSafe && (windows != nullptr || count == 0);
    for (int i = 0; windows && i < count; i++) {
        auto window = windows[i];
        const auto props = SDL_GetWindowProperties(window);
        const auto flags = SDL_GetWindowFlags(window);
#ifdef _WIN32
        auto hwnd = static_cast<HWND>(SDL_GetPointerProperty(props, SDL_PROP_WINDOW_WIN32_HWND_POINTER, nullptr));
        if (hwnd && (locked || SDL_HasProperty(props, restore))) {
            // Hiding removes the taskbar entry; cloaking additionally prevents
            // a queued native show/activation from revealing the locked desktop.
            const BOOL cloak = locked ? TRUE : FALSE;
            success = SUCCEEDED(DwmSetWindowAttribute(hwnd, DWMWA_CLOAK, &cloak, sizeof(cloak))) && success;
        }
#endif
        if (locked) {
            if (!SDL_HasProperty(props, restore))
                SDL_SetBooleanProperty(props, restore, !(flags & SDL_WINDOW_HIDDEN));
            if (!SDL_HasProperty(props, focusable))
                SDL_SetBooleanProperty(props, focusable, !(flags & SDL_WINDOW_NOT_FOCUSABLE));
            if (!SDL_HasProperty(props, state)) SDL_SetNumberProperty(props, state, static_cast<Sint64>(flags));
            if (!(flags & SDL_WINDOW_HIDDEN)) success = SDL_HideWindow(window) && success;
            success = SDL_SetWindowFocusable(window, false) && success;
        } else if (SDL_HasProperty(props, restore)) {
            success = SDL_SetWindowFocusable(window, SDL_GetBooleanProperty(props, focusable, true)) && success;
            if (SDL_GetBooleanProperty(props, restore, false)) {
                success = SDL_ShowWindow(window) && success;
                const auto previous = static_cast<SDL_WindowFlags>(SDL_GetNumberProperty(props, state, 0));
                if (previous & SDL_WINDOW_MINIMIZED) success = SDL_MinimizeWindow(window) && success;
                else if (previous & SDL_WINDOW_MAXIMIZED) success = SDL_MaximizeWindow(window) && success;
                if ((previous & SDL_WINDOW_FULLSCREEN) && !(SDL_GetWindowFlags(window) & SDL_WINDOW_FULLSCREEN))
                    success = SDL_SetWindowFullscreen(window, true) && success;
            }
            SDL_ClearProperty(props, restore);
            SDL_ClearProperty(props, focusable);
            SDL_ClearProperty(props, state);
        }
    }
    SDL_free(windows);
    if (locked) dssh_chrome_hide_all();
    // Ack only after the main thread has hidden every window and native bar.
    // A failed hide is retried; the supervisor bounds the wait and fails closed.
    if (success && serial != applied) {
        applied = serial;
        std::puts(locked ? "DSSH_RDP_V1 hidden" : "DSSH_RDP_V1 visible");
        std::fflush(stdout);
    }
}

extern "C" bool dssh_visibility_blocks(const SDL_Event* event)
{
    if (!dssh_desktop_locked()) return false;
    const auto type = event->type;
    return (type >= SDL_EVENT_KEY_DOWN && type < SDL_EVENT_MOUSE_MOTION) ||
        (type >= SDL_EVENT_MOUSE_MOTION && type <= SDL_EVENT_MOUSE_WHEEL) ||
        (type >= SDL_EVENT_FINGER_DOWN && type <= SDL_EVENT_FINGER_CANCELED) ||
        (type >= SDL_EVENT_DROP_FILE && type <= SDL_EVENT_DROP_POSITION) ||
        type == SDL_EVENT_WINDOW_FOCUS_GAINED || type == SDL_EVENT_WINDOW_SHOWN;
}
