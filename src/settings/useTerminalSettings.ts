import { useCallback, useEffect, useState } from "react";
import {
  clampFontSize,
  clampS3TransferConcurrency,
  COPY_ON_SELECT_DEFAULT,
  DEFAULT_FONT_FAMILY,
  FONT_SIZE_DEFAULT,
  FONT_SIZE_STEP,
  GPU_ACCELERATION_DEFAULT,
  normalizeFontFamily,
  normalizeRightClick,
  parseBoolean,
  type RightClickAction,
  terminalCopyOnSelectKey,
  terminalFontFamilyKey,
  terminalFontSizeKey,
  terminalGpuKey,
  terminalRightClickKey,
  terminalBgGlassBlurKey,
  terminalBgGlassEnabledKey,
  terminalBgImageKey,
  terminalBgOpacityKey,
  terminalWorkspaceInsetKey,
  terminalLineHeightKey,
  terminalLetterSpacingKey,
  clampTerminalLineHeight,
  clampTerminalLetterSpacing,
  TERMINAL_LINE_HEIGHT_DEFAULT,
  TERMINAL_LINE_HEIGHT_STEP,
  TERMINAL_LETTER_SPACING_DEFAULT,
  clampBgOpacity,
  clampTerminalBgGlassBlur,
  clampTerminalWorkspaceInset,
  TERMINAL_BG_GLASS_BLUR_DEFAULT,
  TERMINAL_BG_GLASS_ENABLED_DEFAULT,
  TERMINAL_BG_OPACITY_DEFAULT,
  TERMINAL_WORKSPACE_INSET_DEFAULT,
  s3DownloadConcurrencyKey,
  s3UploadConcurrencyKey,
  S3_TRANSFER_CONCURRENCY_DEFAULT,
} from "./settings";

function getStoredFontSize(): number {
  const raw = localStorage.getItem(terminalFontSizeKey);
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) ? clampFontSize(parsed) : FONT_SIZE_DEFAULT;
}

function getStoredFontFamily(): string {
  return normalizeFontFamily(localStorage.getItem(terminalFontFamilyKey));
}

function getStoredS3TransferConcurrency(key: string): number {
  const raw = localStorage.getItem(key);
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed)
    ? clampS3TransferConcurrency(parsed)
    : S3_TRANSFER_CONCURRENCY_DEFAULT;
}

