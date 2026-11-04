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

// Store proportions of the available travel area, so resizing / DPI changes
// keep the whole bar reachable. Coordinates are relative to the desktop top-left.
typedef struct DsshChromePosition {
    float x, y;
} DsshChromePosition;

static inline float dssh_chrome_clamp(float value, float maximum)
{
    return value < 0 ? 0 : (value > maximum ? maximum : value);
}

static inline SDL_FRect dssh_chrome_frame(DsshChromePosition position, float width,
                                         float height, float barWidth, float barHeight)
{
    SDL_FRect frame = {0};
    frame.w = dssh_chrome_clamp(barWidth, width);
    frame.h = dssh_chrome_clamp(barHeight, height);
    frame.x = dssh_chrome_clamp(position.x, 1) * (width - frame.w);
    frame.y = dssh_chrome_clamp(position.y, 1) * (height - frame.h);
    return frame;
}

static inline void dssh_chrome_move(DsshChromePosition* position, float x, float y,
                                     float travelWidth, float travelHeight)
{
    // A temporarily narrow window must not erase the remembered position.
    if (travelWidth > 0) position->x = dssh_chrome_clamp(x / travelWidth, 1);
    if (travelHeight > 0) position->y = dssh_chrome_clamp(y / travelHeight, 1);
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
bool dssh_chrome_test_drag(SDL_Window* window);
#endif
#ifdef __cplusplus
}
#endif
