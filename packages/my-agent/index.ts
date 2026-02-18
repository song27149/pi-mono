import { OpenAI } from "openai";
import * as dotenv from "dotenv";
import path from "path";
import { createInterface } from "readline";
import { evaluate } from "mathjs";

dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });

const openai = new OpenAI({
    baseURL: process.env.OPENAI_BASE_URL,
    apiKey: process.env.OPENAI_API_KEY,
});

const MODEL = "deepseek-chat";

type ChatMessage = OpenAI.Chat.ChatCompletionMessageParam;
type ChatTool = OpenAI.Chat.ChatCompletionTool;

const chatHistory: ChatMessage[] = [
    { role: "system", content: "你是一个旅游策划助手。" },
];

/**
 * 使用 mathjs 计算数学表达式。  
 * @param expression - 数学表达式字符串，如 "1 + 2 * (3 / 4)"
 * @returns 计算结果字符串，失败时返回错误信息
 */
async function calculateExpression(expression: string): Promise<string> {
    console.log(`[System] 执行计算表达式: ${expression}`);
    try {
        const result = evaluate(expression);
        return String(result);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[System Error] 计算失败: ${message}`);
        return `计算失败: ${message}`;
    }
}

const tools: ChatTool[] = [
    {
        type: "function",
        function: {
            name: "calculate_expression",
            description: "评估并计算一个数学表达式。支持加减乘除、括号、幂运算等。遇到需要算数的用户问题时必须调用此工具。",
            parameters: {
                type: "object",
                properties: {
                    expression: {
                        type: "string",
                        description: "需要计算的数学表达式，例如 '1 + 2 * (3 / 4)'",
                    },
                },
                required: ["expression"],
            },
        },
    },
];

/**
 * 处理单轮 Agent 调用：可能触发多轮工具调用，直到得到最终文本回复。
 * @param userInput - 用户输入文本
 */
async function runAgent(userInput: string): Promise<void> {
    console.log(`\n[User]: ${userInput}`);
    chatHistory.push({ role: "user", content: userInput });

    try {
        for (;;) {
            const response = await openai.chat.completions.create({
                model: MODEL,
                messages: chatHistory,
                tools,
                tool_choice: "auto",
            });

            const responseMessage = response.choices[0].message;

            if (!responseMessage.tool_calls || responseMessage.tool_calls.length === 0) {
                const content = responseMessage.content ?? "";
                console.log(`[Agent]: ${content}`);
                chatHistory.push({
                    role: "assistant",
                    content: responseMessage.content ?? null,
                });
                return;
            }

            chatHistory.push({
                role: "assistant",
                content: responseMessage.content ?? null,
                tool_calls: responseMessage.tool_calls,
            });

            for (const toolCall of responseMessage.tool_calls) {
                if (toolCall.function.name !== "calculate_expression") continue;
                let args: { expression?: string };
                try {
                    args = JSON.parse(toolCall.function.arguments) as { expression?: string };
                } catch {
                    args = {};
                }
                const expressionToCalculate = typeof args.expression === "string" ? args.expression : "";
                const calculationResult = await calculateExpression(expressionToCalculate);
                chatHistory.push({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    content: calculationResult,
                });
            }
        }
    } catch (error) {
        console.error("出错了:", error);
    }
}

/**
 * 启动命令行多轮对话：循环读取用户输入并调用 runAgent，输入 exit/quit 退出。
 */
function startRepl(): void {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const prompt = (): void => {
        rl.question("\n请输入 (exit/quit 退出): ", (line) => {
            const input = line.trim();
            if (input === "exit" || input === "quit") {
                rl.close();
                return;
            }
            if (input.length > 0) {
                runAgent(input).finally(() => prompt());
            } else {
                prompt();
            }
        });
    };
    console.log("数学助手已启动，支持多轮对话与数学计算（使用 calculate_expression 工具）。");
    prompt();
}

startRepl();
