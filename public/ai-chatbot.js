(function() {
    // 1. Inject chatbot styles
    const styles = `
        #ai-chatbot-container {
            font-family: 'Inter', system-ui, -apple-system, sans-serif;
            z-index: 9999;
            position: fixed;
            bottom: 24px;
            right: 24px;
            display: flex;
            flex-direction: column;
            align-items: flex-end;
        }
        #ai-chatbot-window {
            width: 380px;
            height: 520px;
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border-radius: 18px;
            box-shadow: 0 12px 40px rgba(0, 0, 0, 0.15);
            border: 1px solid rgba(229, 231, 235, 0.8);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            margin-bottom: 16px;
            opacity: 0;
            transform: scale(0.9) translateY(20px);
            transform-origin: bottom right;
            transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
            pointer-events: none;
            position: absolute;
            bottom: 70px;
            right: 0;
        }
        #ai-chatbot-window.active {
            opacity: 1;
            transform: scale(1) translateY(0);
            pointer-events: auto;
        }
        #ai-chatbot-header {
            background: linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%);
            padding: 16px;
            color: #ffffff;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .ai-chatbot-bot-info {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .ai-chatbot-avatar {
            width: 36px;
            height: 36px;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.2);
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
            font-size: 18px;
        }
        .ai-chatbot-online-dot {
            width: 10px;
            height: 10px;
            background: #10b981;
            border: 2px solid #ffffff;
            border-radius: 50%;
            position: absolute;
            bottom: 0;
            right: 0;
        }
        .ai-chatbot-title {
            font-weight: 700;
            font-size: 14px;
            margin: 0;
            line-height: 1.2;
        }
        .ai-chatbot-subtitle {
            font-size: 10px;
            opacity: 0.85;
            margin: 2px 0 0 0;
        }
        #ai-chatbot-close-btn {
            background: none;
            border: none;
            color: #ffffff;
            opacity: 0.8;
            cursor: pointer;
            font-size: 18px;
            padding: 4px;
            transition: opacity 0.2s;
        }
        #ai-chatbot-close-btn:hover {
            opacity: 1;
        }
        #ai-chatbot-messages {
            flex: 1;
            padding: 16px;
            overflow-y: auto;
            background-color: #f8fafc;
            display: flex;
            flex-direction: column;
            gap: 12px;
            scrollbar-width: thin;
        }
        #ai-chatbot-messages::-webkit-scrollbar {
            width: 5px;
        }
        #ai-chatbot-messages::-webkit-scrollbar-thumb {
            background-color: #cbd5e1;
            border-radius: 4px;
        }
        .ai-chatbot-msg {
            max-width: 85%;
            padding: 10px 14px;
            font-size: 13px;
            line-height: 1.5;
            word-wrap: break-word;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
        }
        .ai-chatbot-msg.bot {
            align-self: flex-start;
            background-color: #ffffff;
            color: #1e293b;
            border-radius: 16px 16px 16px 2px;
            border: 1px solid #e2e8f0;
        }
        .ai-chatbot-msg.user {
            align-self: flex-end;
            background: linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%);
            color: #ffffff;
            border-radius: 16px 16px 2px 16px;
        }
        .ai-chatbot-msg p {
            margin: 0 0 8px 0;
        }
        .ai-chatbot-msg p:last-child {
            margin-bottom: 0;
        }
        .ai-chatbot-msg ul, .ai-chatbot-msg ol {
            margin: 4px 0;
            padding-left: 18px;
        }
        .ai-chatbot-msg li {
            margin-bottom: 4px;
            list-style-type: disc;
        }
        .ai-chatbot-msg strong {
            font-weight: 700;
        }
        .ai-chatbot-msg code {
            font-family: 'JetBrains Mono', monospace;
            background: rgba(0, 0, 0, 0.05);
            padding: 2px 4px;
            border-radius: 4px;
            font-size: 11px;
        }
        .ai-chatbot-msg.user code {
            background: rgba(255, 255, 255, 0.2);
            color: #ffffff;
        }
        .ai-chatbot-quick-suggestions {
            margin-top: 8px;
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
        }
        .ai-chatbot-suggestion-tag {
            font-size: 10px;
            background-color: #eff6ff;
            color: #2563eb;
            border: 1px solid #bfdbfe;
            padding: 4px 8px;
            border-radius: 9999px;
            cursor: pointer;
            transition: all 0.2s;
            font-weight: 500;
        }
        .ai-chatbot-suggestion-tag:hover {
            background-color: #dbeafe;
            transform: translateY(-1px);
        }
        #ai-chatbot-form {
            padding: 12px;
            background: #ffffff;
            border-top: 1px solid #e2e8f0;
            display: flex;
            gap: 8px;
            align-items: center;
        }
        #ai-chatbot-input {
            flex: 1;
            padding: 10px 16px;
            border: 1px solid #cbd5e1;
            border-radius: 20px;
            font-size: 13px;
            outline: none;
            transition: border-color 0.2s;
        }
        #ai-chatbot-input:focus {
            border-color: #4f46e5;
        }
        #ai-chatbot-send-btn {
            width: 36px;
            height: 36px;
            border-radius: 50%;
            background: linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%);
            color: #ffffff;
            border: none;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: transform 0.2s, box-shadow 0.2s;
            box-shadow: 0 2px 8px rgba(79, 70, 229, 0.3);
        }
        #ai-chatbot-send-btn:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(79, 70, 229, 0.4);
        }
        #ai-chatbot-toggle-btn {
            width: 56px;
            height: 56px;
            border-radius: 50%;
            background: linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%);
            color: #ffffff;
            border: none;
            cursor: pointer;
            box-shadow: 0 4px 18px rgba(79, 70, 229, 0.45);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 22px;
            transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }
        #ai-chatbot-toggle-btn:hover {
            transform: scale(1.08);
            box-shadow: 0 6px 24px rgba(79, 70, 229, 0.55);
        }
        #ai-chatbot-toggle-btn.active {
            transform: rotate(90deg);
        }
        .ai-chatbot-typing-indicator {
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 10px 16px;
        }
        .ai-chatbot-typing-dot {
            width: 6px;
            height: 6px;
            background-color: #64748b;
            border-radius: 50%;
            animation: ai-chatbot-bounce 1.4s infinite ease-in-out both;
        }
        .ai-chatbot-typing-dot:nth-child(1) { animation-delay: -0.32s; }
        .ai-chatbot-typing-dot:nth-child(2) { animation-delay: -0.16s; }
        
        @keyframes ai-chatbot-bounce {
            0%, 80%, 100% { transform: scale(0); }
            40% { transform: scale(1.0); }
        }
        
        @media (max-width: 480px) {
            #ai-chatbot-window {
                width: calc(100vw - 32px);
                height: calc(100vh - 100px);
                bottom: 80px;
                right: -8px;
            }
        }
    `;

    // 2. Load Styles
    const styleEl = document.createElement('style');
    styleEl.innerHTML = styles;
    document.head.appendChild(styleEl);

    // 3. Construct HTML
    const container = document.createElement('div');
    container.id = 'ai-chatbot-container';

    container.innerHTML = `
        <div id="ai-chatbot-window">
            <div id="ai-chatbot-header">
                <div class="ai-chatbot-bot-info">
                    <div class="ai-chatbot-avatar">
                        🤖
                        <span class="ai-chatbot-online-dot"></span>
                    </div>
                    <div>
                        <h3 class="ai-chatbot-title">AutoLib AI Assistant</h3>
                        <p class="ai-chatbot-subtitle">Online • Gemini 3.5 Flash</p>
                    </div>
                </div>
                <button id="ai-chatbot-close-btn" title="Close chat"><i class="fas fa-times"></i></button>
            </div>
            <div id="ai-chatbot-messages">
                <div class="ai-chatbot-msg bot">
                    <p>Hello! Main aapka AutoLib AI Assistant hu. Main library inventory, check-in logs, aur active borrowings me aapki help kar sakta hu.</p>
                    <p>Kuchh aam sawal jo aap mujhse puchh sakte hain:</p>
                    <div class="ai-chatbot-quick-suggestions">
                        <span class="ai-chatbot-suggestion-tag" data-query="Total books statistics">📊 Total Books</span>
                        <span class="ai-chatbot-suggestion-tag" data-query="Check overdue books">⚠️ Overdue Books</span>
                        <span class="ai-chatbot-suggestion-tag" data-query="Is any book out of stock?">📖 Book Availability</span>
                        <span class="ai-chatbot-suggestion-tag" data-query="Who visited the library today?">🚪 Today's Visitors</span>
                    </div>
                </div>
            </div>
            <form id="ai-chatbot-form">
                <input type="text" id="ai-chatbot-input" placeholder="Ask AI helper..." required autocomplete="off">
                <button type="submit" id="ai-chatbot-send-btn" title="Send message">
                    <i class="fas fa-paper-plane"></i>
                </button>
            </form>
        </div>
        <button id="ai-chatbot-toggle-btn" title="Ask AI Assistant">
            <i class="fas fa-magic"></i>
        </button>
    `;

    document.body.appendChild(container);

    // 4. Interactive Toggles
    const toggleBtn = document.getElementById('ai-chatbot-toggle-btn');
    const chatWindow = document.getElementById('ai-chatbot-window');
    const closeBtn = document.getElementById('ai-chatbot-close-btn');
    const chatForm = document.getElementById('ai-chatbot-form');
    const chatInput = document.getElementById('ai-chatbot-input');
    const messagesContainer = document.getElementById('ai-chatbot-messages');

    let history = [];

    function toggleChat() {
        const isActive = chatWindow.classList.toggle('active');
        toggleBtn.classList.toggle('active', isActive);
        if (isActive) {
            chatInput.focus();
            scrollToBottom();
        }
    }

    toggleBtn.addEventListener('click', toggleChat);
    closeBtn.addEventListener('click', () => {
        chatWindow.classList.remove('active');
        toggleBtn.classList.remove('active');
    });

    // 5. Lightweight Markdown Parser
    function parseMarkdown(text) {
        let html = text;
        // Escape HTML to prevent XSS issues
        html = html
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");

        // Code blocks: ```code```
        html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
        
        // Inline code: `code`
        html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
        
        // Bold: **text**
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

        // Lists: - item or * item
        const lines = html.split('\n');
        let inList = false;
        let processedLines = [];

        lines.forEach(line => {
            const cleanLine = line.trim();
            if (cleanLine.startsWith('- ') || cleanLine.startsWith('* ')) {
                if (!inList) {
                    processedLines.push('<ul>');
                    inList = true;
                }
                processedLines.push(`<li>${cleanLine.substring(2)}</li>`);
            } else {
                if (inList) {
                    processedLines.push('</ul>');
                    inList = false;
                }
                processedLines.push(line);
            }
        });
        if (inList) {
            processedLines.push('</ul>');
        }
        
        html = processedLines.join('\n');

        // Paragraphs: double newlines
        html = html.split('\n\n').map(p => {
            const trimP = p.trim();
            if (trimP.startsWith('<ul') || trimP.startsWith('<li') || trimP.startsWith('<pre') || trimP.trim() === '') {
                return trimP;
            }
            return `<p>${trimP.replace(/\n/g, '<br>')}</p>`;
        }).join('');

        return html;
    }

    function scrollToBottom() {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function appendMessage(sender, text) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `ai-chatbot-msg ${sender}`;
        
        if (sender === 'bot') {
            msgDiv.innerHTML = parseMarkdown(text);
        } else {
            // User messages are printed as simple text
            msgDiv.textContent = text;
        }
        
        messagesContainer.appendChild(msgDiv);
        scrollToBottom();
    }

    function showTypingIndicator() {
        const indicator = document.createElement('div');
        indicator.id = 'ai-chatbot-typing';
        indicator.className = 'ai-chatbot-msg bot ai-chatbot-typing-indicator';
        indicator.innerHTML = `
            <div class="ai-chatbot-typing-dot"></div>
            <div class="ai-chatbot-typing-dot"></div>
            <div class="ai-chatbot-typing-dot"></div>
        `;
        messagesContainer.appendChild(indicator);
        scrollToBottom();
    }

    function removeTypingIndicator() {
        const indicator = document.getElementById('ai-chatbot-typing');
        if (indicator) {
            indicator.remove();
        }
    }

    // 6. Socket Communication
    async function sendMessageToAI(messageText) {
        if (!messageText.trim()) return;

        appendMessage('user', messageText);
        chatInput.value = '';
        showTypingIndicator();

        // Check if Socket connection exists
        const socketObj = (typeof socket !== 'undefined') ? socket : (typeof io !== 'undefined' ? io() : null);

        if (!socketObj) {
            removeTypingIndicator();
            appendMessage('bot', "Error: System backend connection could not be established.");
            return;
        }

        socketObj.emit("aiChat", { message: messageText, chatHistory: history }, (res) => {
            removeTypingIndicator();
            if (res.error) {
                appendMessage('bot', `⚠️ **Error:** ${res.error}`);
            } else if (res.success && res.reply) {
                appendMessage('bot', res.reply);
                // Save turns to history
                history.push({ role: "user", text: messageText });
                history.push({ role: "model", text: res.reply });
                // Keep history size small to prevent token limits
                if (history.length > 20) {
                    history = history.slice(-20);
                }
            } else {
                appendMessage('bot', "Received unknown response from AI.");
            }
        });
    }

    // Handle Form Submit
    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = chatInput.value;
        sendMessageToAI(text);
    });

    // Handle Quick Suggestions Click
    messagesContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('ai-chatbot-suggestion-tag')) {
            const query = e.target.getAttribute('data-query');
            if (query) {
                sendMessageToAI(query);
            }
        }
    });

    // Define global trigger helper
    window.sendQuickPrompt = function(query) {
        if (chatWindow && !chatWindow.classList.contains('active')) {
            toggleChat();
        }
        sendMessageToAI(query);
    };

})();
