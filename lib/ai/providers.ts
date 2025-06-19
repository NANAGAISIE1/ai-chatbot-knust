import { openai } from '@ai-sdk/openai';
import {
  customProvider,
  extractReasoningMiddleware,
  wrapLanguageModel,
} from 'ai';
import { isTestEnvironment } from '../constants';
import {
  artifactModel,
  chatModel,
  reasoningModel,
  titleModel,
} from './models.test';

export const myProvider = isTestEnvironment
  ? customProvider({
      languageModels: {
        'chat-model': chatModel,
        'chat-model-reasoning': reasoningModel,
        'title-model': titleModel,
        'artifact-model': artifactModel,
      },
    })
  : customProvider({
      languageModels: {
        'chat-model': openai('gpt-4.1-nano'), // Changed model
        'chat-model-reasoning': wrapLanguageModel({
          model: openai('gpt-4.1-nano'), // Changed model
          middleware: extractReasoningMiddleware({ tagName: 'think' }),
        }),
        'title-model': openai('gpt-4.1-nano'), // Changed model
        'artifact-model': openai('gpt-4.1-nano'), // Changed model
      },
      imageModels: {
        'small-model': openai.image('dall-e-3'), // Changed model
      },
    });
