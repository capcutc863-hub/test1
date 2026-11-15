import React, { useState } from 'react';
import { MessageSquare, Send, X, User } from 'lucide-react';
import { ChatMessage, User as UserType } from '../types';

interface TeamChatModalProps {
  messages: ChatMessage[];
  currentUser: UserType;
  onClose: () => void;
  onSendMessage: (text: string) => void;
}

export const TeamChatModal: React.FC<TeamChatModalProps> = ({
  messages,
  currentUser,
  onClose,
  onSendMessage
}) => {
  const [text, setText] = useState('');

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    onSendMessage(text.trim());
    setText('');
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 z-[700] font-cairo" dir="rtl">
      <div className="bg-white w-full max-w-lg rounded-t-[2.5rem] sm:rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col h-[80vh] animate-in slide-in-from-bottom duration-200">
        
        {/* Chat Header */}
        <div className="bg-[#064E3B] text-white p-6 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-500/20 rounded-xl">
              <MessageSquare className="w-5 h-5 text-emerald-300" />
            </div>
            <div>
              <h3 className="font-black text-lg">المحادثات الداخلية للفريق</h3>
              <p className="text-xs text-emerald-200 font-bold">تواصل مباشر بين الإدارة والمندوبين</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Message History */}
        <div className="flex-1 p-6 overflow-y-auto space-y-4 bg-gray-50">
          {messages.map(msg => {
            const isMe = msg.senderId === currentUser.id;
            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isMe ? 'items-start' : 'items-end'}`}
              >
                <span className="text-[11px] font-bold text-gray-400 mb-1 px-1">
                  {msg.senderName} • {new Date(msg.timestamp).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                </span>
                <div
                  className={`p-4 rounded-2xl max-w-[85%] text-sm font-bold shadow-sm ${
                    isMe
                      ? 'bg-emerald-600 text-white rounded-tr-none'
                      : 'bg-white text-gray-900 border border-gray-100 rounded-tl-none'
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            );
          })}
          {messages.length === 0 && (
            <div className="text-center py-16 text-gray-400 text-xs font-bold">
              لا توجد رسائل سابقة. ابدأ المحادثة الآن!
            </div>
          )}
        </div>

        {/* Input Footer */}
        <form onSubmit={handleSend} className="p-4 bg-white border-t border-gray-100 flex gap-2">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="اكتب رسالتك هنا..."
            className="flex-1 p-3.5 bg-gray-50 rounded-2xl font-bold outline-none border focus:border-emerald-500 text-sm"
          />
          <button
            type="submit"
            disabled={!text.trim()}
            className="p-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl transition-all disabled:opacity-50"
          >
            <Send className="w-5 h-5" />
          </button>
        </form>

      </div>
    </div>
  );
};