export function useTerminalSettings() {
  const [fontSize, setFontSizeState] = useState<number>(() => getStoredFontSize());
  const [fontFamily, setFontFamilyState] = useState<string>(() => getStoredFontFamily());
  const [lineHeight, setLineHeightState] = useState<number>(() => {
    const raw = localStorage.getItem(terminalLineHeightKey);
    return raw ? clampTerminalLineHeight(Number.parseFloat(raw)) : TERMINAL_LINE_HEIGHT_DEFAULT;
  });
  const [letterSpacing, setLetterSpacingState] = useState<number>(() => {
    const raw = localStorage.getItem(terminalLetterSpacingKey);
    return raw
      ? clampTerminalLetterSpacing(Number.parseFloat(raw))
      : TERMINAL_LETTER_SPACING_DEFAULT;
  });
  const [copyOnSelect, setCopyOnSelectState] = useState<boolean>(() =>
    parseBoolean(localStorage.getItem(terminalCopyOnSelectKey), COPY_ON_SELECT_DEFAULT),
  );
  const [rightClick, setRightClickState] = useState<RightClickAction>(() =>
    normalizeRightClick(localStorage.getItem(terminalRightClickKey)),
  );
  const [gpuAcceleration, setGpuAccelerationState] = useState<boolean>(() =>
    parseBoolean(localStorage.getItem(terminalGpuKey), GPU_ACCELERATION_DEFAULT),
  );
  const [terminalBgImage, setTerminalBgImageState] = useState<string>(
    () => localStorage.getItem(terminalBgImageKey) ?? "",
  );
  const [terminalBgOpacity, setTerminalBgOpacityState] = useState<number>(() => {
    const raw = localStorage.getItem(terminalBgOpacityKey);
    return raw ? clampBgOpacity(Number.parseInt(raw, 10)) : TERMINAL_BG_OPACITY_DEFAULT;
  });
  const [terminalBgGlassEnabled, setTerminalBgGlassEnabledState] = useState<boolean>(() =>
    parseBoolean(localStorage.getItem(terminalBgGlassEnabledKey), TERMINAL_BG_GLASS_ENABLED_DEFAULT),
  );
  const [terminalBgGlassBlur, setTerminalBgGlassBlurState] = useState<number>(() => {
    const raw = localStorage.getItem(terminalBgGlassBlurKey);
    return raw ? clampTerminalBgGlassBlur(Number.parseInt(raw, 10)) : TERMINAL_BG_GLASS_BLUR_DEFAULT;
  });
  const [terminalWorkspaceInset, setTerminalWorkspaceInsetState] = useState<number>(() => {
    const raw = localStorage.getItem(terminalWorkspaceInsetKey);
    return raw
      ? clampTerminalWorkspaceInset(Number.parseInt(raw, 10))
      : TERMINAL_WORKSPACE_INSET_DEFAULT;
  });
  const [s3UploadConcurrency, setS3UploadConcurrencyState] = useState<number>(() =>
    getStoredS3TransferConcurrency(s3UploadConcurrencyKey),
  );
  const [s3DownloadConcurrency, setS3DownloadConcurrencyState] = useState<number>(() =>
    getStoredS3TransferConcurrency(s3DownloadConcurrencyKey),
  );

  useEffect(() => {
    localStorage.setItem(terminalFontSizeKey, String(fontSize));
  }, [fontSize]);

  useEffect(() => {
    localStorage.setItem(terminalFontFamilyKey, fontFamily);
  }, [fontFamily]);

  useEffect(() => {
    localStorage.setItem(terminalLineHeightKey, String(lineHeight));
  }, [lineHeight]);

  useEffect(() => {
    localStorage.setItem(terminalLetterSpacingKey, String(letterSpacing));
  }, [letterSpacing]);

  useEffect(() => {
    localStorage.setItem(terminalCopyOnSelectKey, String(copyOnSelect));
  }, [copyOnSelect]);

  useEffect(() => {
    localStorage.setItem(terminalRightClickKey, rightClick);
  }, [rightClick]);

  useEffect(() => {
    localStorage.setItem(terminalGpuKey, String(gpuAcceleration));
  }, [gpuAcceleration]);

  useEffect(() => {
    localStorage.setItem(terminalBgImageKey, terminalBgImage);
  }, [terminalBgImage]);

  useEffect(() => {
    localStorage.setItem(terminalBgOpacityKey, String(terminalBgOpacity));
  }, [terminalBgOpacity]);

  useEffect(() => {
    localStorage.setItem(terminalBgGlassEnabledKey, String(terminalBgGlassEnabled));
  }, [terminalBgGlassEnabled]);

  useEffect(() => {
    localStorage.setItem(terminalBgGlassBlurKey, String(terminalBgGlassBlur));
  }, [terminalBgGlassBlur]);

  useEffect(() => {
    localStorage.setItem(terminalWorkspaceInsetKey, String(terminalWorkspaceInset));
  }, [terminalWorkspaceInset]);

  useEffect(() => {
    localStorage.setItem(s3UploadConcurrencyKey, String(s3UploadConcurrency));
  }, [s3UploadConcurrency]);

  useEffect(() => {
    localStorage.setItem(s3DownloadConcurrencyKey, String(s3DownloadConcurrency));
  }, [s3DownloadConcurrency]);

  const setCopyOnSelect = useCallback((value: boolean) => {
    setCopyOnSelectState(value);
  }, []);

  const setGpuAcceleration = useCallback((value: boolean) => {
    setGpuAccelerationState(value);
  }, []);

  const setTerminalBgImage = useCallback((value: string) => {
    setTerminalBgImageState(value);
  }, []);

  const setTerminalBgOpacity = useCallback((value: number) => {
    setTerminalBgOpacityState(clampBgOpacity(value));
  }, []);

  const setTerminalBgGlassEnabled = useCallback((value: boolean) => {
    setTerminalBgGlassEnabledState(value);
  }, []);

  const setTerminalBgGlassBlur = useCallback((value: number) => {
    setTerminalBgGlassBlurState(clampTerminalBgGlassBlur(value));
  }, []);

  const setTerminalWorkspaceInset = useCallback((value: number) => {
    setTerminalWorkspaceInsetState(clampTerminalWorkspaceInset(value));
  }, []);

  const setRightClick = useCallback((value: RightClickAction) => {
    setRightClickState(normalizeRightClick(value));
  }, []);

  const setS3UploadConcurrency = useCallback((value: number) => {
    setS3UploadConcurrencyState(clampS3TransferConcurrency(value));
  }, []);

  const setS3DownloadConcurrency = useCallback((value: number) => {
    setS3DownloadConcurrencyState(clampS3TransferConcurrency(value));
  }, []);

  const setFontFamily = useCallback((value: string) => {
    setFontFamilyState(normalizeFontFamily(value));
  }, []);

  const resetFontFamily = useCallback(() => {
    setFontFamilyState(DEFAULT_FONT_FAMILY);
  }, []);

  const setFontSize = useCallback((value: number) => {
    setFontSizeState(clampFontSize(value));
  }, []);

  const increaseFontSize = useCallback(() => {
    setFontSizeState((current) => clampFontSize(current + FONT_SIZE_STEP));
  }, []);

  const decreaseFontSize = useCallback(() => {
    setFontSizeState((current) => clampFontSize(current - FONT_SIZE_STEP));
  }, []);

  const resetFontSize = useCallback(() => {
    setFontSizeState(FONT_SIZE_DEFAULT);
  }, []);

  const setLineHeight = useCallback((value: number) => {
    setLineHeightState(clampTerminalLineHeight(value));
  }, []);

  const stepLineHeight = useCallback((direction: 1 | -1) => {
    setLineHeightState((current) => clampTerminalLineHeight(current + direction * TERMINAL_LINE_HEIGHT_STEP));
  }, []);

  const resetLineHeight = useCallback(() => {
    setLineHeightState(TERMINAL_LINE_HEIGHT_DEFAULT);
  }, []);

  const setLetterSpacing = useCallback((value: number) => {
    setLetterSpacingState(clampTerminalLetterSpacing(value));
  }, []);

  const resetLetterSpacing = useCallback(() => {
    setLetterSpacingState(TERMINAL_LETTER_SPACING_DEFAULT);
  }, []);

  return {
    fontSize,
    setFontSize,
    increaseFontSize,
    decreaseFontSize,
    resetFontSize,
    fontFamily,
    setFontFamily,
    resetFontFamily,
    lineHeight,
    setLineHeight,
    stepLineHeight,
    resetLineHeight,
    letterSpacing,
    setLetterSpacing,
    resetLetterSpacing,
    copyOnSelect,
    setCopyOnSelect,
    rightClick,
    setRightClick,
    gpuAcceleration,
    setGpuAcceleration,
    terminalBgImage,
    setTerminalBgImage,
    terminalBgOpacity,
    setTerminalBgOpacity,
    terminalBgGlassEnabled,
    setTerminalBgGlassEnabled,
    terminalBgGlassBlur,
    setTerminalBgGlassBlur,
    terminalWorkspaceInset,
    setTerminalWorkspaceInset,
    s3UploadConcurrency,
    setS3UploadConcurrency,
    s3DownloadConcurrency,
    setS3DownloadConcurrency,
  };
}
