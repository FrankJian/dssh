// Native chrome only; no dependency on runtime files or the current directory.
#pragma once
#include <SDL3/SDL.h>

extern "C" void dssh_set_application_icon();
void dssh_set_window_icon(SDL_Window* window);
