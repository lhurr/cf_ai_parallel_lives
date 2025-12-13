// Parallel Lives - Main Worker Entry Point

import { UserMemory } from "./user-memory";
import { SYSTEM_PROMPT, buildContextPrompt, SUMMARY_PROMPT } from "./prompts";

export { UserMemory };

export interface Env {
    AI: Ai;
    USER_MEMORY: DurableObjectNamespace<UserMemory>;
}

interface WebSocketMessage {
    type: "message" | "typing" | "connected" | "error" | "history";
    content?: string;
    timestamp?: string;
    history?: Array<{ role: string; content: string }>;
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);

        // Handle WebSocket upgrade on /ws path
        if (url.pathname === "/ws" && request.headers.get("Upgrade") === "websocket") {
            return handleWebSocket(request, env);
        }

        // API endpoint for health check
        if (url.pathname === "/api/health") {
            return new Response(JSON.stringify({ status: "ok", service: "parallel-lives" }), {
                headers: { "Content-Type": "application/json" },
            });
        }

        // Let assets handle static files, or return 404
        return new Response("Not found", { status: 404 });
    },
};

async function handleWebSocket(request: Request, env: Env): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Generate or extract user ID (in production, use auth)
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId") || generateUserId();

    // Get the user's Durable Object
    const id = env.USER_MEMORY.idFromName(userId);
    const userMemory = env.USER_MEMORY.get(id);

    server.accept();

    // Send connection confirmation with history
    const state = await userMemory.getState();
    const historyMessage: WebSocketMessage = {
        type: "history",
        history: state.conversationHistory.map((m) => ({
            role: m.role,
            content: m.content,
        })),
    };
    server.send(JSON.stringify(historyMessage));

    const connectedMessage: WebSocketMessage = {
        type: "connected",
        content: state.lifeSummary
            ? "Welcome back to Parallel Lives. I remember your story..."
            : "Welcome to Parallel Lives. Share a life decision, and I'll help you explore the path not taken.",
        timestamp: new Date().toISOString(),
    };
    server.send(JSON.stringify(connectedMessage));

    // Handle incoming messages
    server.addEventListener("message", async (event) => {
        try {
            const data = JSON.parse(event.data as string) as WebSocketMessage;

            if (data.type === "message" && data.content) {
                // Send typing indicator
                server.send(JSON.stringify({ type: "typing" }));

                // Store user message
                await userMemory.addMessage({
                    role: "user",
                    content: data.content,
                    timestamp: Date.now(),
                });

                // Build context from memory
                const lifeSummary = await userMemory.getLifeSummary();
                const recentDecisions = await userMemory.getRecentDecisions();
                const conversationContext = await userMemory.getConversationContext();
                const contextPrompt = buildContextPrompt(lifeSummary, recentDecisions, conversationContext);

                const response = await env.AI.run("@cf/mistral/mistral-small-3.1-24b-instruct", {
                    messages: [
                        { role: "system", content: SYSTEM_PROMPT + contextPrompt },
                        { role: "user", content: data.content },
                    ],
                    max_tokens: 1024,
                    temperature: 0.8,
                });

                const aiResponse = (response as { response?: string }).response || "I'm having trouble exploring that path right now. Could you try again?";

                // Store AI response
                await userMemory.addMessage({
                    role: "assistant",
                    content: aiResponse,
                    timestamp: Date.now(),
                });

                // Check if this seems like a life decision to record
                if (looksLikeDecision(data.content)) {
                    await userMemory.addDecision({
                        description: data.content.substring(0, 200),
                        exploredAt: Date.now(),
                    });
                }

                // Periodically update life summary (every 5 messages)
                const state = await userMemory.getState();
                if (state.conversationHistory.length % 5 === 0 && state.conversationHistory.length > 0) {
                    updateLifeSummary(env, userMemory, conversationContext);
                }

                // Send AI response
                const responseMessage: WebSocketMessage = {
                    type: "message",
                    content: aiResponse,
                    timestamp: new Date().toISOString(),
                };
                server.send(JSON.stringify(responseMessage));
            }
        } catch (error) {
            console.error("Error handling message:", error);
            server.send(
                JSON.stringify({
                    type: "error",
                    content: "Something went wrong while exploring that path. Please try again.",
                })
            );
        }
    });

    server.addEventListener("close", () => {
        console.log("WebSocket closed");
    });

    server.addEventListener("error", (error) => {
        console.error("WebSocket error:", error);
    });

    return new Response(null, {
        status: 101,
        webSocket: client,
    });
}

function generateUserId(): string {
    return `user_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

function looksLikeDecision(text: string): boolean {
    const decisionKeywords = [
        "chose", "decided", "picked", "selected", "went with",
        "instead of", "rather than", "could have", "should have",
        "what if", "turned down", "accepted", "rejected",
        "moved to", "stayed", "left", "quit", "started",
    ];
    const lowerText = text.toLowerCase();
    return decisionKeywords.some((keyword) => lowerText.includes(keyword));
}

async function updateLifeSummary(
    env: Env,
    userMemory: DurableObjectStub<UserMemory>,
    conversationContext: string
): Promise<void> {
    try {
        const currentSummary = await userMemory.getLifeSummary();
        const prompt = currentSummary
            ? `Current summary: ${currentSummary}\n\nBased on this new conversation, update the summary:\n${conversationContext}\n\n${SUMMARY_PROMPT}`
            : `${conversationContext}\n\n${SUMMARY_PROMPT}`;

        const response = await env.AI.run("@cf/mistral/mistral-small-3.1-24b-instruct", {
            messages: [
                { role: "system", content: "You are creating a brief summary of someone's life story based on their conversations. Be concise and focus on key life decisions and details." },
                { role: "user", content: prompt },
            ],
            max_tokens: 256,
            temperature: 0.3,
        });

        const summary = (response as { response?: string }).response;
        if (summary) {
            await userMemory.updateLifeSummary(summary);
        }
    } catch (error) {
        console.error("Error updating life summary:", error);
    }
}
