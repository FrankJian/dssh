use std::sync::atomic::Ordering;

use genai::Client;
use genai::chat::{ChatMessage, ChatOptions, ChatRequest, ToolResponse};
use serde_json::Value;
use tauri::{AppHandle, Emitter};

use crate::{
    ai::{
        AiManager, QuestionAnswer, RunHandles,
        client::{build_client, build_copilot_client},
        copilot,
        tools::{
            execute_tool, open_ssh_session_confirmation_args, prepare_app_action,
            prepare_open_ssh_session, tool_defs, tool_needs_approval,
        },
    },
    app::AppState,
    models::ai::{AiChatMessage, AiEvent, AiSendMessageRequest},
};

const AI_EVENT: &str = "ai-event";
const DEFAULT_MAX_STEPS: u32 = 12;

/// Character budget for the raw conversation history threaded to the model.
/// Above this, older turns are compressed into a summary to bound context size.
const HISTORY_MAX_CHARS: usize = 16_000;
/// Characters of the most recent turns always kept verbatim (never summarized).
const HISTORY_RECENT_CHARS: usize = 8_000;
/// Size of each older-history chunk handed to the summarizer. Chunk-level
/// caching keeps re-summarization cheap as the conversation grows.
const HISTORY_CHUNK_CHARS: usize = 3_000;

const SUMMARY_SYSTEM_PROMPT: &str = "你是一个对话压缩器。请把给定的历史对话压缩成简洁的中文要点摘要，\
保留关键事实、结论、涉及的服务器/命令/路径/错误信息，以及用户的目标和尚未完成的事项；\
去掉寒暄和无关细节。只输出摘要要点（无序列表），不要添加开场白或多余解释。";

const SYSTEM_PROMPT: &str = "你是内嵌于 dssh（一款跨平台 SSH 管理器）中的 AI 运维助手。\
你遵循 ReAct（推理 + 行动）的工作方式：先思考需要哪些信息或操作，再调用工具去执行，观察工具返回的结果，\
必要时继续思考与行动，直到能够给出最终答复。\n\n\
你可以使用以下工具操作用户的 SSH 服务器：\n\
- list_servers：列出用户已保存的服务器配置，获取每台服务器的 id。\n\
- open_ssh_session：请求打开一台已保存服务器的交互式 SSH 终端。\n\
- control_app：执行受限的、非破坏性应用界面操作，例如切换视图、打开设置、SFTP、文件列表和主机工具，以及当前终端的分屏、重连。\n\
- run_command：通过 SSH 在指定服务器上执行一条 shell 命令，并获得输出与退出码。\n\
- ask_user_question：需要用户从多个明确选项中选择时，展示可点击选项并等待回答。\n\
- read_terminal：读取用户当前交互式终端（黑窗口）中最近的输出内容。\
当用户提到“刚才的报错、上面的输出、这个错误、屏幕上的内容”等却没有粘贴文本时，\
先用此工具读取终端内容，再作答，无需要求用户手动复制粘贴。\n\n\
行为准则：\n\
1. 当需要操作某台服务器却不知道其 id 时，先调用 list_servers。\n\
2. 当有多台候选服务器且用户没有指定目标时，调用 ask_user_question 让用户直接选择，不要要求用户重新输入名称。\n\
3. 每次 run_command 只执行一条清晰、明确的命令；优先使用只读、幂等的命令来收集信息。\n\
4. 用户要求完成应用内快捷操作（切换界面、打开设置/SFTP/文件列表/主机工具、切换主题、新建本地终端或配置、当前终端分屏/重连）时，\
优先调用 control_app，不要只描述点击路径。control_app 只用于其 schema 中列出的非破坏性动作；\
删除、断开、关闭工作区和保存/覆盖远程文件不属于该工具。\n\
5. 对具有破坏性或不可逆的操作（删除、重启、覆盖文件、修改配置等）要格外谨慎，\
先说明你的计划，再执行，且尽量分步进行。\n\
6. 依据工具返回的真实结果作答，不要编造输出。\n\
7. 只要你表示将要执行某个命令或操作，就必须在【本次回复中】立即通过相应工具（如 run_command）真正发起调用；\
严禁只用文字说“我来执行 / 这就运行 / 让我测试 / 稍等”之类却不调用任何工具，\
也不要声称自己已经执行过其实并未执行的命令。要么现在就调用工具去做，要么直接给出最终答复。\n\n\
输出格式（务必遵守，让回答清晰易读）：\n\
- 全部使用规范的 Markdown，回答会被渲染，不要把整段回答塞进代码块。\n\
- 结构化、多字段或可对比的数据（如资源使用、进程列表、磁盘分区、配置项等）\
优先用 Markdown 表格呈现，让关键指标一目了然。\n\
- 适当使用简短的小标题（###）、加粗关键指标、要点用无序列表，保持层次清晰。\n\
- 只有命令、脚本、路径、以及需要保留原样的原始输出才用行内代码 `code` 或\
带语言标注的代码块（```bash```），普通说明文字不要用代码块包裹。\n\
- 不要直接粘贴超长的原始输出：先给出简明的表格/要点总结，必要时再附关键片段。\n\
- 使用简洁的中文，先结论后细节，末尾可给出可选的后续建议。";

