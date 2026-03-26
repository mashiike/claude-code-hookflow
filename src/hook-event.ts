export interface ToolInput {
  file_path?: string;
}

export interface HookEvent {
  session_id: string;
  transcript_path: string;
  cwd: string;
  hook_event_name: string;
  tool_name?: string;
  tool_input?: ToolInput;
  stop_hook_active?: boolean;
  agent_id?: string;
  agent_type?: string;
  agent_transcript_path?: string;
  _raw: Record<string, unknown>;
}

export function parseHookEvent(data: Buffer | string): HookEvent {
  const raw = JSON.parse(typeof data === 'string' ? data : data.toString('utf-8')) as Record<
    string,
    unknown
  >;

  const sessionId = raw.session_id;
  if (typeof sessionId !== 'string' || sessionId === '') {
    throw new Error('missing required field: session_id');
  }

  const transcriptPath = raw.transcript_path;
  if (typeof transcriptPath !== 'string' || transcriptPath === '') {
    throw new Error('missing required field: transcript_path');
  }

  const cwd = raw.cwd;
  if (typeof cwd !== 'string' || cwd === '') {
    throw new Error('missing required field: cwd');
  }

  const hookEventName = raw.hook_event_name;
  if (typeof hookEventName !== 'string' || hookEventName === '') {
    throw new Error('missing required field: hook_event_name');
  }

  const toolInput = raw.tool_input as ToolInput | undefined;

  return {
    session_id: sessionId,
    transcript_path: transcriptPath,
    cwd,
    hook_event_name: hookEventName,
    tool_name: typeof raw.tool_name === 'string' ? raw.tool_name : undefined,
    tool_input: toolInput,
    stop_hook_active: typeof raw.stop_hook_active === 'boolean' ? raw.stop_hook_active : undefined,
    agent_id: typeof raw.agent_id === 'string' ? raw.agent_id : undefined,
    agent_type: typeof raw.agent_type === 'string' ? raw.agent_type : undefined,
    agent_transcript_path: typeof raw.agent_transcript_path === 'string' ? raw.agent_transcript_path : undefined,
    _raw: raw,
  };
}
