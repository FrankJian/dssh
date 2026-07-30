import { listen } from "@tauri-apps/api/event";
import type { SessionStatus, TerminalSession, TerminalSize } from "../models";
import { invokeCommand } from "./tauri";

export interface StartSshSessionRequest {
  profileId: string;
  size: TerminalSize;
}

export interface StartLocalSessionRequest {
  size: TerminalSize;
}

export interface WriteSshSessionRequest {
  sessionId: string;
  data: string;
}

export interface ResizeSshSessionRequest {
  sessionId: string;
  size: TerminalSize;
}

export interface TerminalOutputEvent {
  sessionId: string;
  data: string;
}

export interface TerminalStatusEvent {
  sessionId: string;
  status: SessionStatus;
  message?: string;
}

export function listSshSessions() {
  return invokeCommand<TerminalSession[]>("list_ssh_sessions");
}

export function readSshSessionOutput(sessionId: string) {
  return invokeCommand<string>("read_ssh_session_output", { sessionId });
}

export function startSshSession(request: StartSshSessionRequest) {
  return invokeCommand<TerminalSession>("start_ssh_session", { request });
}

export function startLocalSession(request: StartLocalSessionRequest) {
  return invokeCommand<TerminalSession>("start_local_session", { request });
}

export function writeSshSession(request: WriteSshSessionRequest) {
  return invokeCommand<void>("write_ssh_session", { request });
}

export function resizeSshSession(request: ResizeSshSessionRequest) {
  return invokeCommand<void>("resize_ssh_session", { request });
}

export function closeSshSession(sessionId: string) {
  return invokeCommand<void>("close_ssh_session", { sessionId });
}

export function cancelReconnect(sessionId: string) {
  return invokeCommand<void>("cancel_reconnect", { sessionId });
}

export interface HostKeyPromptEvent {
  promptId: string;
  host: string;
  port: number;
  fingerprint: string;
}

export interface HostKeyChangedEvent {
  host: string;
  port: number;
  storedFingerprint: string;
  presentedFingerprint: string;
}

export interface SshTransportStatusEvent {
  profileId: string;
  state: "connecting" | "ready" | "reconnecting" | "failed";
  message?: string;
}

export function respondHostKeyPrompt(promptId: string, accept: boolean) {
  return invokeCommand<void>("respond_host_key_prompt", { promptId, accept });
}

export function onHostKeyPrompt(handler: (event: HostKeyPromptEvent) => void) {
  return listen<HostKeyPromptEvent>("ssh://hostkey-prompt", (event) => handler(event.payload));
}

export function onHostKeyChanged(handler: (event: HostKeyChangedEvent) => void) {
  return listen<HostKeyChangedEvent>("ssh://hostkey-changed", (event) => handler(event.payload));
}

export function onSshTransportStatus(handler: (event: SshTransportStatusEvent) => void) {
  return listen<SshTransportStatusEvent>("ssh://transport-status", (event) => handler(event.payload));
}

export function onTerminalOutput(handler: (event: TerminalOutputEvent) => void) {
  return listen<TerminalOutputEvent>("terminal-output", (event) => handler(event.payload));
}

export function onTerminalStatus(handler: (event: TerminalStatusEvent) => void) {
  return listen<TerminalStatusEvent>("terminal-status", (event) => handler(event.payload));
}
