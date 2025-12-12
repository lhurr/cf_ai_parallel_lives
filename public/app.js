// Parallel Lives - Frontend Application

class ParallelLivesApp {
    constructor() {
        this.socket = null;
        this.userId = this.getOrCreateUserId();
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;

        this.elements = {
            connectionStatus: document.getElementById('connectionStatus'),
            messages: document.getElementById('messages'),
            typingIndicator: document.getElementById('typingIndicator'),
            messageForm: document.getElementById('messageForm'),
            messageInput: document.getElementById('messageInput'),
            sendButton: document.getElementById('sendButton'),
        };

        this.init();
    }

    init() {
        this.setupEventListeners();
        this.connect();
        this.setupTextareaAutoResize();
    }

    getOrCreateUserId() {
        let userId = localStorage.getItem('parallelLivesUserId');
        if (!userId) {
            userId = `user_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
            localStorage.setItem('parallelLivesUserId', userId);
        }
        return userId;
    }

    connect() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws?userId=${this.userId}`;

        this.updateConnectionStatus('connecting');

        try {
            this.socket = new WebSocket(wsUrl);

            this.socket.onopen = () => {
                console.log('WebSocket connected');
                this.reconnectAttempts = 0;
                this.updateConnectionStatus('connected');
                this.elements.sendButton.disabled = false;
            };

            this.socket.onmessage = (event) => {
                this.handleMessage(JSON.parse(event.data));
            };

            this.socket.onclose = () => {
                console.log('WebSocket closed');
                this.updateConnectionStatus('disconnected');
                this.elements.sendButton.disabled = true;
                this.attemptReconnect();
            };

            this.socket.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.updateConnectionStatus('disconnected');
            };
        } catch (error) {
            console.error('Failed to create WebSocket:', error);
            this.updateConnectionStatus('disconnected');
        }
    }

    attemptReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

            console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

            setTimeout(() => {
                this.connect();
            }, delay);
        }
    }

    updateConnectionStatus(status) {
        const statusText = this.elements.connectionStatus.querySelector('.status-text');
        this.elements.connectionStatus.className = `connection-status ${status}`;

        switch (status) {
            case 'connected':
                statusText.textContent = 'Connected';
                break;
            case 'connecting':
                statusText.textContent = 'Connecting...';
                break;
            case 'disconnected':
                statusText.textContent = 'Disconnected';
                break;
        }
    }

    setupEventListeners() {
        // Form submission
        this.elements.messageForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.sendMessage();
        });

        // Enter to send, Shift+Enter for new line
        this.elements.messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // Enable/disable send button based on input
        this.elements.messageInput.addEventListener('input', () => {
            const hasContent = this.elements.messageInput.value.trim().length > 0;
            this.elements.sendButton.disabled = !hasContent || !this.socket || this.socket.readyState !== WebSocket.OPEN;
        });

        // Example prompt buttons
        document.querySelectorAll('.example-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const prompt = btn.dataset.prompt;
                this.elements.messageInput.value = prompt;
                this.elements.messageInput.dispatchEvent(new Event('input'));
                this.elements.messageInput.focus();
            });
        });
    }

    setupTextareaAutoResize() {
        const textarea = this.elements.messageInput;

        textarea.addEventListener('input', () => {
            textarea.style.height = 'auto';
            textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
        });
    }

    sendMessage() {
        const content = this.elements.messageInput.value.trim();

        if (!content || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
            return;
        }

        // Hide welcome message if visible
        const welcomeMessage = this.elements.messages.querySelector('.welcome-message');
        if (welcomeMessage) {
            welcomeMessage.remove();
        }

        // Add user message to UI
        this.addMessage('user', content);

        // Send to server
        this.socket.send(JSON.stringify({
            type: 'message',
            content: content,
            timestamp: new Date().toISOString()
        }));

        // Clear input
        this.elements.messageInput.value = '';
        this.elements.messageInput.style.height = 'auto';
        this.elements.sendButton.disabled = true;
    }

    handleMessage(data) {
        switch (data.type) {
            case 'connected':
                // Show welcome message from server
                if (data.content && !this.elements.messages.querySelector('.message')) {
                    this.addSystemMessage(data.content);
                }
                break;

            case 'history':
                // Load conversation history
                if (data.history && data.history.length > 0) {
                    // Remove welcome message
                    const welcomeMessage = this.elements.messages.querySelector('.welcome-message');
                    if (welcomeMessage) {
                        welcomeMessage.remove();
                    }

                    data.history.forEach(msg => {
                        this.addMessage(msg.role, msg.content, false);
                    });
                    this.scrollToBottom();
                }
                break;

            case 'typing':
                this.showTypingIndicator();
                break;

            case 'message':
                this.hideTypingIndicator();
                this.addMessage('assistant', data.content);
                break;

            case 'error':
                this.hideTypingIndicator();
                this.addErrorMessage(data.content);
                break;
        }
    }

    addMessage(role, content, animate = true) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${role}`;
        if (!animate) {
            messageDiv.style.animation = 'none';
        }

        const avatar = role === 'assistant' ? '✨' : '👤';

        messageDiv.innerHTML = `
      <div class="message-avatar">${avatar}</div>
      <div class="message-content">${this.formatContent(content)}</div>
    `;

        this.elements.messages.appendChild(messageDiv);
        this.scrollToBottom();
    }

    addSystemMessage(content) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message assistant';

        messageDiv.innerHTML = `
      <div class="message-avatar">✨</div>
      <div class="message-content">${this.formatContent(content)}</div>
    `;

        // Remove welcome message first
        const welcomeMessage = this.elements.messages.querySelector('.welcome-message');
        if (welcomeMessage) {
            welcomeMessage.remove();
        }

        this.elements.messages.appendChild(messageDiv);
        this.scrollToBottom();
    }

    addErrorMessage(content) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message assistant';

        messageDiv.innerHTML = `
      <div class="message-avatar">⚠️</div>
      <div class="message-content" style="border-color: rgba(248, 113, 113, 0.3);">
        ${this.formatContent(content)}
      </div>
    `;

        this.elements.messages.appendChild(messageDiv);
        this.scrollToBottom();
    }

    formatContent(content) {
        // Basic markdown-like formatting
        let formatted = content
            // Escape HTML
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            // Bold
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            // Italic
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            // Line breaks
            .replace(/\n\n/g, '</p><p>')
            .replace(/\n/g, '<br>');

        return `<p>${formatted}</p>`;
    }

    showTypingIndicator() {
        this.elements.typingIndicator.classList.add('active');
        this.scrollToBottom();
    }

    hideTypingIndicator() {
        this.elements.typingIndicator.classList.remove('active');
    }

    scrollToBottom() {
        const container = document.querySelector('.chat-container');
        container.scrollTo({
            top: container.scrollHeight,
            behavior: 'smooth'
        });
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new ParallelLivesApp();
});
