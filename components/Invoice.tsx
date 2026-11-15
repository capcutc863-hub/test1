import React, { useRef, useState } from 'react';
import { Order } from '../types';
import html2canvas from 'html2canvas';
import { Download, Printer, Phone, MapPin, Info, ShieldCheck, X, Check, Droplets } from 'lucide-react';

interface InvoiceProps {
  order: Order;
  onClose: () => void;
}

export const Invoice: React.FC<InvoiceProps> = ({ order, onClose }) => {
  const invoiceRef = useRef<HTMLDivElement>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  const downloadImage = async () => {
    if (!invoiceRef.current) return;
    setIsDownloading(true);
    try {
      const canvas = await html2canvas(invoiceRef.current, { 
        scale: 2, 
        useCORS: true, 
        backgroundColor: '#ffffff' 
      });
      const link = document.createElement('a');
      link.download = `Royal-Invoice-${order.id}-${order.customerName}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error(err);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-emerald-950/85 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 z-[700] no-print overflow-y-auto font-cairo" dir="rtl">
      <div className="bg-white w-full max-w-2xl rounded-[2.5rem] sm:rounded-[3rem] shadow-2xl overflow-hidden flex flex-col my-4 sm:my-8 animate-in zoom-in duration-200 border border-emerald-900/20 max-h-[95vh]">
        
        {/* Scrollable Printable Invoice Content */}
        <div className="overflow-y-auto p-4 sm:p-10 md:p-12 bg-white relative" ref={invoiceRef}>
          {/* Watermark Decor */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-[0.03] pointer-events-none">
            <Droplets className="w-96 h-96 text-emerald-900" />
          </div>

          {/* Header */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b-4 sm:border-b-8 border-emerald-600 pb-6 sm:pb-8 mb-8 relative gap-4">
            <div className="space-y-1.5">
              <h1 className="text-3xl sm:text-4xl md:text-5xl font-black text-emerald-950 tracking-tight">
                فاتورة مبيعات
              </h1>
              <div className="flex items-center gap-2.5">
                <span className="bg-emerald-100 text-emerald-800 px-3 py-0.5 rounded-full text-xs font-black">
                  #{order.id.slice(0, 8)}
                </span>
                <span className="text-gray-400 font-bold text-xs">
                  {new Date(order.createdAt).toLocaleDateString('ar-EG')}
                </span>
              </div>
            </div>
            <div className="text-right sm:text-left">
              <h2 className="font-black text-xl sm:text-2xl text-emerald-900">مؤسسة الملكي للعطور</h2>
              <p className="text-[9px] sm:text-[10px] text-emerald-600 font-black uppercase tracking-[0.2em] mt-1">
                Royal Fragrances & Essential Oils
              </p>
            </div>
          </div>

          {/* Customer & Rep Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-10 mb-8">
            <div className="space-y-2">
              <p className="text-[10px] font-black text-emerald-700 uppercase tracking-wider border-r-4 border-emerald-500 pr-2.5">
                بيانات العميل
              </p>
              <div>
                <p className="font-black text-xl sm:text-2xl text-gray-900 mb-1.5">{order.customerName}</p>
                <div className="space-y-1 text-xs font-bold text-gray-600">
                  <p className="flex items-center gap-2">
                    <Phone className="w-3.5 h-3.5 text-emerald-600" /> {order.customerPhone || 'بدون هاتف'}
                  </p>
                  <p className="flex items-center gap-2">
                    <MapPin className="w-3.5 h-3.5 text-emerald-600" /> {order.customerAddress || 'الاستلام من المقر الرئيسي'}
                  </p>
                </div>
              </div>
            </div>

            <div className="sm:text-left flex flex-col sm:items-end space-y-2">
              <p className="text-[10px] font-black text-emerald-700 uppercase tracking-wider border-l-4 border-emerald-500 pl-2.5 w-fit">
                المبيعات والشحن
              </p>
              <div className="text-right space-y-1">
                <p className="text-[11px] font-bold text-gray-400">المندوب المسؤول</p>
                <p className="text-base font-black text-emerald-900">{order.salesRepName}</p>
                <div className="mt-2 inline-block bg-emerald-900 text-white px-3.5 py-1 rounded-xl text-[10px] font-black shadow-sm">
                  حالة الطلب: {order.status}
                </div>
              </div>
            </div>
          </div>

          {/* Items Table */}
          <div className="overflow-x-auto mb-8 rounded-2xl border border-emerald-100 shadow-sm">
            <table className="w-full text-right border-collapse min-w-[320px]">
              <thead className="bg-emerald-950 text-emerald-50">
                <tr>
                  <th className="p-3 sm:p-4 text-right font-black text-xs">الصنف / الجودة</th>
                  <th className="p-3 sm:p-4 text-center font-black text-xs">الوزن (mg)</th>
                  <th className="p-3 sm:p-4 text-left font-black text-xs">السعر</th>
                  <th className="p-3 sm:p-4 text-left font-black text-xs">الإجمالي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-emerald-50 bg-emerald-50/15">
                {order.items.map((item, idx) => (
                  <tr key={idx}>
                    <td className="p-3 sm:p-4 text-right">
                      <p className="font-black text-gray-900 text-xs sm:text-sm">{item.productName}</p>
                      <p className="text-[9px] text-emerald-700 font-bold">{item.grade}</p>
                    </td>
                    <td className="p-3 sm:p-4 text-center font-bold text-emerald-900 text-xs sm:text-sm">
                      {item.quantity.toLocaleString()} mg
                    </td>
                    <td className="p-3 sm:p-4 text-left font-bold text-gray-500 text-xs sm:text-sm">
                      {item.price} ج.م
                    </td>
                    <td className="p-3 sm:p-4 text-left font-black text-emerald-950 text-xs sm:text-sm">
                      {(item.quantity * item.price).toLocaleString()} ج.م
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Notes & Pricing Totals */}
          <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-end pt-6 border-t-2 border-emerald-100 gap-6">
            <div className="flex-1 p-4 bg-gray-50 rounded-2xl border border-gray-200 text-xs">
              <p className="text-[10px] font-black text-gray-400 uppercase mb-1 flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-emerald-600" /> ملاحظات الفاتورة
              </p>
              <p className="text-gray-700 font-bold leading-relaxed">
                {order.customerNotes || "لا توجد ملاحظات إضافية على هذا الطلب."}
              </p>
            </div>

            <div className="w-full sm:w-64 space-y-2 text-xs">
              <div className="flex justify-between font-bold text-gray-500 px-2">
                <span>إجمالي الأصناف:</span>
                <span>{order.subtotal.toLocaleString()} ج.م</span>
              </div>
              {order.discountAmount > 0 && (
                <div className="flex justify-between font-bold text-red-500 px-2">
                  <span>خصم تجاري ({order.discountPercentage}%):</span>
                  <span>-{order.discountAmount.toLocaleString()} ج.م</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-emerald-700 px-2">
                <span>مصاريف الشحن:</span>
                <span>+{order.shippingCost.toLocaleString()} ج.م</span>
              </div>

              <div className="bg-emerald-900 p-5 rounded-2xl text-white shadow-lg mt-3">
                <p className="text-[9px] font-black text-emerald-300 uppercase tracking-widest mb-0.5">
                  الصافي النهائي المستحق
                </p>
                <div className="flex justify-between items-baseline">
                  <span className="text-2xl sm:text-3xl font-black">{order.totalAmount.toLocaleString()}</span>
                  <span className="text-xs font-bold opacity-80">ج.م</span>
                </div>
              </div>
            </div>
          </div>
          
          <div className="mt-8 text-center text-[10px] font-black text-gray-400">
            شكراً لتعاملكم مع مؤسسة الملكي للزيوت العطرية المركزة
          </div>
        </div>

        {/* Action Buttons Footer */}
        <div className="bg-gray-50 p-4 sm:p-6 flex flex-col sm:flex-row gap-3 border-t border-gray-200 no-print shrink-0">
          <button
            onClick={downloadImage}
            disabled={isDownloading}
            className="flex-1 bg-emerald-600 text-white py-3.5 px-4 rounded-2xl font-black text-xs sm:text-sm hover:bg-emerald-700 transition-all flex items-center justify-center gap-2 shadow-md active:scale-95"
          >
            <Download className="w-4 h-4" />
            {isDownloading ? 'جاري الحفظ...' : 'حفظ الفاتورة كصورة'}
          </button>
          
          <button
            onClick={() => window.print()}
            className="flex-1 bg-emerald-950 text-white py-3.5 px-4 rounded-2xl font-black text-xs sm:text-sm hover:bg-black transition-all flex items-center justify-center gap-2 shadow-md active:scale-95"
          >
            <Printer className="w-4 h-4" />
            طباعة الفاتورة
          </button>

          <button
            onClick={onClose}
            className="py-3.5 px-6 bg-white text-gray-600 rounded-2xl font-black text-xs sm:text-sm border border-gray-200 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-all"
          >
            إغلاق
          </button>
        </div>

      </div>
    </div>
  );
};

export default Invoice;
