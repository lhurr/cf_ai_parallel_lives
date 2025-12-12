// UserMemory Durable Object

import { DurableObject } from "cloudflare:workers";

export interface Message {
    role: "user" | "assistant";
    content: string;
    timestamp: number;
}

export interface Decision {
    description: string;
    exploredAt: number;
    alternatePath?: string;
}

export interface UserState {
    lifeSummary: string;
    decisions: Decision[];
    conversationHistory: Message[];
    lastActive: number;
}

export class UserMemory extends DurableObject<Env> {
    private state: UserState = {
        lifeSummary: "",
        decisions: [],
        conversationHistory: [],
        lastActive: Date.now(),
    };

    private initialized = false;

    async initialize(): Promise<void> {
        if (this.initialized) return;

        const stored = await this.ctx.storage.get<UserState>("state");
        if (stored) {
            this.state = stored;
        }
        this.initialized = true;
    }

    async saveState(): Promise<void> {
        await this.ctx.storage.put("state", this.state);
    }

    async getState(): Promise<UserState> {
        await this.initialize();
        return this.state;
    }

    async addMessage(message: Message): Promise<void> {
        await this.initialize();

        this.state.conversationHistory.push(message);
        this.state.lastActive = Date.now();

        // Keep last 20 messages for context
        if (this.state.conversationHistory.length > 20) {
            this.state.conversationHistory = this.state.conversationHistory.slice(-20);
        }

        await this.saveState();
    }

    async addDecision(decision: Decision): Promise<void> {
        await this.initialize();

        this.state.decisions.push(decision);

        // Keep last 50 decisions
        if (this.state.decisions.length > 50) {
            this.state.decisions = this.state.decisions.slice(-50);
        }

        await this.saveState();
    }

    async updateLifeSummary(summary: string): Promise<void> {
        await this.initialize();
        this.state.lifeSummary = summary;
        await this.saveState();
    }

    async getConversationContext(): Promise<string> {
        await this.initialize();

        return this.state.conversationHistory
            .slice(-10)
            .map((m) => `${m.role === "user" ? "User" : "Guide"}: ${m.content}`)
            .join("\n\n");
    }

    async getRecentDecisions(): Promise<string[]> {
        await this.initialize();

        return this.state.decisions
            .slice(-5)
            .map((d) => d.description);
    }

    async getLifeSummary(): Promise<string> {
        await this.initialize();
        return this.state.lifeSummary;
    }
}
