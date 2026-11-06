#include "dssh_activity.h"
#include "dssh_visibility_state.h"
#include <cstdio>

extern "C" void dssh_record_activity(SDL_Window* window)
{
    // Input and native controls run on SDL's UI thread. No global keyboard
    // hooks, key values, mouse coordinates or file paths cross this pipe.
    if (!window || dssh_desktop_locked()) return;
    const auto flags = SDL_GetWindowFlags(window);
    if (flags & (SDL_WINDOW_HIDDEN | SDL_WINDOW_MINIMIZED)) return;
    if (SDL_GetKeyboardFocus() != window) return;
    static DsshActivityThrottle throttle = {};
    if (!dssh_activity_due(&throttle, SDL_GetTicks())) return;
    std::printf("DSSH_RDP_V1 activity\n");
    std::fflush(stdout);
}

extern "C" void dssh_record_input_activity(const SDL_Event* event)
{
    if (event && dssh_activity_input(event)) dssh_record_activity(SDL_GetWindowFromEvent(event));
}
