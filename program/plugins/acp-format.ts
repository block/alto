import path from 'node:path'
import type * as acp from '@agentclientprotocol/sdk'
import type { AgentPromptPart, AgentConfigOption } from '../../src/server/services/agent-registry.js'

export function promptBlock(part: AgentPromptPart): acp.ContentBlock {
  if (part.type === 'text') return { type: 'text', text: part.text }
  if (part.type === 'image') {
    return {
      type: 'image',
      data: part.data,
      mimeType: part.mimeType,
      ...(part.uri ? { uri: part.uri } : {}),
    }
  }
  return {
    type: 'resource_link',
    name: part.name,
    uri: part.uri,
    ...(part.mimeType ? { mimeType: part.mimeType } : {}),
  }
}

export function updateContent(update: acp.SessionUpdate): AgentPromptPart | undefined {
  if (
    update.sessionUpdate !== 'agent_message_chunk'
    && update.sessionUpdate !== 'agent_thought_chunk'
    && update.sessionUpdate !== 'user_message_chunk'
  ) return undefined

  const content = update.content
  if (content.type === 'text') return { type: 'text', text: content.text }
  if (content.type === 'image') {
    return {
      type: 'image',
      data: content.data,
      mimeType: content.mimeType,
      ...(content.uri ? { uri: content.uri } : {}),
    }
  }
  if (content.type === 'resource_link') {
    return {
      type: 'resource',
      uri: content.uri,
      name: content.name,
      ...(content.mimeType ? { mimeType: content.mimeType } : {}),
    }
  }
  if (content.type === 'resource') {
    const resource = content.resource
    return {
      type: 'resource',
      uri: resource.uri,
      name: path.basename(resource.uri) || resource.uri,
      ...(resource.mimeType ? { mimeType: resource.mimeType } : {}),
    }
  }
  return undefined
}

// Older ACP agents, including Gemini CLI, use models and session/set_model.
// The current SDK no longer declares that response field, but preserves it on
// the wire. Keep the compatibility shape here rather than extending the SDK.
export interface AcpConfigResponse {
  configOptions?: acp.SessionConfigOption[] | null
  modes?: acp.SessionModeState | null
  models?: {
    currentModelId: string
    availableModels: Array<{ modelId: string; name: string; description?: string | null }>
  } | null
}

export function configOptions(response: AcpConfigResponse): AgentConfigOption[] {
  if (response.configOptions != null) return response.configOptions.flatMap((option) => option.type !== 'select' ? [] : [{
    id: option.id, name: option.name, ...(option.category ? { category: option.category } : {}),
    currentValue: option.currentValue,
    options: option.options.flatMap((value) => 'group' in value ? value.options : [value])
      .map((value) => ({ value: value.value, name: value.name, ...(value.description ? { description: value.description } : {}) })),
  }])
  const options: AgentConfigOption[] = []
  if (response.models) options.push({ id: '__model', name: 'Model', category: 'model', currentValue: response.models.currentModelId,
    options: response.models.availableModels.map((model) => ({ value: model.modelId, name: model.name,
      ...(model.description ? { description: model.description } : {}) })) })
  if (response.modes) options.push({ id: '__mode', name: 'Mode', category: 'mode', currentValue: response.modes.currentModeId,
    options: response.modes.availableModes.map((mode) => ({ value: mode.id, name: mode.name })) })
  return options
}

export function toolFiles(content: acp.ToolCallContent[] | null | undefined) {
  return content?.flatMap((part) => part.type === 'diff'
    ? [{ path: part.path, oldText: part.oldText ?? null, newText: part.newText }] : [])
}

export function toolContent(content: acp.ToolCallContent[] | null | undefined): string | undefined {
  if (!content) return undefined
  return content.flatMap((part) => {
    if (part.type === 'content' && part.content.type === 'text') return [part.content.text]
    return []
  }).join('\n').slice(0, 40_000)
}

export interface AcpToolCall {
  title: string
  kind?: acp.ToolKind
  output: string
}

const toolSummaries: Partial<Record<acp.ToolKind, string>> = {
  read: 'Read files',
  edit: 'Edited a file',
  delete: 'Deleted a file',
  move: 'Moved a file',
  search: 'Searched files',
  execute: 'Ran a command',
  fetch: 'Fetched from the web',
}

export function mergeToolCall(previous: AcpToolCall | undefined, update: acp.ToolCall | acp.ToolCallUpdate): AcpToolCall {
  const kind = update.kind ?? previous?.kind
  return {
    title: update.title ?? previous?.title ?? 'Tool call',
    ...(kind ? { kind } : {}),
    output: update.content ? toolContent(update.content) ?? '' : previous?.output ?? '',
  }
}

// ACP agents put the full command or path in the title. Like App Server items,
// the transcript row shows a summary and keeps the title with the output.
export function toolCallFields(call: AcpToolCall, update: acp.ToolCall | acp.ToolCallUpdate) {
  const summary = (call.kind && toolSummaries[call.kind]) ?? call.title
  return {
    toolCallId: update.toolCallId,
    title: summary,
    content: summary === call.title ? call.output : [call.title, call.output].filter(Boolean).join('\n\n'),
    ...(update.content ? { files: toolFiles(update.content) ?? [] } : {}),
    ...(update.status ? { status: update.status } : {}),
    ...(call.kind ? { kind: call.kind } : {}),
  }
}