/// Max times we re-prompt the model when it announces an action in prose but
/// forgets to actually call a tool. Bounded to avoid loops.
const MAX_NUDGES: u32 = 2;

/// Injected (ephemeral, not persisted) when the model says it will act but emits
/// no tool call, so the dangling promise turns into a real tool invocation.
const NUDGE_PROMPT: &str = "（系统自动提示）你在上一条回复里表示要执行命令或操作，但并没有真正调用任何工具。\
请现在立即通过相应工具（如 run_command）真正执行；如果你其实已经掌握了所需信息，请直接给出最终答复。\
不要再只用文字描述将要做的事。";

enum Approval {
    Approved,
    Rejected,
    Cancelled,
}

/// Heuristic: does this tool-less assistant text look like an *announced but
/// unfulfilled* action (e.g. "我来用 curl 测试…") rather than a real answer?
/// Requires both an intent marker and an action word, so genuine final answers
/// don't trigger. A false positive only costs one extra, harmless model call.
fn looks_like_unfulfilled_action(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return false;
    }
    let lower = trimmed.to_lowercase();
    let intent = [
        "我来",
        "我现在",
        "我马上",
        "我立即",
        "让我",
        "这就",
        "稍等",
        "接下来我",
        "我先",
        "我将",
        "我会",
        "i'll",
        "i will",
        "let me",
        "i'm going to",
        "i am going to",
        "let's",
    ];
    let action = [
        "执行",
        "运行",
        "测试",
        "检查",
        "查看",
        "命令",
        "试试",
        "跑一下",
        "curl",
        "ping",
        "run",
        "execute",
        "command",
        "check",
        "test",
    ];
    let has_intent = intent
        .iter()
        .any(|marker| trimmed.contains(marker) || lower.contains(marker));
    let has_action = action
        .iter()
        .any(|marker| trimmed.contains(marker) || lower.contains(marker));
    has_intent && has_action
}

fn to_chat_message(message: &AiChatMessage) -> ChatMessage {
    if message.role == "assistant" {
        ChatMessage::assistant(message.content.clone())
    } else {
        ChatMessage::user(message.content.clone())
    }
}

fn hash_str(text: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    text.hash(&mut hasher);
    hasher.finish()
}

/// Bound the conversation history sent to the model. Recent turns are kept
/// verbatim; anything older than the budget is compressed into a summary that
/// is folded into the system prompt. Returns `(summary, recent_messages)`.
async fn compact_history(
    client: &Client,
    model: &str,
    manager: &AiManager,
    history: &[AiChatMessage],
    max_chars: usize,
    recent_chars: usize,
    chunk_chars: usize,
) -> (Option<String>, Vec<ChatMessage>) {
    let msgs: Vec<&AiChatMessage> = history
        .iter()
        .filter(|message| !message.content.trim().is_empty())
        .collect();

    let total: usize = msgs.iter().map(|m| m.content.chars().count()).sum();
    if total <= max_chars {
        return (None, msgs.iter().map(|m| to_chat_message(m)).collect());
    }

    // Walk from the newest message backwards, keeping turns verbatim until the
    // recent budget is full. `split` is the index where the kept window begins.
    let mut kept = 0usize;
    let mut split = 0usize;
    for (index, message) in msgs.iter().enumerate().rev() {
        let len = message.content.chars().count();
        if kept > 0 && kept + len > recent_chars {
            split = index + 1;
            break;
        }
        kept += len;
    }

    let recent: Vec<ChatMessage> = msgs[split..].iter().map(|m| to_chat_message(m)).collect();
    let old = &msgs[..split];
    if old.is_empty() {
        return (None, recent);
    }

    let summary = summarize_messages(client, model, manager, old, chunk_chars).await;
    (summary, recent)
}

