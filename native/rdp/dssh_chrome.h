#pragma once
#include <SDL3/SDL.h>

enum DsshChromeAction {
    DSSH_CHROME_MINIMIZE = 0x445301,
    DSSH_CHROME_MAXIMIZE,
    DSSH_CHROME_FULLSCREEN,
    DSSH_CHROME_CLOSE
};

typedef struct DsshChromeReveal {
    bool visible;
    Uint64 hoveredAt;
} DsshChromeReveal;

static inline bool dssh_chrome_reveal(DsshChromeReveal* state, bool active,
                                      bool atEdge, bool insideBar, Uint64 now)
{
    if (!active) state->visible = false;
    else if (atEdge || (state->visible && insideBar)) {
        state->visible = true;
        state->hoveredAt = now;
    } else if (now - state->hoveredAt >= 650) state->visible = false;
    return state->visible;
}

static inline void dssh_chrome_action(SDL_Window* window, int action)
{
    SDL_Event event = {0};
    event.type = SDL_EVENT_USER;
    event.user.windowID = SDL_GetWindowID(window);
    event.user.code = action;
    SDL_PushEvent(&event);
}

#ifdef __cplusplus
extern "C" {
#endif
void dssh_chrome_attach(SDL_Window* window);
void dssh_chrome_detach(SDL_Window* window);
void dssh_chrome_tick(void);
void dssh_chrome_hide_all(void);
bool dssh_chrome_set_locked(bool locked);
#ifdef DSSH_CHROME_TESTING
bool dssh_chrome_test_click(SDL_Window* window, int action);
bool dssh_chrome_test_visible(SDL_Window* window);
#endif
#ifdef __cplusplus
}
#endif
