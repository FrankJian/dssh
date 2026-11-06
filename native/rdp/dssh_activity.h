#pragma once
#include <SDL3/SDL.h>

typedef struct DsshActivityThrottle {
    bool sent;
    Uint64 last;
} DsshActivityThrottle;

static inline bool dssh_activity_due(DsshActivityThrottle* state, Uint64 now)
{
    if (state->sent && now - state->last < 1000) return false;
    state->sent = true;
    state->last = now;
    return true;
}

static inline bool dssh_activity_input(const SDL_Event* event)
{
    switch (event->type) {
        case SDL_EVENT_KEY_DOWN:
        case SDL_EVENT_KEY_UP:
        case SDL_EVENT_TEXT_INPUT:
        case SDL_EVENT_MOUSE_BUTTON_DOWN:
        case SDL_EVENT_MOUSE_BUTTON_UP:
        case SDL_EVENT_MOUSE_WHEEL:
        case SDL_EVENT_FINGER_DOWN:
        case SDL_EVENT_FINGER_UP:
        case SDL_EVENT_FINGER_MOTION: return true;
        case SDL_EVENT_MOUSE_MOTION: return event->motion.xrel != 0 || event->motion.yrel != 0;
        default: return false;
    }
}

#ifdef __cplusplus
extern "C" {
#endif
void dssh_record_activity(SDL_Window* window);
void dssh_record_input_activity(const SDL_Event* event);
#ifdef __cplusplus
}
#endif