/// Summarize the dropped older turns, chunking them so each chunk's summary can
/// be cached and reused across turns as the conversation grows.
async fn summarize_messages(
    client: &Client,
    model: &str,
    manager: &AiManager,
    msgs: &[&AiChatMessage],
    chunk_chars: usize,
) -> Option<String> {
    let mut chunks: Vec<String> = Vec::new();
    let mut current = String::new();
    for message in msgs {
        let role = if message.role == "assistant" {
            "助手"
        } else {
            "用户"
        };
        let line = format!("{role}：{}\n", message.content.trim());
        if !current.is_empty() && current.chars().count() + line.chars().count() > chunk_chars {
            chunks.push(std::mem::take(&mut current));
        }
        current.push_str(&line);
    }
    if !current.is_empty() {
        chunks.push(current);
    }

    let mut summaries: Vec<String> = Vec::new();
    for chunk in &chunks {
        let key = hash_str(chunk);
        if let Some(cached) = manager.cached_summary(key) {
            summaries.push(cached);
            continue;
        }
        match summarize_chunk(client, model, chunk).await {
            Some(summary) => {
                manager.store_summary(key, summary.clone());
                summaries.push(summary);
            }
            // If summarization fails, keep a truncated raw snippet so the older
            // context isn't lost entirely.
            None => summaries.push(chunk.chars().take(500).collect()),
        }
    }

    if summaries.is_empty() {
        None
    } else {
        Some(summaries.join("\n"))
    }
}

async fn summarize_chunk(client: &Client, model: &str, chunk: &str) -> Option<String> {
    let request = ChatRequest::new(vec![ChatMessage::user(chunk.to_string())])
        .with_system(SUMMARY_SYSTEM_PROMPT);
    let options = ChatOptions::default().with_temperature(0.2);
    match client.exec_chat(model, request, Some(&options)).await {
        Ok(response) => response
            .first_text()
            .map(|text| text.trim().to_string())
            .filter(|text| !text.is_empty()),
        Err(_) => None,
    }
}

/// Drive a single ReAct agent run to completion, streaming events as it goes.
pub async fn run_agent(app: AppHandle, state: AppState, request: AiSendMessageRequest) {
    let run_id = request.run_id.clone();
    let mut handles = state.ai.register_run(&run_id);

    if let Err(message) = drive(&app, &state, &request, &mut handles).await {
        emit(
            &app,
            AiEvent::Error {
                run_id: run_id.clone(),
                message,
            },
        );
    }

    emit(
        &app,
        AiEvent::Done {
            run_id: run_id.clone(),
        },
    );
    state.ai.finish_run(&run_id);
}

