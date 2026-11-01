import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { WINDOWS_CRT, WINDOWS_TRIPLET, windowsCmakeArguments, validateWindowsRuntime } from "./rdp-windows.mjs";

const cache = (triplet = WINDOWS_TRIPLET, runtime = WINDOWS_CRT) => [
  `VCPKG_TARGET_TRIPLET:STRING=${triplet}`,
  `CMAKE_MSVC_RUNTIME_LIBRARY:STRING=${runtime}`,
  "BUILD_SHARED_LIBS:BOOL=OFF", "WITH_SDL_LINK_SHARED:BOOL=OFF",
].join("\r\n");

test("rejects the exact /MT FreeRDP + /MD dependency combination from the failed CI job", () => {
  assert.throws(() => validateWindowsRuntime(cache("x64-windows-static-md")), /VCPKG_TARGET_TRIPLET/);
  assert.throws(() => validateWindowsRuntime(cache(WINDOWS_TRIPLET, WINDOWS_CRT + "DLL")), /CMAKE_MSVC_RUNTIME_LIBRARY/);
  assert.doesNotThrow(() => validateWindowsRuntime(cache()));
});

test("refuses incomplete or shared-library caches before linking", () => {
  assert.throws(() => validateWindowsRuntime(""), /mismatch/);
  assert.throws(() => validateWindowsRuntime(cache().replace("BUILD_SHARED_LIBS:BOOL=OFF", "BUILD_SHARED_LIBS:BOOL=ON")), /BUILD_SHARED_LIBS/);
  assert.throws(() => validateWindowsRuntime(cache().replace("WITH_SDL_LINK_SHARED:BOOL=OFF", "WITH_SDL_LINK_SHARED:BOOL=ON")), /WITH_SDL_LINK_SHARED/);
});

test("CMake receives the explicit static CRT setting without shell expansion", () => {
  const args = windowsCmakeArguments("C:\\vcpkg");
  assert.ok(args.includes(`-DCMAKE_MSVC_RUNTIME_LIBRARY:STRING=${WINDOWS_CRT}`));
  assert.ok(args.includes(`-DVCPKG_TARGET_TRIPLET:STRING=${WINDOWS_TRIPLET}`));
  assert.ok(args.includes("-DCMAKE_TOOLCHAIN_FILE=C:\\vcpkg\\scripts\\buildsystems\\vcpkg.cmake"));
  assert.throws(() => windowsCmakeArguments(undefined), /VCPKG_ROOT/);
});

test("the CI dependency installation uses the same triplet as the native worker", () => {
  const workflow = readFileSync(new URL("../.github/actions/build-rdp/action.yml", import.meta.url), "utf8");
  const triplet = /vcpkg\.exe[^\n]*--triplet\s+([^\s]+)/.exec(workflow)?.[1];
  assert.equal(triplet, WINDOWS_TRIPLET);
});
