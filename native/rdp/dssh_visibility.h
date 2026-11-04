#pragma once
#include <stdbool.h>
#include <SDL3/SDL.h>
#include "dssh_visibility_state.h"

enum { DSSH_DESKTOP_VISIBILITY = 0x445310 };
#ifdef __cplusplus
extern "C" {
#endif
void dssh_request_desktop_lock(bool locked);
void dssh_visibility_created(SDL_Window* window);
void dssh_visibility_tick(void);
bool dssh_input_lock_entered(void);
bool dssh_visibility_blocks(const SDL_Event* event);
#ifdef __cplusplus
}
#endif