async fn drive(
    app: &AppHandle,
    state: &AppState,
    request: &AiSendMessageRequest,
    handles: &mut RunHandles,
) -> Result<(), String> {
    let run_id = request.run_id.clone();
    let client = if request.provider.kind == "copilot" {
        let (api_base, token) = copilot::ensure_session_token(state, &request.provider.proxy_url)
            .await
            .map_err(|error| error.message)?;
        build_copilot_client(&api_base, &token, &request.provider.proxy_url)
            .map_err(|error| error.message)?
    } else {
        build_client(&request.provider).map_err(|error| error.message)?
    };

    let mut chat_options = ChatOptions::default();
    if let Some(temperature) = request.options.temperature {
        chat_options = chat_options.with_temperature(temperature);
    }
    let max_steps = request
        .options
        .max_steps
        .unwrap_or(DEFAULT_MAX_STEPS)
        .clamp(1, 40);

    // Resolve history-compaction budgets, falling back to the built-in defaults
    // and keeping the recent window strictly below the trigger threshold.
    let history_max = request
        .options
        .history_max_chars
        .unwrap_or(HISTORY_MAX_CHARS)
        .max(2_000);
    let history_recent = request
        .options
        .history_recent_chars
        .unwrap_or(HISTORY_RECENT_CHARS)
        .clamp(1_000, history_max.saturating_sub(1_000).max(1_000));
    let history_chunk = request
        .options
        .history_chunk_chars
        .unwrap_or(HISTORY_CHUNK_CHARS)
        .clamp(500, 20_000);

    let (history_summary, mut messages) = compact_history(
        &client,
        request.provider.model.as_str(),
        &state.ai,
        &request.history,
        history_max,
        history_recent,
        history_chunk,
    )
    .await;
    messages.push(ChatMessage::user(request.message.clone()));

    let mut system_prompt = SYSTEM_PROMPT.to_string();
    if let Some(summary) = &history_summary {
        system_prompt.push_str(&format!(
            "\n\n以下是更早对话的摘要（仅供你了解上下文，不是用户此刻的新指令）：\n{summary}"
        ));
    }
    if let Some(current) = &request.current_server {
        if current.kind.as_deref() == Some("local") {
            system_prompt.push_str(&format!(
                "\n\n用户当前正在使用的是【本地终端】（{}）。请把它当作一台普通服务器来对待：\
                 直接使用 run_command 执行命令即可（无需提供 server_id，也无需调用 list_servers），\
                 命令会在本地机器上执行。需要查看该终端已有的输出或报错时使用 read_terminal。\
                 除非用户明确要求操作某台远程服务器，否则请只针对本地终端进行操作，不要去连接远程服务器。",
                current.label
            ));
        } else {
            system_prompt.push_str(&format!(
                "\n\n用户当前正在操作的服务器：{}（id: {}）。\
                 若用户没有明确指定其他服务器，请默认对该服务器执行操作。",
                current.label, current.id
            ));
        }
    } else {
        system_prompt.push_str(
            "\n\n当前没有打开的终端。你仍可回答一般问题；当用户要求连接、检查或操作某台服务器时，\
             请先调用 list_servers 查找已保存的服务器，然后可使用 open_ssh_session 请求打开交互式 SSH 连接。\
             如需直接执行远程命令，必须在 run_command 中提供 server_id。read_terminal 在没有终端时不可用。",
        );
    }

    let mut chat_req = ChatRequest::new(messages)
        .with_system(system_prompt)
        .with_tools(tool_defs());

    let mut nudges = 0u32;

    for _step in 0..max_steps {
        if handles.cancel.load(Ordering::SeqCst) {
            return Ok(());
        }

        let response = client
            .exec_chat(
                request.provider.model.as_str(),
                chat_req.clone(),
                Some(&chat_options),
            )
            .await
            .map_err(|error| format!("模型请求失败：{error}"))?;

        let text = response.first_text().map(|value| value.to_string());
        let tool_calls = response.into_tool_calls();

        // No tool calls: normally this is the final answer. But models sometimes
        // *announce* an action ("我来用 curl 测试…") without emitting the tool
        // call. In that case, nudge the model (bounded) to actually invoke the
        // tool instead of finalizing on an empty promise.
        if tool_calls.is_empty() {
            let text_ref = text.as_deref().unwrap_or("");
            if nudges < MAX_NUDGES && looks_like_unfulfilled_action(text_ref) {
                if !text_ref.trim().is_empty() {
                    emit(
                        app,
                        AiEvent::Assistant {
                            run_id: run_id.clone(),
                            text: text_ref.to_string(),
                        },
                    );
                }
                chat_req = chat_req.append_message(ChatMessage::assistant(text_ref.to_string()));
                chat_req = chat_req.append_message(ChatMessage::user(NUDGE_PROMPT.to_string()));
                nudges += 1;
                continue;
            }

            // Genuine final answer; emit once as Final (emitting as both
            // Assistant and Final would duplicate the reply in the UI).
            emit(app, AiEvent::Final { run_id, text });
            return Ok(());
        }

        // There are tool calls: surface any intermediate reasoning text (the
        // model's plan) before running the tools.
        if let Some(text) = &text
            && !text.trim().is_empty()
        {
            emit(
                app,
                AiEvent::Assistant {
                    run_id: run_id.clone(),
                    text: text.clone(),
                },
            );
        }

        // Record the assistant's tool-call turn before feeding observations back.
        chat_req = chat_req.append_message(ChatMessage::from(tool_calls.clone()));

        for tool_call in tool_calls {
            let needs_approval = tool_needs_approval(&tool_call.fn_name);
            let display_args = if tool_call.fn_name == "open_ssh_session" {
                open_ssh_session_confirmation_args(state, &tool_call.fn_arguments)
            } else {
                tool_call.fn_arguments.clone()
            };
            emit(
                app,
                AiEvent::ToolCall {
                    run_id: run_id.clone(),
                    call_id: tool_call.call_id.clone(),
                    tool_name: tool_call.fn_name.clone(),
                    args: display_args,
                    needs_approval,
                },
            );

            if needs_approval {
                match wait_for_approval(handles, &tool_call.call_id).await {
                    Approval::Cancelled => return Ok(()),
                    Approval::Rejected => {
                        let message = "用户拒绝执行该操作。".to_string();
                        emit(
                            app,
                            AiEvent::ToolResult {
                                run_id: run_id.clone(),
                                call_id: tool_call.call_id.clone(),
                                tool_name: tool_call.fn_name.clone(),
                                result: message.clone(),
                                is_error: true,
                            },
                        );
                        chat_req = chat_req
                            .append_message(ToolResponse::new(tool_call.call_id.clone(), message));
                        continue;
                    }
                    Approval::Approved => {}
                }
            }

            let (result, is_error) = if tool_call.fn_name == "open_ssh_session" {
                match prepare_open_ssh_session(state, &tool_call.fn_arguments) {
                    Ok(connection) => {
                        emit(
                            app,
                            AiEvent::OpenSshSession {
                                run_id: run_id.clone(),
                                call_id: tool_call.call_id.clone(),
                                profile_id: connection.profile_id,
                            },
                        );
                        ("SSH 连接请求已获允许，正在打开终端。".to_string(), false)
                    }
                    Err(message) => (message, true),
                }
            } else if tool_call.fn_name == "control_app" {
                match prepare_app_action(state, &tool_call.fn_arguments) {
                    Ok(request) => {
                        emit(
                            app,
                            AiEvent::AppAction {
                                run_id: run_id.clone(),
                                call_id: tool_call.call_id.clone(),
                                action: request.action,
                                args: request.args,
                            },
                        );
                        ("已请求应用执行该快捷操作。".to_string(), false)
                    }
                    Err(message) => (message, true),
                }
            } else if tool_call.fn_name == "ask_user_question" {
                match parse_user_question(&tool_call.fn_arguments) {
                    Ok(question) => match wait_for_question(handles, &tool_call.call_id).await {
                        Some(answer) => question.format_answer(&answer.option_ids),
                        None => return Ok(()),
                    },
                    Err(message) => (message, true),
                }
            } else {
                execute_tool(
                    state,
                    &tool_call.fn_name,
                    &tool_call.fn_arguments,
                    request.current_server.as_ref(),
                )
                .await
            };
            emit(
                app,
                AiEvent::ToolResult {
                    run_id: run_id.clone(),
                    call_id: tool_call.call_id.clone(),
                    tool_name: tool_call.fn_name.clone(),
                    result: result.clone(),
                    is_error,
                },
            );
            chat_req =
                chat_req.append_message(ToolResponse::new(tool_call.call_id.clone(), result));
        }
    }

    emit(
        app,
        AiEvent::Final {
            run_id,
            text: Some("已达到本轮最大步数限制，已停止。如需继续，请再次向我提问。".to_string()),
        },
    );
    Ok(())
}

