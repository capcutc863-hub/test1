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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-[700] font-cairo" dir="rtl">
      <div className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col h-[88vh] sm:h-[80vh] animate-in slide-in-from-bottom duration-200">
        
        {/* Chat Header */}
        <div className="bg-[#072F5F] text-white px-5 py-4 sm:p-6 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-500/20 rounded-xl">
              <MessageSquare className="w-5 h-5 text-blue-200" />
            </div>
            <div>
              <h3 className="font-black text-base sm:text-lg">المحادثات الداخلية للفريق</h3>
              <p className="text-xs text-blue-200 font-bold">تواصل مباشر بين الإدارة وفريق السيلز</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="إغلاق"
            className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-white/10 rounded-xl"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Message History */}
        <div className="flex-1 p-4 sm:p-6 overflow-y-auto space-y-4 bg-slate-50">
          {messages.map(msg => {
            const isMe = msg.senderId === currentUser.id;
            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isMe ? 'items-start' : 'items-end'}`}
              >
                <span className="text-xs font-bold text-slate-500 mb-1 px-1">
                  {msg.senderName} · {new Date(msg.timestamp).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                </span>
                <div
                  className={`p-3.5 sm:p-4 rounded-2xl max-w-[85%] text-sm font-bold shadow-sm ${
                    isMe
                      ? 'bg-[#0A468C] text-white rounded-tr-none'
                      : 'bg-white text-slate-900 border border-slate-200/80 rounded-tl-none'
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            );
          })}
          {messages.length === 0 && (
            <div className="text-center py-16 text-slate-500 text-sm font-bold">
              لا توجد رسائل سابقة. ابدأ المحادثة الآن!
            </div>
          )}
        </div>

        {/* Input Footer */}
        <form onSubmit={handleSend} className="p-3 sm:p-4 pb-safe bg-white border-t border-slate-200 flex gap-2 shrink-0">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="اكتب رسالتك هنا..."
            className="flex-1 min-h-[48px] px-4 py-3 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200 focus:border-[#0A468C] text-base sm:text-sm text-slate-900"
          />
          <button
            type="submit"
            disabled={!text.trim()}
            className="min-w-[48px] min-h-[48px] px-4 bg-[#0A468C] hover:bg-[#072F5F] text-white rounded-2xl transition-all disabled:opacity-50 flex items-center justify-center"
          >
            <Send className="w-5 h-5" />
          </button>
        </form>

      </div>
    </div>
  );
};
