import { AssistantResponse } from 'ai';
import OpenAI from 'openai';
import { auth } from '@/app/(auth)/auth';
import { ChatSDKError } from '@/lib/errors';
import { generateUUID } from '@/lib/utils';

// Mock implementations for DB functions - replace with your actual DB logic
// Ensure these functions are defined or imported correctly in your actual project
const getChatById = async ({ id }: { id: string }): Promise<any | null> => {
  console.log(`DB: getChatById(${id})`);
  return null;
};
const saveChat = async (chat: any): Promise<void> => {
  console.log('DB: saveChat', chat);
};
const saveMessages = async ({
  messages,
}: { messages: any[] }): Promise<void> => {
  console.log('DB: saveMessages', messages);
};
const generateTitleFromUserMessage = async ({
  message,
}: { message: { role: string; content: string } }): Promise<string> => {
  console.log('AI: generateTitleFromUserMessage', message.content);
  return `${message.content.substring(0, 30)}...`;
};

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const requestBody = await req.json();
    const {
      threadId: clientThreadId,
      message: userMessageContent,
      chatId: clientChatId,
      selectedVisibilityType,
    } = requestBody;

    if (!userMessageContent) {
      return new ChatSDKError(
        'bad_request:api',
        'Message content is required.',
      ).toResponse();
    }

    const session = await auth();
    if (!session?.user) {
      return new ChatSDKError('unauthorized:chat').toResponse();
    }

    let threadId = clientThreadId || clientChatId;
    const currentChatId = clientChatId || threadId;

    if (!currentChatId) {
      return new ChatSDKError(
        'bad_request:api',
        'Missing chatId for the conversation.',
      ).toResponse();
    }

    const chatExists = await getChatById({ id: currentChatId });
    if (!chatExists) {
      const title = await generateTitleFromUserMessage({
        message: { role: 'user', content: userMessageContent },
      });
      await saveChat({
        id: currentChatId,
        userId: session.user.id,
        title,
        visibility: selectedVisibilityType || 'private',
      });
    }

    if (!threadId) {
      const newOpenAIThread = await openai.beta.threads.create({});
      threadId = newOpenAIThread.id;
    }

    const userMessageForDb = {
      chatId: currentChatId,
      id: generateUUID(),
      role: 'user',
      content: userMessageContent,
      createdAt: new Date(),
    };
    await saveMessages({ messages: [userMessageForDb] });

    const createdMessage = await openai.beta.threads.messages.create(threadId, {
      role: 'user',
      content: userMessageContent,
    });

    return AssistantResponse(
      { threadId: threadId, messageId: createdMessage.id },
      async ({ forwardStream, sendDataMessage }) => {
        const runStream = openai.beta.threads.runs.stream(threadId, {
          assistant_id:
            process.env.ASSISTANT_ID ??
            (() => {
              throw new Error(
                'ASSISTANT_ID is not set in environment variables.',
              );
            })(),
        });

        let runResult = await forwardStream(runStream);

        while (
          runResult?.status === 'requires_action' &&
          runResult.required_action?.type === 'submit_tool_outputs'
        ) {
          const tool_outputs = await Promise.all(
            runResult.required_action.submit_tool_outputs.tool_calls.map(
              async (toolCall: any) => {
                const functionName = toolCall.function.name;
                const args = JSON.parse(toolCall.function.arguments);
                const output = {
                  error: `Tool ${functionName} not implemented yet.`,
                };

                console.log(
                  `Assistant requesting tool: ${functionName} with args:`,
                  args,
                );

                return {
                  tool_call_id: toolCall.id,
                  output: JSON.stringify(output),
                };
              },
            ),
          );

          runResult = await forwardStream(
            openai.beta.threads.runs.submitToolOutputsStream(
              threadId,
              runResult.id,
              // {tool_outputs}
            ),
          );
        }

        if (runResult?.status === 'completed') {
          const assistantMessagesFromThread =
            await openai.beta.threads.messages.list(threadId, {
              order: 'asc',
              after: createdMessage.id,
            });

          const messagesToSaveToDb: any[] = [];
          for (const msg of assistantMessagesFromThread.data) {
            if (msg.role === 'assistant') {
              for (const contentItem of msg.content) {
                if (contentItem.type === 'text') {
                  messagesToSaveToDb.push({
                    chatId: currentChatId,
                    id: generateUUID(),
                    role: 'assistant',
                    content: contentItem.text.value,
                    createdAt: new Date(msg.created_at * 1000),
                  });
                }
              }
            }
          }

          if (messagesToSaveToDb.length > 0) {
            await saveMessages({ messages: messagesToSaveToDb });
          }
        }
      },
    );
  } catch (error: any) {
    console.error('[API Assistant Route Error]', error);
    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }
    const errorMessage = error.message || 'An unknown error occurred.';
    try {
      return new Response(JSON.stringify({ error: errorMessage }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (e) {
      return new Response(errorMessage, { status: 500 });
    }
  }
}