async fn wait_for_approval(handles: &mut RunHandles, call_id: &str) -> Approval {
    loop {
        if handles.cancel.load(Ordering::SeqCst) {
            return Approval::Cancelled;
        }

        tokio::select! {
            _ = handles.cancel_notify.notified() => {
                return Approval::Cancelled;
            }
            decision = handles.approval_rx.recv() => {
                match decision {
                    Some(decision) if decision.call_id == call_id => {
                        return if decision.approved {
                            Approval::Approved
                        } else {
                            Approval::Rejected
                        };
                    }
                    Some(_) => continue,
                    None => return Approval::Cancelled,
                }
            }
        }
    }
}

async fn wait_for_question(handles: &mut RunHandles, call_id: &str) -> Option<QuestionAnswer> {
    loop {
        if handles.cancel.load(Ordering::SeqCst) {
            return None;
        }
        tokio::select! {
            _ = handles.cancel_notify.notified() => return None,
            answer = handles.question_rx.recv() => {
                match answer {
                    Some(answer) if answer.call_id == call_id => return Some(answer),
                    Some(_) => continue,
                    None => return None,
                }
            }
        }
    }
}

struct UserQuestion {
    option_labels: Vec<(String, String)>,
    allow_multiple: bool,
}

impl UserQuestion {
    fn format_answer(&self, option_ids: &[String]) -> (String, bool) {
        if option_ids.is_empty() {
            return ("用户未选择任何选项。".to_string(), true);
        }
        if !self.allow_multiple && option_ids.len() != 1 {
            return ("该问题只允许选择一个选项。".to_string(), true);
        }
        let labels = option_ids
            .iter()
            .map(|id| {
                self.option_labels
                    .iter()
                    .find(|(option_id, _)| option_id == id)
                    .map(|(_, label)| label.clone())
                    .ok_or_else(|| format!("无效的选项 id：{id}"))
            })
            .collect::<Result<Vec<_>, _>>();
        match labels {
            Ok(labels) => (format!("用户选择了：{}。", labels.join("、")), false),
            Err(message) => (message, true),
        }
    }
}

