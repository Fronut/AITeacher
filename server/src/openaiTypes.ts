export type ChatCompletionRequestMessageRoleEnum = 'system' | 'user' | 'assistant';

export interface ChatCompletionRequestMessage {
  role: ChatCompletionRequestMessageRoleEnum;
  content: string;
}