fn parse_user_question(args: &Value) -> Result<UserQuestion, String> {
    let question = args
        .get("question")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "缺少有效的 question。".to_string())?;
    if question.chars().count() > 300 {
        return Err("问题过长。".to_string());
    }
    let options = args
        .get("options")
        .and_then(Value::as_array)
        .filter(|items| (2..=6).contains(&items.len()))
        .ok_or_else(|| "options 必须包含 2 到 6 个选项。".to_string())?;
    let mut option_labels = Vec::with_capacity(options.len());
    for option in options {
        let id = option
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "每个选项都需要 id。".to_string())?;
        let label = option
            .get("label")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "每个选项都需要 label。".to_string())?;
        if option_labels.iter().any(|(existing, _)| existing == id) {
            return Err("选项 id 不能重复。".to_string());
        }
        option_labels.push((id.to_string(), label.to_string()));
    }
    Ok(UserQuestion {
        option_labels,
        allow_multiple: args
            .get("allow_multiple")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    })
}

fn emit(app: &AppHandle, event: AiEvent) {
    let _ = app.emit(AI_EVENT, event);
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::parse_user_question;

    #[test]
    fn interactive_question_accepts_valid_single_choice() {
        let question = parse_user_question(&json!({
            "question": "请选择服务器",
            "options": [
                { "id": "prod", "label": "生产环境" },
                { "id": "test", "label": "测试环境" }
            ]
        }))
        .unwrap();
        assert_eq!(
            question.format_answer(&["test".to_string()]),
            ("用户选择了：测试环境。".to_string(), false)
        );
    }

    #[test]
    fn interactive_question_rejects_unknown_or_multiple_single_choice_answers() {
        let question = parse_user_question(&json!({
            "question": "请选择服务器",
            "options": [
                { "id": "prod", "label": "生产环境" },
                { "id": "test", "label": "测试环境" }
            ]
        }))
        .unwrap();
        assert!(question.format_answer(&["missing".to_string()]).1);
        assert!(
            question
                .format_answer(&["prod".to_string(), "test".to_string()])
                .1
        );
    }
}
